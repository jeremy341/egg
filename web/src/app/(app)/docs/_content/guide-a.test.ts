import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CONTENT } from "./index";

/** The guide pages that carry the full set of blocks. */
const DETAILED = [
  "quickstart",
  "servers",
  "projects",
  "deployments",
  "env",
  "logs",
  "domains",
  "github",
  "hooks",
  "jobs",
  "notifications",
] as const;

const BANNED = /powerful|seamless|effortless|unlock|supercharge|journey|elevate|built for|revolutioni[sz]e|streamline/i;

function html(id: string): string {
  const Page = CONTENT[id];
  return renderToStaticMarkup(createElement(() => Page()));
}

describe("detailed guide pages", () => {
  for (const id of DETAILED) {
    describe(id, () => {
      const out = html(id);

      it("has steps, limits, what can go wrong and a worked example", () => {
        for (const part of ["steps", "limits", "wrong", "example"]) {
          expect(out, `${id}-${part}`).toContain(`id="${id}-${part}"`);
        }
      });

      it("says why it works this way", () => {
        expect(out).toContain("Why it works this way");
      });

      it("names the file that holds each limit", () => {
        expect(out).toContain("In the code:");
      });

      it("uses no em or en dashes and no banned words", () => {
        expect(out).not.toMatch(/[–—]/);
        expect(out).not.toMatch(BANNED);
      });
    });
  }
});

/** Labels the monitoring, status page and analytics guides quote, as the real pages print them. */
const ON_SCREEN: Record<string, string[]> = {
  monitoring: [
    "Check now",
    "Restart the service?",
    "Pause all alerts",
    "Resume alerts",
    "Alerts are paused",
    "Alert settings saved",
    "Send to the webhook",
    "Slow response limit (ms)",
    "Resource use",
    "Not sent, paused",
  ],
  "status-page": [
    "Public Status Page",
    "Publish status page",
    "Status page URL",
    "Unpublish",
    "Recent outages",
    "Answered all day",
    "Down for part of a day",
    "Down for most of a day",
    "No checks yet",
    "Show each day as text",
  ],
  analytics: [
    "Count visits",
    "Turn on analytics",
    "Tracking snippet",
    "Turn off",
    "What else to record",
    "Page views per day",
    "Where visitors came from",
    "Top clicks",
    "Add step",
    "Save steps",
    "Nothing counted yet",
  ],
};

describe("on-screen labels in the monitoring, status page and analytics guides", () => {
  for (const [id, labels] of Object.entries(ON_SCREEN)) {
    it(`${id} quotes the labels the pages print`, () => {
      const out = html(id).replace(/&#x27;|&quot;/g, '"');
      for (const label of labels) expect(out, `${id}: ${label}`).toContain(label);
    });
  }

  it("does not quote labels the pages no longer have", () => {
    const out = ["monitoring", "status-page", "analytics"].map(html).join("\n");
    expect(out).not.toContain("must be at least 50 ms");
    expect(out).not.toContain("Failed checks must be a whole number");
  });
});
