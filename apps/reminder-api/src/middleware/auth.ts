import type { FastifyPluginAsync } from "fastify";
import { env } from "../config.js";

export const authPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", (req, reply, done) => {
    // Allow health/metrics without auth
    if (req.routerPath?.startsWith("/health") || req.routerPath === "/metrics")
      return done();

    const hdr = req.headers["authorization"] || "";
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
    if (token !== env.SERVICE_TOKEN_DEV) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    done();
  });
};
