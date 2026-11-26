import type { StripDay } from "@/server/status-page";

/** One colour per kind of day. The legend and the strip both read from here, so they cannot drift. */
export const STRIP_TONE = {
  up: "bg-ready",
  partial: "bg-[var(--status-building)]",
  down: "bg-[var(--status-error)]",
  none: "bg-muted",
} as const satisfies Record<StripDay["state"], string>;

/** Legend order: the good day first, then worse, then no data. */
export const STRIP_LEGEND: { state: StripDay["state"]; label: string }[] = [
  { state: "up", label: "Answered all day" },
  { state: "partial", label: "Down for part of a day" },
  { state: "down", label: "Down for most of a day" },
  { state: "none", label: "No checks yet" },
];

export function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Whole minutes as "45 min" or "3 h 20 min". */
export function minutes(m: number): string {
  if (m < 60) return `${m} min`;
  return m % 60 === 0 ? `${m / 60} h` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** What happened on one day, in words. */
export function dayDetail(d: StripDay): string {
  if (d.state === "none") return "No checks yet";
  if (d.state === "up") return "Answered all day";
  if (d.state === "partial") return `Down for ${minutes(d.downMinutes)}`;
  return `Down for most of the day, ${minutes(d.downMinutes)}`;
}

/** The strip in words, for screen readers: counts of each kind of day. */
export function stripSummary(days: StripDay[], windowDays: number): string {
  const count = (s: StripDay["state"]) => days.filter((d) => d.state === s).length;
  const none = count("none");
  return `Last ${windowDays} days: ${count("up")} answered all day, ${count("partial")} down for part of the day, ${count("down")} down for most of the day${none ? `, ${none} with no checks yet` : ""}.`;
}
