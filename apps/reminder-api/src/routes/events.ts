import { env } from "../config.js";
import { DateTime } from "luxon";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { planSlots } from "@reminder/shared";
import { emailQueue, smsQueue } from "../queues.js";
import { jobKeyFrom, priorityFor, type ReminderJob } from "@reminder/shared";
import { Prisma } from "@prisma/client";

// Normalize offsets like +0200 → +02:00 (macOS date, some clients)
function fixOffset(iso: string) {
  return iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
}

const Patient = z
  .object({
    id: z.string(),
    tz: z.string(),
    channelPreference: z.enum(["email", "sms"]),
    email: z.string().email().optional(),
    phoneE164: z.string().optional(),
  })
  .refine(
    (p) => (p.channelPreference === "email" ? !!p.email : !!p.phoneE164),
    {
      message:
        "email required for channel=email; phoneE164 required for channel=sms",
    },
  );

const EventSchema = z.object({
  type: z.enum([
    "appointment.created",
    "appointment.updated",
    "appointment.canceled",
  ]),
  appointmentId: z.string(),
  version: z.number().int().nonnegative(),
  clinicId: z.string(),
  patient: Patient,
  startAt: z.string(), // ISO string (with offset or Z)
  metadata: z.record(z.any()).optional(),
});

export const eventRoutes: FastifyPluginAsync = async (app) => {
  app.post("/events", async (req, reply) => {
    // -------------------- 0) Validate input --------------------
    const parsed = EventSchema.safeParse(req.body);
    if (!parsed.success) {
      reply
        .code(400)
        .send({ error: "validation", details: parsed.error.flatten() });
      return;
    }
    const evt = parsed.data;

    // -------------------- 0.1) Parse/normalize startAt --------------------
    const fixedISO = fixOffset(evt.startAt);
    const startDt = DateTime.fromISO(fixedISO, { setZone: true });
    if (!startDt.isValid) {
      reply.code(400).send({
        error: "invalid_startAt",
        detail:
          startDt.invalidExplanation ??
          startDt.invalidReason ??
          "invalid ISO datetime",
      });
      return;
    }
    // For DB: a real UTC Date; for planner: normalized ISO with offset
    const startAtUtc = startDt.toUTC().toJSDate();
    const normalizedISO = startDt.toISO({ suppressMilliseconds: true })!;

    // -------------------- 1) Reject stale versions --------------------
    const latest = await prisma.appointmentShadow.findFirst({
      where: { appointmentId: evt.appointmentId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    if (latest && evt.version < latest.version) {
      reply.code(409).send({ code: "stale_version", latest: latest.version });
      return;
    }

    // -------------------- 2) Canceled → mark + cancel plans --------------------
    if (evt.type === "appointment.canceled") {
      await prisma.$transaction(async (tx) => {
        await tx.appointmentShadow.upsert({
          where: {
            appointmentId_version: {
              appointmentId: evt.appointmentId,
              version: evt.version,
            },
          },
          update: { status: "canceled" },
          create: {
            appointmentId: evt.appointmentId,
            clinicId: evt.clinicId,
            patientId: evt.patient.id,
            patientTz: evt.patient.tz,
            channelPreference: evt.patient.channelPreference,
            patientEmail: evt.patient.email ?? null,
            patientPhoneE164: evt.patient.phoneE164 ?? null,
            startAtUtc: startAtUtc, //
            version: evt.version,
            status: "canceled",
          },
        });

        await tx.schedulePlan.updateMany({
          where: { appointmentId: evt.appointmentId, status: "scheduled" },
          data: { status: "canceled" },
        });
      });

      reply.code(202).send({
        status: "accepted",
        appointmentId: evt.appointmentId,
        version: evt.version,
        type: evt.type,
      });
      return;
    }

    // -------------------- 3) Created/Updated → write shadow --------------------
    try {
      await prisma.appointmentShadow.create({
        data: {
          appointmentId: evt.appointmentId,
          clinicId: evt.clinicId,
          patientId: evt.patient.id,
          patientTz: evt.patient.tz,
          channelPreference: evt.patient.channelPreference,
          patientEmail: evt.patient.email ?? null, // ← NEW
          patientPhoneE164: evt.patient.phoneE164 ?? null,
          startAtUtc: startAtUtc,
          version: evt.version,
          status: "active",
        },
      });
    } catch (e) {
      // Unique on (appointmentId, version): duplicate incoming → 200 no-op
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        reply.code(200).send({ status: "no-op", reason: "duplicate_version" });
        return;
      }
      throw e;
    }

    // -------------------- 4) Plan both slots deterministically --------------------
    const plans = planSlots({
      startAtISO: normalizedISO,
      patientTZ: evt.patient.tz,
      quietStart: env.QUIET_HOURS_START,
      quietEnd: env.QUIET_HOURS_END,
    });

    // -------------------- 5) Persist plans and enqueue scheduled ones --------------------
    const results: Array<{
      slotKind: string;
      plannedLocal: string | null;
      plannedUTC: string | null;
      status: string;
      windowRule: string;
    }> = [];

    for (const p of plans) {
      // Cancel previous active plan for this slotKind (if any)
      await prisma.schedulePlan.updateMany({
        where: {
          appointmentId: evt.appointmentId,
          slotKind: p.slotKind,
          status: "scheduled",
        },
        data: { status: "canceled" },
      });

      const jobKey = jobKeyFrom(evt.appointmentId, p.slotKind, evt.version);

      // Persist the new plan row
      await prisma.schedulePlan.create({
        data: {
          appointmentId: evt.appointmentId,
          slotKind: p.slotKind,
          plannedLocal: new Date(p.plannedLocalISO),
          plannedLocalISO: p.plannedLocalISO!,
          plannedUtc: new Date(p.plannedUTCISO),
          windowRule: p.windowRule,
          status: p.status, // 'scheduled' | 'expired'
          jobKey,
        },
      });

      // Enqueue only if this slot is actually scheduled (not expired)
      if (p.status === "scheduled") {
        const payload: ReminderJob = {
          jobKey,
          appointmentId: evt.appointmentId,
          slotKind: p.slotKind,
          version: evt.version,
          clinicId: evt.clinicId,
          channel: evt.patient.channelPreference,
          recipient: {
            email: evt.patient.email,
            phoneE164: evt.patient.phoneE164,
          },
          patientTZ: evt.patient.tz,
          plannedLocal: p.plannedLocalISO!, // planner ensured valid ISO
          plannedUTC: p.plannedUTCISO!, // planner ensured valid ISO
          trace: { requestId: req.headers["x-request-id"] as string },
        };

        // Delay until planned UTC (ms; never negative)
        const delayMs = Math.max(
          0,
          new Date(p.plannedUTCISO!).getTime() - Date.now(),
        );
        const priority = priorityFor(p.slotKind);
        const queue = payload.channel === "email" ? emailQueue : smsQueue;

        await queue.add(jobKey, payload, {
          jobId: jobKey, // idempotent: same jobKey won't duplicate
          delay: delayMs,
          priority,
          attempts: 6,
          backoff: { type: "exponential", delay: 60_000 }, // base 60s
          removeOnComplete: true,
          removeOnFail: false,
        });
      }

      results.push({
        slotKind: p.slotKind,
        plannedLocal: p.plannedLocalISO,
        plannedUTC: p.plannedUTCISO,
        status: p.status,
        windowRule: p.windowRule,
      });
    }

    // -------------------- 6) Return plan preview --------------------
    reply.code(202).send({
      status: "accepted",
      appointmentId: evt.appointmentId,
      version: evt.version,
      plan: results,
    });
  });
};
