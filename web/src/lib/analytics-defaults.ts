/**
 * The analytics features a person can have on from the start. Pure, so the
 * server, the settings page and the tests read the same list.
 *
 * "Speed and errors" is one switch for web vitals and script errors together.
 */

/** Said wherever retention is switched on or shown, word for word. */
export const RETENTION_NOTICE = "This stores a random id in the visitor's browser, not a cookie. Turn it off to stop.";

export const ANALYTICS_FEATURES = [
  "clicks",
  "time",
  "funnel",
  "referrers",
  "vitals",
  "events",
  "live",
  "retention",
] as const;

export type AnalyticsFeatureKey = (typeof ANALYTICS_FEATURES)[number];

/** The switches a person has turned on. A key that is missing is off, and `{}` is everything off. */
export type AnalyticsDefaults = Partial<Record<AnalyticsFeatureKey, boolean>>;

export const ANALYTICS_FEATURE_LABELS: Record<AnalyticsFeatureKey, { title: string; sentence: string }> = {
  clicks: { title: "Clicks", sentence: "The label of each link or button a visitor clicks." },
  time: { title: "Time on page", sentence: "How long a page was open, as one of four ranges." },
  funnel: {
    title: "Funnel",
    sentence: "Counts visitors through the steps you list. It does nothing until a project has two steps.",
  },
  referrers: { title: "Referrers", sentence: "The referring site's host. Campaigns have their own switch and list of allowed values, set per project." },
  vitals: { title: "Speed and errors", sentence: "Page speed measurements and JavaScript error messages." },
  events: { title: "Custom events", sentence: "Clicks on elements you mark with data-egg-track, with an optional value." },
  live: { title: "Live view", sentence: "Who is on the site in the last 5 minutes. Unique visitors also need retention." },
  retention: {
    title: "Retention",
    sentence: "Returning visitors, using a random id in the visitor's browser. Not a cookie.",
  },
};

/** Read a stored value, ignoring anything that is not one of the known switches set to true. */
export function parseAnalyticsDefaults(raw: unknown): AnalyticsDefaults {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: AnalyticsDefaults = {};
  for (const key of ANALYTICS_FEATURES) if ((value as Record<string, unknown>)[key] === true) out[key] = true;
  return out;
}

/** The text stored for a set of defaults: only the switches that are on, in a fixed order. */
export function serializeAnalyticsDefaults(d: AnalyticsDefaults): string {
  return JSON.stringify(parseAnalyticsDefaults(d));
}
