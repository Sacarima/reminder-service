import { collectDefaultMetrics, register } from "prom-client";
import type { FastifyPluginAsync } from "fastify";

collectDefaultMetrics({ prefix: "reminder_api_" });

export const metricsPlugin: FastifyPluginAsync = async (app) => {
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", register.contentType);
    return register.metrics();
  });
};
