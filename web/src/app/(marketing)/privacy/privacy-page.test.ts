import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { featuresPatch, NO_FEATURES } from "@/server/analytics-config";
import { UTM_ALLOWLIST_MAX, UTM_ALLOWLIST_VALUE } from "@/server/analytics-fields";
import PrivacyPage from "./page";

/** The page as a reader sees it: no tags, one space between words. */
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

describe("public privacy page", () => {
  it("explains its scope and states that it is not a legal or security guarantee", () => {
    const html = renderToStaticMarkup(createElement(PrivacyPage));
    expect(html).toContain("not legal advice");
    expect(html).toContain("not a certification or guarantee");
    expect(html).toContain("If you use someone else’s Egg instance");
    expect(html).toContain("If you run Egg yourself");
  });

  it("covers the actual analytics defaults and visitor-side limitations", () => {
    const html = renderToStaticMarkup(createElement(PrivacyPage));
    expect(html).toContain("data-egg-path");
    expect(html).toContain("Do Not Track");
    expect(html).toContain("Global Privacy Control");
    expect(html).toContain("Exception messages are not collected");
    expect(html).toContain("pseudonymous identifier");
    expect(html).toContain("personal value or secret into it");
  });

  it("describes retention, backups, and data left on Nest after account deletion", () => {
    const html = renderToStaticMarkup(createElement(PrivacyPage));
    expect(html).toContain("30, 60 or 90 days");
    expect(html).toContain("a project keeps 90 days until it is changed");
    expect(html).toContain("exact end of the period");
    expect(html).toContain("Backups can retain older database copies");
    expect(html).toContain("does not delete services, releases, environment files");
    expect(html).toContain("replay-prevention digests");
  });

  it("says campaign values are recorded only when Campaigns is on and only if they are on the allowlist", () => {
    const t = plain(renderToStaticMarkup(createElement(PrivacyPage)));
    expect(NO_FEATURES.campaigns).toBe(false);
    expect(UTM_ALLOWLIST_MAX).toBe(20);
    expect(UTM_ALLOWLIST_VALUE.test("a".repeat(40)) && !UTM_ALLOWLIST_VALUE.test("a".repeat(41))).toBe(true);
    expect(t).toContain("Referrers store only the referring host.");
    expect(t).toContain("Campaigns is a separate switch, off by default.");
    expect(t).toContain("only when the value exactly matches one the site owner has listed for that project (up to 20 values for each, 40 characters at most)");
    expect(t).toContain("any other value is dropped before it is stored");
    expect(t).not.toContain("Referrers and campaigns");
    expect(t).not.toContain("up to 80 characters");
  });

  it("gives the retention choices the server accepts", () => {
    for (const days of [30, 60, 90]) expect(featuresPatch.safeParse({ retentionDays: days }).success).toBe(true);
    expect(featuresPatch.safeParse({ retentionDays: 45 }).success).toBe(false);
    expect(NO_FEATURES.retentionDays).toBe(90);
  });

  it("says which switches delete what they stored when turned off", () => {
    const t = plain(renderToStaticMarkup(createElement(PrivacyPage)));
    expect(t).toContain("Turning Referrers, Campaigns, Retention or Record visitor countries off deletes what that switch stored for the project");
    expect(t).toContain("what they already stored stays until it ages out");
  });

  it("describes visitor countries as the code does and carries the database credit", () => {
    const t = plain(renderToStaticMarkup(createElement(PrivacyPage)));
    expect(NO_FEATURES.locations).toBe(false);
    expect(t).toContain("Record visitor countries is off by default");
    expect(t).toContain("country database bundled with Egg during the same request");
    expect(t).toContain("Only the two-letter country code, such as FR, is stored");
    expect(t).toContain("Egg does not store or log the IP address for this");
    expect(t).toContain("This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com.");
    // The paragraph on request data says the address is also used for the lookup, only while the switch is on.
    expect(t).toContain("Only when Record visitor countries is on is the IP address also used for one country lookup");
  });

  it("is reachable from the marketing footer", async () => {
    const { readFile } = await import("node:fs/promises");
    const layout = await readFile(new URL("../layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain('href="/privacy"');
    expect(layout).toContain("Privacy and data use");
  });
});
