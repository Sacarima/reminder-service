import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health/live", async () => ({ ok: true }));

  app.get("/health/ready", async () => {
    // @ts-ignore decorated in server.ts
    const pool = app.pgPool as import("pg").Pool;
    // @ts-ignore
    const redis = app.redis as import("ioredis").Redis;

    await pool.query("SELECT 1");
    const pong = await redis.ping();
    if (pong !== "PONG") throw new Error("redis not ready");

    return { ok: true };
  });
};
