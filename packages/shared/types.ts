// Single source of truth for domain enums/types
export type SlotKind = "T_MINUS_24H" | "T_MINUS_2H";
export type PlanStatus = "scheduled" | "expired";
export type WindowRule =
  | "within_window"
  | "before_window→clamped_to_10:00_same_day"
  | "after_window→clamped_to_10:00_next_day";

export type Channel = "email" | "sms";
