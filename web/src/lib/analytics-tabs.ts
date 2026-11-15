/** The tabs of the project analytics page, in order. */
export const ANALYTICS_TABS = [
  { value: "overview", label: "Overview" },
  { value: "speed", label: "Speed and errors" },
  { value: "events", label: "Events" },
  { value: "visitors", label: "Visitors" },
  { value: "setup", label: "Setup" },
] as const;

export type AnalyticsTab = (typeof ANALYTICS_TABS)[number]["value"];

/** The tab named by `?tab=`. Anything missing or unknown is the Overview. */
export function parseTab(raw: string | string[] | undefined): AnalyticsTab {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return ANALYTICS_TABS.find((t) => t.value === value)?.value ?? "overview";
}
