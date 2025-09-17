import nodemailer, { type SentMessageInfo } from "nodemailer";
import { env } from "../config.js";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

// Reusable SMTP transport
let transport: nodemailer.Transporter<SentMessageInfo> | null = null;

function getTransport() {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false, // MailHog on 1025 is plaintext
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
      : undefined,
  });
  return transport;
}

export async function sendEmail(msg: EmailMessage): Promise<string> {
  const t = getTransport();
  const info = await t.sendMail({
    from: env.FROM_EMAIL,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
  return info.messageId || "smtp-no-id";
}
