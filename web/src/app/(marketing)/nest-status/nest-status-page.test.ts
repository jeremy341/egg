import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OFFICIAL_NOTE, SCOPE_NOTE } from "./copy";
import { NestStatusView, formatMs, lastCheckText } from "./_components/view";
import type { NestStatus, TargetStatus } from "@/server/nest-status";

const DAY = 86_400_000;
const now = new Date("2026-11-09T12:00:00Z");

function days(states: Array<"up" | "partial" | "down" | "none"> = []) {
  return Array.from({ length: 30 }, (_, i) => ({
    day: new Date(now.getTime() - (29 - i) * DAY).toISOString().slice(0, 10),
    state: states[i] ?? "none",
    downMinutes: states[i] === "partial" ? 30 : states[i] === "down" ? 1200 : 0,
  }));
}

function target(over: Partial<TargetStatus> & Pick<TargetStatus, "id" | "label">): TargetStatus {
  return {
    url: null,
    state: "up",
    httpStatus: 200,
    latencyMs: 300,
    checkedAt: "2026-11-09T11:59:00.000Z",
    median24hMs: 310,
    median30dMs: 320,
    days: days(Array(30).fill("up")),
    ...over,
  };
}

function status(over: Partial<NestStatus> = {}): NestStatus {
  return {
    overall: { state: "ok", text: "Nest and Egg are working" },
    targets: [
      target({ id: "nest-site", label: "Nest website", url: "https://nest.hackclub.com" }),
      target({ id: "nest-app", label: "Nest sign-in and app host", url: "https://hackclub.app" }),
      target({ id: "egg", label: "Egg", httpStatus: null, latencyMs: 2 }),
    ],
    official: { available: true, summary: "Partial System Outage", statusClass: "bg-down", readAt: "2026-11-09T11:59:30.000Z", url: "https://status.hackclub.app" },
    checkedFrom: "egg.example.test",
    lastCheckAt: "2026-11-09T11:59:00.000Z",
    windowDays: 30,
    intervalSeconds: 60,
    ...over,
  };
}

/** The visible text of the markup, so a sentence split by a link or an entity still reads whole. */
function textOf(html: string) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&rsquo;|&#8217;/g, "’")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

const render = (s: NestStatus) => textOf(renderToStaticMarkup(createElement(NestStatusView, { status: s })));

describe("the honest-labelling text", () => {
  it("pins the wording", () => {
    expect(SCOPE_NOTE).toBe(
      "These checks run from Egg's server. They show whether Egg can reach Nest, not whether every Nest container is running."
    );
    expect(OFFICIAL_NOTE).toBe("The official status is Hack Club's. For the official page, see status.hackclub.app.");
  });

  it("is on the page with data, with a partial strip, with a down period and with no data", () => {
    const partial = status({
      overall: { state: "degraded", text: "Nest is slow or partly down" },
      targets: [
        target({ id: "nest-site", label: "Nest website", state: "slow", days: days(["up", "partial", "up"]) }),
        target({ id: "nest-app", label: "Nest sign-in and app host", state: "down", httpStatus: 503, days: days(["up", "down"]) }),
        target({ id: "egg", label: "Egg" }),
      ],
    });
    const empty = status({
      overall: { state: "unknown", text: "No recent checks yet" },
      lastCheckAt: null,
      targets: ["nest-site", "nest-app", "egg"].map((id) =>
        target({ id: id as TargetStatus["id"], label: id, state: "unknown", httpStatus: null, latencyMs: null, checkedAt: null, median24hMs: null, median30dMs: null, days: days() })
      ),
    });
    for (const s of [status(), partial, empty]) {
      const text = render(s);
      expect(text).toContain(SCOPE_NOTE);
      expect(text).toContain(OFFICIAL_NOTE);
    }
  });

  it("shows when the last check ran and where it ran from", () => {
    const text = render(status());
    expect(text).toContain("Last checked 9 Nov 2026, 11:59 UTC, from the Egg server at egg.example.test.");
  });

  it("says no check has run yet instead of a time when there is none", () => {
    const text = render(status({ lastCheckAt: null }));
    expect(text).toContain("No check has been recorded yet.");
    expect(text).toContain("egg.example.test");
  });
});

describe("the official status", () => {
  it("shows Hack Club's summary with its own label and a link, apart from Egg's line", () => {
    const html = renderToStaticMarkup(createElement(NestStatusView, { status: status() }));
    const text = textOf(html);
    expect(text).toContain("Hack Club’s official Nest status");
    expect(text).toContain("Partial System Outage");
    expect(text).toContain("Nest and Egg are working");
    expect(html).toContain('href="https://status.hackclub.app"');
  });

  it("says unavailable and still links to the page when the summary could not be read", () => {
    const html = renderToStaticMarkup(
      createElement(NestStatusView, {
        status: status({ official: { available: false, readAt: "2026-11-09T11:59:30.000Z", url: "https://status.hackclub.app" } }),
      })
    );
    expect(textOf(html)).toContain("Official status unavailable");
    expect(html).toContain('href="https://status.hackclub.app"');
  });

  it("never claims to be Hack Club's page", () => {
    const text = render(status());
    expect(text).not.toMatch(/we are hack club|official hack club status page of egg/i);
    expect(text).not.toContain("status.hackclub.com");
  });
});

describe("the targets", () => {
  it("shows each target, its strip and the same days as text", () => {
    const html = renderToStaticMarkup(createElement(NestStatusView, { status: status() }));
    const text = textOf(html);
    for (const label of ["Nest website", "Nest sign-in and app host", "Egg"]) expect(text).toContain(label);
    expect(text).toContain("HTTP 200 in 300 ms");
    expect(text).toContain("The database answered in 2 ms");
    expect(html.match(/role="img"/g)).toHaveLength(3);
    expect(text).toContain("Show each day as text");
    expect(text).toContain("Answered all day");
  });

  it("describes a down target and the last check in words", () => {
    const t = target({ id: "nest-app", label: "x", state: "down", httpStatus: null, latencyMs: null });
    expect(lastCheckText(t)).toBe("No reply");
    expect(lastCheckText({ ...t, httpStatus: 503 })).toBe("HTTP 503");
    expect(lastCheckText({ ...t, id: "egg" })).toBe("The database did not answer");
    expect(lastCheckText({ ...t, checkedAt: null })).toBe("No check has run yet");
  });

  it("writes times in plain units", () => {
    expect(formatMs(312)).toBe("312 ms");
    expect(formatMs(2400)).toBe("2.4 s");
  });
});
