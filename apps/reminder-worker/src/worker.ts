import { PrismaClient, AttemptStatus, Prisma } from "@prisma/client";
// Worker: pulls from queues, performs guard checks, sends (email/SMS),
// classifies errors (transient vs permanent), logs attempts,
// flips plan to "sent" on success or "canceled" on permanent failure,
// and exposes Prometheus metrics.

import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import pino from "pino";
//import { PrismaClient } from "@prisma/client";
import { QUEUE_EMAIL, QUEUE_SMS, type ReminderJob } from "@reminder/shared";
import { sendEmail } from "./adapters/email.js";
import { renderReminderEmail } from "./templates/email.js";
import { sendSmsDevStub } from "./adapters/sms.js";
import {
  jobsProcessed,
  deliveryLatency,
  startMetricsServer,
} from "./metrics.js";
import { env } from "./config.js";

await startMetricsServer();

const logger = pino({ level: "info" });

/** BullMQ requires maxRetriesPerRequest: null for blocking ops. */
const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const prisma = new PrismaClient();

/* ------------------------- Error classification ------------------------- */

/** Simple shape we return from classifier */
type ErrClass =
  | { kind: "transient"; code?: string; message?: string }
  | { kind: "permanent"; code?: string; message?: string };

/** CSV env → Set<string> helper */
function csvSet(v?: string) {
  return new Set(
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Dev-only overrides to simulate failures by recipient (handy in MailHog) */
const DEV_PERM_EMAILS = csvSet(process.env.DEV_FORCE_PERM_EMAILS);
const DEV_TRANS_EMAILS = csvSet(process.env.DEV_FORCE_TRANS_EMAILS);
const DEV_PERM_PHONES = csvSet(process.env.DEV_FORCE_PERM_PHONES);
const DEV_TRANS_PHONES = csvSet(process.env.DEV_FORCE_TRANS_PHONES);

/** Heuristics for SMTP & network-ish errors */
function classifySendError(err: unknown): ErrClass {
  // If our adapters threw a typed error, allow them to hint permanence
  if (err && typeof err === "object" && "permanent" in (err as any)) {
    return (err as any).permanent
      ? { kind: "permanent", code: "adapter_permanent", message: String(err) }
      : { kind: "transient", code: "adapter_transient", message: String(err) };
  }

  const e = err as any;
  const codeNum: number | undefined =
    typeof e?.responseCode === "number" ? e.responseCode : undefined;
  const codeStr: string = String(e?.code ?? e?.name ?? "");

  // SMTP codes:
  // 421/450/451/452 -> transient; 5xx -> permanent (550/551/552/553/554 typical)
  if (typeof codeNum === "number") {
    if ([421, 450, 451, 452].includes(codeNum)) {
      return {
        kind: "transient",
        code: "smtp_" + codeNum,
        message: e?.message,
      };
    }
    if (codeNum >= 500) {
      return {
        kind: "permanent",
        code: "smtp_" + codeNum,
        message: e?.message,
      };
    }
    if (Math.floor(codeNum / 100) === 4) {
      return {
        kind: "transient",
        code: "smtp_" + codeNum,
        message: e?.message,
      };
    }
  }

  // Network-ish → transient
  if (
    /ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|Timeout/i.test(
      codeStr,
    ) ||
    /socket|connect|network/i.test(String(e?.message ?? ""))
  ) {
    return { kind: "transient", code: codeStr, message: e?.message };
  }

  // Obvious permanent formatting issues
  if (
    /No recipients defined|EENVELOPE|address|recipient/i.test(
      String(e?.message ?? ""),
    )
  ) {
    return {
      kind: "permanent",
      code: codeStr || "format",
      message: e?.message,
    };
  }

  // Default to transient (safer) when unknown
  return { kind: "transient", code: codeStr || "unknown", message: e?.message };
}

/** Decide transient/permanent BEFORE calling provider based on dev overrides */
function preflightDevOverride(job: ReminderJob): ErrClass | null {
  if (job.channel === "email" && job.recipient.email) {
    if (DEV_PERM_EMAILS.has(job.recipient.email))
      return {
        kind: "permanent",
        code: "dev_forced",
        message: "forced permanent",
      };
    if (DEV_TRANS_EMAILS.has(job.recipient.email))
      return {
        kind: "transient",
        code: "dev_forced",
        message: "forced transient",
      };
  }
  if (job.channel === "sms" && job.recipient.phoneE164) {
    if (DEV_PERM_PHONES.has(job.recipient.phoneE164))
      return {
        kind: "permanent",
        code: "dev_forced",
        message: "forced permanent",
      };
    if (DEV_TRANS_PHONES.has(job.recipient.phoneE164))
      return {
        kind: "transient",
        code: "dev_forced",
        message: "forced transient",
      };
  }
  return null;
}

/* ------------------------------ Job handler ----------------------------- */

async function processJob(job: Job<ReminderJob>) {
  const jobId = job.id ?? "unknown";
  const { jobKey, appointmentId, slotKind, plannedUTC, channel, recipient } =
    job.data;
  const startedAt = new Date();

  // Guard 1: plan exists & still scheduled
  const plan = await prisma.schedulePlan.findUnique({
    where: { jobKey },
    select: { status: true, plannedUtc: true },
  });
  if (!plan) {
    logger.warn({ jobKey, jobId }, "no plan found → skipping");
    return;
  }
  if (plan.status !== "scheduled") {
    logger.info(
      { jobKey, status: plan.status, jobId },
      "plan not scheduled → skipping",
    );
    return;
  }

  // Guard 2: don’t fire >5m early (a reconciler can requeue if drifted)
  if (Date.now() + 5 * 60_000 < plan.plannedUtc.getTime()) {
    logger.warn({ jobKey, jobId }, "fired early (>5m) → skipping");
    return;
  }

  // Optional dev hooks to simulate failures without touching adapters
  const forced = preflightDevOverride(job.data);
  if (forced?.kind === "permanent") {
    await finalizePermanentFailure(
      job,
      startedAt,
      "dev_forced",
      "forced permanent before send",
    );
    return; // do not retry
  }
  if (forced?.kind === "transient") {
    // record as transient and retry
    await recordAttempt(job, startedAt, "transient_fail", 0, {
      code: "dev_forced",
      msg: "forced transient before send",
    });
    jobsProcessed.labels("transient_fail", channel, slotKind).inc(1);
    throw new Error("dev_forced_transient"); // BullMQ retry
  }

  // ------------- Send via provider -------------
  let providerMessageId = "";
  try {
    if (channel === "email") {
      if (!recipient.email)
        throw Object.assign(new Error("missing recipient.email"), {
          permanent: true,
        });
      const tpl = renderReminderEmail(job.data);
      providerMessageId = await sendEmail({
        to: recipient.email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
      });
    } else {
      if (!recipient.phoneE164)
        throw Object.assign(new Error("missing recipient.phoneE164"), {
          permanent: true,
        });
      const body =
        slotKind === "T_MINUS_2H"
          ? "Reminder: your appointment is in ~2 hours."
          : "Reminder: your appointment is tomorrow.";
      providerMessageId = await sendSmsDevStub(recipient.phoneE164, body);
    }
  } catch (err) {
    const cls = classifySendError(err);
    const finishedAt = new Date();
    const latencyMs = finishedAt.getTime() - startedAt.getTime();
    const attemptNum = (job.attemptsMade ?? 0) + 1;

    if (cls.kind === "permanent") {
      // Log and stop retrying; mark plan canceled to keep it out of "upcoming"
      await prisma.deliveryLog.create({
        data: {
          jobKey,
          channel,
          attempt: attemptNum,
          startedAt,
          finishedAt,
          status: "permanent_fail",
          providerMessageId: "",
          latencyMs,
          metadata: { code: cls.code, message: cls.message },
        },
      });
      await prisma.schedulePlan.update({
        where: { jobKey },
        data: { status: "canceled" },
      });
      jobsProcessed.labels("permanent_fail", channel, slotKind).inc(1);
      logger.warn(
        { jobKey, code: cls.code, jobId },
        "permanent failure → canceled plan, no retry",
      );
      return; // do not throw → no retry
    } else {
      // Transient: log and throw to retry
      await prisma.deliveryLog.create({
        data: {
          jobKey,
          channel,
          attempt: attemptNum,
          startedAt,
          finishedAt,
          status: "transient_fail",
          providerMessageId: "",
          latencyMs,
          metadata: { code: cls.code, message: cls.message },
        },
      });
      jobsProcessed.labels("transient_fail", channel, slotKind).inc(1);
      logger.warn(
        { jobKey, code: cls.code, jobId, attemptNum },
        "transient failure → will retry",
      );
      throw err; // BullMQ backoff/attempts applies
    }
  }

  // ------------- Success path -------------
  const finishedAt = new Date();
  const latencyMs = finishedAt.getTime() - startedAt.getTime();
  const attemptNum = (job.attemptsMade ?? 0) + 1;

  await prisma.deliveryLog.create({
    data: {
      jobKey,
      channel,
      attempt: attemptNum,
      startedAt,
      finishedAt,
      status: "success",
      providerMessageId,
      latencyMs,
    },
  });

  await prisma.schedulePlan.update({
    where: { jobKey },
    data: { status: "sent" },
  });

  jobsProcessed.labels("success", channel, slotKind).inc(1);
  deliveryLatency.labels(channel, slotKind).observe(latencyMs);

  logger.info({ jobKey, appointmentId, slotKind, plannedUTC, jobId }, "sent");
}

/** Helper to write a transient/permanent attempt quickly (used in dev-forced) */
async function recordAttempt(
  job: Job<ReminderJob>,
  startedAt: Date,
  status: "transient_fail" | "permanent_fail",
  latencyMs: number,
  extra?: Prisma.JsonObject,
) {
  const attemptNum = (job.attemptsMade ?? 0) + 1;
  await prisma.deliveryLog.create({
    data: {
      jobKey: job.data.jobKey,
      channel: job.data.channel,
      attempt: attemptNum,
      startedAt,
      finishedAt: new Date(),
      status,
      providerMessageId: "",
      latencyMs,
      metadata: extra ?? {},
    },
  });
}

/** Finalize a permanent failure before/without provider call */
async function finalizePermanentFailure(
  job: Job<ReminderJob>,
  startedAt: Date,
  code: string,
  message: string,
) {
  const attemptNum = (job.attemptsMade ?? 0) + 1;
  await prisma.deliveryLog.create({
    data: {
      jobKey: job.data.jobKey,
      channel: job.data.channel,
      attempt: attemptNum,
      startedAt,
      finishedAt: new Date(),
      status: "permanent_fail",
      providerMessageId: "",
      latencyMs: 0,
      metadata: { code, message },
    },
  });
  await prisma.schedulePlan.update({
    where: { jobKey: job.data.jobKey },
    data: { status: "canceled" },
  });
  jobsProcessed
    .labels("permanent_fail", job.data.channel, job.data.slotKind)
    .inc(1);
}

/* ------------------------------ Boot workers ---------------------------- */

async function main() {
  const emailWorker = new Worker<ReminderJob>(QUEUE_EMAIL, processJob, {
    connection: redis,
    concurrency: 10,
  });

  const smsWorker = new Worker<ReminderJob>(QUEUE_SMS, processJob, {
    connection: redis,
    concurrency: 5,
  });

  // When BullMQ exhausts retries (still failing transiently), mark plan canceled
  const onFailed = async (job?: Job<ReminderJob>, err?: Error) => {
    if (!job) return;
    try {
      const plan = await prisma.schedulePlan.findUnique({
        where: { jobKey: job.data.jobKey },
        select: { status: true },
      });
      if (plan?.status === "scheduled") {
        await prisma.schedulePlan.update({
          where: { jobKey: job.data.jobKey },
          data: { status: "canceled" },
        });
        logger.warn(
          {
            jobKey: job.data.jobKey,
            attemptsMade: job.attemptsMade,
            err: err?.message,
          },
          "retries exhausted → plan canceled",
        );
      }
    } catch (e) {
      logger.error(e, "failed to finalize plan after retries exhausted");
    }
  };

  emailWorker.on("failed", onFailed);
  smsWorker.on("failed", onFailed);

  logger.info("worker up: listening to queues %s, %s", QUEUE_EMAIL, QUEUE_SMS);
}

main().catch((e) => {
  logger.error(e, "worker fatal");
  process.exit(1);
});
