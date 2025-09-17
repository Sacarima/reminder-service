// Simple env reader for the worker.
import { z } from "zod";

const Env = z.object({
  REDIS_URL: z.string().url(),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  FROM_EMAIL: z.string().email().default("reminder@example.test"),
  METRICS_PORT: z.coerce.number().default(8091),

  // Reconciler
  RECONCILE_INTERVAL_MS: z.coerce.number().default(60_000), // every minute
  RECONCILE_HORIZON_MIN: z.coerce.number().default(360), // look 6 hours ahead
  RECONCILE_DRIFT_TOL_MS: z.coerce.number().default(30_000),
});

export const env = Env.parse(process.env);
