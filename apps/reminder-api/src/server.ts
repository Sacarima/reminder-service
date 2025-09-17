import Fastify from "fastify";
import pino from "pino";
import { Pool } from "pg";
import Redis from "ioredis";
import { env } from "./config.js";
import { requestIdPlugin } from "./middleware/requestId.js";
import { authPlugin } from "./middleware/auth.js";
import { healthRoutes } from "./routes/health.js";
import { eventRoutes } from "./routes/events.js";
import { metricsPlugin } from "./metrics.js";
import { upcomingRoutes } from "./routes/upcoming.js";
// QUEUE UI
import { createBullBoard } from "@bull-board/api";
import { FastifyAdapter } from "@bull-board/fastify";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { emailQueue, smsQueue } from "./queues.js";

const logger = pino({
  level: "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { singleLine: true } }
      : undefined,
});

async function main() {
  const app = Fastify({ loggerInstance: logger });

  // Shared connections
  const pgPool = new Pool({ connectionString: env.DATABASE_URL });
  const redis = new Redis(env.REDIS_URL);

  // Decorate for access in routes
  app.decorate("pgPool", pgPool as any);
  app.decorate("redis", redis as any);

  // Register plugins/routes
  await app.register(requestIdPlugin);
  await app.register(authPlugin);
  await app.register(healthRoutes);
  await app.register(metricsPlugin);
  await app.register(eventRoutes);
  await app.register(upcomingRoutes);

  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath("/ops/queues");

  createBullBoard({
    queues: [new BullMQAdapter(emailQueue), new BullMQAdapter(smsQueue)],
    serverAdapter,
  });

  await app.register(serverAdapter.registerPlugin(), {
    prefix: "/ops/queues",
  });

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  app.log.info({ port: env.PORT }, "reminder-api listening");
}

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));

main().catch((err) => {
  console.error("Fatal boot error:", err);
  process.exit(1);
});
