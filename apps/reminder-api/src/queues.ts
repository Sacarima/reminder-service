// Creates BullMQ queue instances with Redis from REDIS_URL.
import { Queue } from "bullmq";
import Redis from "ioredis";
import { env } from "./config.js";
import { QUEUE_EMAIL, QUEUE_SMS } from "@reminder/shared";

const connection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const emailQueue = new Queue(QUEUE_EMAIL, { connection });
export const smsQueue = new Queue(QUEUE_SMS, { connection });
