import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";

export const requestIdPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onRequest", (req, _reply, done) => {
    const rid = (req.headers["x-request-id"] as string) || randomUUID();
    // @ts-ignore attach for downstream logs if you need it
    req.requestId = rid;
    done();
  });
};
