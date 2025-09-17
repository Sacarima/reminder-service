import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";

export const upcomingRoutes: FastifyPluginAsync = async (app) => {
  // GET /appointments/upcoming?clinicId=&patientId=&horizonHours=&limit=
  app.get("/appointments/upcoming", async (req, reply) => {
    const Q = z.object({
      clinicId: z.string().optional(),
      patientId: z.string().optional(),
      horizonHours: z.coerce
        .number()
        .int()
        .positive()
        .max(24 * 14)
        .default(72), // next 72h by default, cap 14d
      limit: z.coerce.number().int().positive().max(200).default(50),
    });

    const { clinicId, patientId, horizonHours, limit } = Q.parse(req.query);
    const now = new Date();
    const horizon = new Date(now.getTime() + horizonHours * 60 * 60 * 1000);

    // 1) Get upcoming scheduled plans
    const plans = await prisma.schedulePlan.findMany({
      where: {
        status: "scheduled",
        plannedUtc: { gt: now, lte: horizon },
      },
      orderBy: { plannedUtc: "asc" },
      take: limit,
    });

    if (plans.length === 0) {
      reply.send({ items: [], nextCursor: null });
      return;
    }

    // 2) Enrich with latest appointment shadow (clinicId/patientId), then optional filter
    const byApt = new Map<
      string,
      Awaited<ReturnType<typeof prisma.appointmentShadow.findFirst>>
    >();
    for (const p of plans) {
      if (!byApt.has(p.appointmentId)) {
        const shadow = await prisma.appointmentShadow.findFirst({
          where: { appointmentId: p.appointmentId },
          orderBy: { version: "desc" },
        });
        byApt.set(p.appointmentId, shadow);
      }
    }

    const items = plans
      .map((p) => {
        const sh = byApt.get(p.appointmentId);
        return {
          appointmentId: p.appointmentId,
          slotKind: p.slotKind,
          plannedLocal: p.plannedLocal.toISOString(),
          plannedUTC: p.plannedUtc.toISOString(),
          windowRule: p.windowRule,
          status: p.status, // should be 'scheduled'
          clinicId: sh?.clinicId ?? null,
          patientId: sh?.patientId ?? null,
          version: sh?.version ?? null,
        };
      })
      .filter((row) => (clinicId ? row.clinicId === clinicId : true))
      .filter((row) => (patientId ? row.patientId === patientId : true));

    reply.send({ items, nextCursor: null });
  });
};
