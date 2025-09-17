import { DateTime } from "luxon";
import type { SlotKind, PlanStatus, WindowRule } from "./types";

// export type SlotKind = "T_MINUS_24H" | "T_MINUS_2H";
// export type PlanStatus = "scheduled" | "expired";
// export type WindowRule =
//   | "within_window"
//   | "before_window→clamped_to_10:00_same_day"
//   | "after_window→clamped_to_10:00_next_day";

type PlannedSlot = {
  slotKind: SlotKind;
  plannedLocalISO: string; // always string (never null)
  plannedUTCISO: string; // always string (never null)
  status: PlanStatus;
  windowRule: WindowRule;
};

type PlanInput = {
  startAtISO: string;
  patientTZ: string;
  nowUTC?: Date;
  quietStart?: string; // "HH:mm"
  quietEnd?: string; // "HH:mm"
};

function clampToWindow(
  local: DateTime,
  startHHMM = "10:00",
  endHHMM = "19:00",
) {
  const [sH, sM] = startHHMM.split(":").map(Number);
  const [eH, eM] = endHHMM.split(":").map(Number);

  const startOfWindow = local.set({
    hour: sH,
    minute: sM,
    second: 0,
    millisecond: 0,
  });
  const endOfWindow = local.set({
    hour: eH,
    minute: eM,
    second: 0,
    millisecond: 0,
  });

  if (local < startOfWindow) {
    return {
      clamped: startOfWindow,
      rule: "before_window→clamped_to_10:00_same_day" as const,
    };
  }
  if (local > endOfWindow) {
    return {
      clamped: startOfWindow.plus({ days: 1 }),
      rule: "after_window→clamped_to_10:00_next_day" as const,
    };
  }
  return { clamped: local, rule: "within_window" as const };
}

export function planSlots(input: PlanInput): PlannedSlot[] {
  const now = input.nowUTC
    ? DateTime.fromJSDate(input.nowUTC).toUTC()
    : DateTime.utc();

  const startLocal = DateTime.fromISO(input.startAtISO, {
    setZone: true,
  }).setZone(input.patientTZ);
  if (!startLocal.isValid) {
    throw new Error(
      `Invalid startAt (${input.startAtISO}) for TZ ${input.patientTZ}: ${startLocal.invalidReason}`,
    );
  }

  const targets: { slotKind: SlotKind; targetLocal: DateTime }[] = [
    { slotKind: "T_MINUS_24H", targetLocal: startLocal.minus({ hours: 24 }) },
    { slotKind: "T_MINUS_2H", targetLocal: startLocal.minus({ hours: 2 }) },
  ];

  return targets.map(({ slotKind, targetLocal }) => {
    const { clamped, rule } = clampToWindow(
      targetLocal,
      input.quietStart ?? "10:00",
      input.quietEnd ?? "19:00",
    );

    if (!clamped.isValid) {
      throw new Error(`Invalid clamped time: ${clamped.invalidReason}`);
    }

    // Compare timestamps, not objects
    const expiredByStart = clamped.toMillis() >= startLocal.toMillis();

    // Convert to UTC; guard + compare timestamps
    const plannedUTC = clamped.setZone("utc");
    if (!plannedUTC.isValid) {
      throw new Error(`Invalid plannedUTC: ${plannedUTC.invalidReason}`);
    }
    const expiredByNow = plannedUTC.toMillis() <= now.toMillis();

    const status: PlanStatus =
      expiredByStart || expiredByNow ? "expired" : "scheduled";

    //  Non-null assertion because we validated isValid above
    const plannedLocalISO = clamped.toISO({ suppressMilliseconds: true })!;
    const plannedUTCISO = plannedUTC.toISO({ suppressMilliseconds: true })!;

    return {
      slotKind,
      plannedLocalISO,
      plannedUTCISO,
      status,
      windowRule: rule,
    };
  });
}

export type { PlannedSlot };
