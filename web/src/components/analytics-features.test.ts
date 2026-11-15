import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UTM_ALLOWLIST_MAX, UTM_ALLOWLIST_VALUE } from "@/server/analytics-fields";
import {
  ALLOWLIST_RULE,
  AnalyticsFeatures,
  RECORDS,
  RETENTION_CHOICES,
  UTM_FIELDS,
  addAllowedValue,
  type Features,
} from "./analytics-features";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const off: Features = {
  clicks: false,
  time: false,
  funnel: false,
  steps: [],
  referrers: false,
  campaigns: false,
  utmAllowlist: { source: [], medium: [], campaign: [] },
  retentionDays: 90,
  vitals: false,
  events: false,
  live: false,
  retention: false,
  locations: false,
};

const render = (features: Partial<Features> = {}) =>
  renderToStaticMarkup(createElement(AnalyticsFeatures, { projectId: "p1", initial: { ...off, ...features } }));
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
/** The opening tag of the element with this id. */
const tag = (html: string, id: string) => html.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? "";

describe("the analytics switches on the Setup tab", () => {
  it("has a Referrers switch and a Campaigns switch, and no combined one", () => {
    const html = render();
    const t = text(html);
    expect(tag(html, "analytics-referrers")).toContain('type="checkbox"');
    expect(tag(html, "analytics-campaigns")).toContain('type="checkbox"');
    expect(html).toMatch(/<span class="block">Referrers<\/span>/);
    expect(html).toMatch(/<span class="block">Campaigns<\/span>/);
    expect(t).not.toContain("Referrers and campaigns");
  });

  it("keeps the Record visitor countries switch beside them, built the same way", () => {
    const html = render();
    expect(html).toMatch(/<span class="block">Record visitor countries<\/span>/);
    expect(tag(html, "analytics-locations")).toContain('type="checkbox"');
    expect(tag(html, "analytics-locations")).not.toContain("checked");
  });

  it("starts with Referrers and Campaigns off, and shows each as on when it is", () => {
    const html = render();
    expect(tag(html, "analytics-referrers")).not.toContain("checked");
    expect(tag(html, "analytics-campaigns")).not.toContain("checked");
    const on = render({ referrers: true, campaigns: true, utmAllowlist: { source: ["x"], medium: [], campaign: [] } });
    expect(tag(on, "analytics-referrers")).toContain("checked");
    expect(tag(on, "analytics-campaigns")).toContain("checked");
    // One does not follow the other.
    const referrersOnly = render({ referrers: true });
    expect(tag(referrersOnly, "analytics-referrers")).toContain("checked");
    expect(tag(referrersOnly, "analytics-campaigns")).not.toContain("checked");
  });

  it("says each of these switches deletes what it stored when it is turned off", () => {
    expect(RECORDS.referrers).toContain("Turning it off deletes the referrers already stored.");
    expect(RECORDS.campaigns).toContain("Turning it off deletes the campaign values already stored.");
    expect(RECORDS.locations).toContain("Turning it off deletes the countries already stored.");
    expect(RECORDS.retention).toContain("Turning it off deletes the codes already stored.");
    const t = text(render());
    expect(t).toContain(RECORDS.referrers);
    expect(t).toContain(RECORDS.campaigns);
  });

  it("says only listed campaign values are recorded and anything else is dropped", () => {
    const t = text(render());
    expect(t).toContain("Only the values listed here are recorded; anything else in the address is dropped.");
    expect(RECORDS.campaigns).toContain("only the values you list below, matched exactly");
    expect(RECORDS.campaigns).toContain("Any other value is dropped and never stored.");
  });
});

describe("the campaign allowlist editor", () => {
  it("has a list for source, medium and campaign, each with a field and an Add button", () => {
    const html = render();
    expect(UTM_FIELDS.map((f) => f.key)).toEqual(["source", "medium", "campaign"]);
    for (const f of UTM_FIELDS) {
      expect(html).toContain(`aria-label="Add a ${f.label.toLowerCase()} value"`);
      expect(text(html)).toContain(`${f.label} (from ${f.param})`);
    }
    expect(html.match(/<form /g)).toHaveLength(3);
    expect(html.match(/>\s*Add\s*<\/button>/g)).toHaveLength(3);
    expect(text(html)).toContain("None listed.");
  });

  it("states the limits the server enforces", () => {
    expect(UTM_ALLOWLIST_MAX).toBe(20);
    expect(ALLOWLIST_RULE).toContain("Up to 20 values");
    expect(ALLOWLIST_RULE).toContain("40 characters at most");
    expect(ALLOWLIST_RULE).toContain("letters, numbers, dot, dash or underscore");
    expect(ALLOWLIST_RULE).toContain("capital letters included");
    expect(text(render())).toContain(ALLOWLIST_RULE);
    expect(render()).toContain('maxLength="40"');
  });

  it("lists the saved values, each with a Remove button that names it", () => {
    const html = render({
      campaigns: true,
      utmAllowlist: { source: ["newsletter", "x"], medium: ["email"], campaign: ["spring-26"] },
    });
    for (const v of ["newsletter", "x", "email", "spring-26"]) expect(html).toContain(`<code class="font-mono">${v}</code>`);
    expect(html).toContain('aria-label="Remove source value newsletter"');
    expect(html).toContain('aria-label="Remove medium value email"');
    expect(html).toContain('aria-label="Remove campaign value spring-26"');
    expect(html).toContain('aria-label="Allowed source values"');
  });

  it("cannot turn Campaigns on until one value is saved, and says so", () => {
    const empty = render();
    expect(tag(empty, "analytics-campaigns")).toContain("disabled");
    expect(text(empty)).toContain("Save at least one value to be able to turn Campaigns on.");
    const withValue = render({ utmAllowlist: { source: ["newsletter"], medium: [], campaign: [] } });
    expect(tag(withValue, "analytics-campaigns")).not.toContain("disabled");
    expect(text(withValue)).not.toContain("Save at least one value");
  });

  it("lets a project that has Campaigns on turn it off", () => {
    const html = render({ campaigns: true, utmAllowlist: { source: ["x"], medium: [], campaign: [] } });
    expect(tag(html, "analytics-campaigns")).not.toContain("disabled");
    expect(text(html)).toContain("Save allowed values");
  });

  it("leaves Save disabled until a value changes", () => {
    const html = render({ utmAllowlist: { source: ["x"], medium: [], campaign: [] } });
    expect(html).toMatch(/<button[^>]*disabled[^>]*>\s*Save allowed values/);
  });
});

describe("adding an allowlist value", () => {
  it("trims it and adds it at the end", () => {
    expect(addAllowedValue(["a"], "  spring-26 ")).toEqual({ list: ["a", "spring-26"] });
  });

  it("follows the rule the server uses, for every value it allows and refuses", () => {
    for (const ok of ["a", "Newsletter", "spring-26", "utm.source_1", "a".repeat(40)]) {
      expect(UTM_ALLOWLIST_VALUE.test(ok)).toBe(true);
      expect(addAllowedValue([], ok)).toEqual({ list: [ok] });
    }
    for (const bad of ["", "   ", "-x", "has space", "a/b", "é", "a".repeat(41), "x?y=1", "a@b.com"]) {
      expect(addAllowedValue([], bad), bad).toHaveProperty("error");
    }
  });

  it("refuses a value that is already listed, matching exactly, capitals included", () => {
    expect(addAllowedValue(["email"], "email")).toEqual({ error: "email is already on the list." });
    expect(addAllowedValue(["email"], "Email")).toEqual({ list: ["email", "Email"] });
  });

  it("refuses a twenty-first value", () => {
    const full = Array.from({ length: UTM_ALLOWLIST_MAX }, (_, i) => `v${i}`);
    expect(addAllowedValue(full, "one-more")).toEqual({ error: "A list holds at most 20 values." });
    expect(addAllowedValue(full.slice(1), "one-more")).toHaveProperty("list");
  });
});

describe("how long the numbers are kept", () => {
  it("offers 30, 60 and 90 days with the saved one selected", () => {
    expect([...RETENTION_CHOICES]).toEqual([30, 60, 90]);
    for (const days of [30, 60, 90] as const) {
      const html = render({ retentionDays: days });
      expect(html.match(/<option /g)?.length).toBeGreaterThanOrEqual(3);
      const select = html.slice(html.indexOf('id="analytics-keep"'));
      expect(select).toContain(`<option value="${days}" selected="">${days} days</option>`);
      for (const other of [30, 60, 90].filter((d) => d !== days)) {
        expect(select).toContain(`<option value="${other}">${other} days</option>`);
      }
    }
    expect(text(render())).toContain("Keep the numbers for");
    expect(RECORDS.keep).toContain("New projects keep 90 days.");
  });
});
