import type { ReminderJob } from "@reminder/shared";

//Minimal template; you can swap to Handlebars later if needed.
export function renderReminderEmail(job: ReminderJob) {
  const subject =
    job.slotKind === "T_MINUS_2H"
      ? "Appointment reminder (in ~2 hours)"
      : "Appointment reminder (tomorrow)";
  const lines = [
    "Hello,",
    "",
    job.slotKind === "T_MINUS_2H"
      ? "This is a reminder: your appointment is in about 2 hours."
      : "This is a reminder: your appointment is tomorrow.",
    "",
    `Clinic: ${job.clinicId}`,
    `Planned send time (local): ${job.plannedLocal}`,
    "",
    "If you need to reschedule, please contact the clinic.",
  ];
  return {
    subject,
    text: lines.join("\n"),
    html: lines.map((l) => `<p>${l || "&nbsp;"}</p>`).join(""),
  };
}
