import Fastify from "fastify";
import client from "prom-client";
import { env } from "./config.js";

// Create a registry and default process metrics
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

// Custom metrics
export const jobsProcessed = new client.Counter({
  name: "worker_jobs_processed_total",
  help: "Jobs processed by status/channel/slotKind",
  labelNames: ["status", "channel", "slotKind"] as const,
  registers: [registry],
});

export const deliveryLatency = new client.Histogram({
  name: "worker_delivery_latency_ms",
  help: "End-to-end provider delivery latency (ms)",
  labelNames: ["channel", "slotKind"] as const,
  buckets: [50, 100, 250, 500, 1000, 2000, 5000, 10000],
  registers: [registry],
});

export async function startMetricsServer(port = env.METRICS_PORT) {
  const app = Fastify({ logger: false });
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", registry.contentType);
    return registry.metrics();
  });
  await app.listen({ port, host: "0.0.0.0" });
  // eslint-disable-next-line no-console
  console.log(`[metrics] listening on http://0.0.0.0:${port}/metrics`);
}
