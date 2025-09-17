// Shared job payload type + helpers for both API and worker.
import type { SlotKind, Channel } from "./types";

export interface ReminderJob {
  jobKey: string; // reminder:{apt}:{slotKind}:{version}
  appointmentId: string;
  slotKind: SlotKind;
  version: number;
  clinicId: string;
  channel: Channel;
  recipient: { email?: string; phoneE164?: string };
  patientTZ: string;
  plannedLocal: string; // ISO without ms
  plannedUTC: string; // ISO Z without ms
  trace?: { requestId?: string };
}

export const QUEUE_EMAIL = "deliver_email";
export const QUEUE_SMS = "deliver_sms";

export function jobKeyFrom(
  appointmentId: string,
  slotKind: SlotKind,
  version: number,
) {
  return `reminder:${appointmentId}:${slotKind}:${version}`;
}

export function priorityFor(slotKind: SlotKind) {
  // Lower number = higher priority in BullMQ
  return slotKind === "T_MINUS_2H" ? 5 : 10;
}
