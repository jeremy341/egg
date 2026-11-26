import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { standingNotice, type AccountStanding } from "@/server/account-standing";
import { StandingBanner } from "@/components/standing-banner";

const END = new Date("2026-11-16T12:00:00.000Z");

function markup(standing: AccountStanding): string | null {
  const notice = standingNotice(standing);
  return notice ? renderToStaticMarkup(createElement(StandingBanner, { notice })) : null;
}

describe("suspension banner", () => {
  it("shows nothing for an active account", () => {
    expect(markup({ state: "active" })).toBeNull();
  });

  it("tells a graced account its end date and that everything still works until then", () => {
    const html = markup({ state: "grace", graceEndsAt: END });
    expect(html).toContain("Your account is suspended");
    expect(html).toContain("Everything keeps working until Nov 16, 2026");
    expect(html).toContain("view and export your data");
  });

  it("says writes are blocked once the grace period has ended", () => {
    const html = markup({ state: "blocked", graceEndsAt: END });
    expect(html).toContain("The grace period ended on Nov 16, 2026");
    expect(html).toContain("API writes are blocked");
    expect(html).not.toContain("keeps working until");
  });
});
