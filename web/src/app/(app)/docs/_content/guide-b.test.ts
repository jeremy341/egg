import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DOCS_SECTIONS } from "../_data/nav";
import { CONTENT } from "./index";

/**
 * The reference pages in guide-b and the heading ids each one must carry.
 * `steps` is matched as an id ending in "steps", `example` as an id that
 * starts with the name, because a page may have more than one of either.
 */
const PAGES: { id: string; limits: string | null; wrong: string; example: string; steps: boolean; source: boolean }[] = [
  { id: "security", limits: "security-limits", wrong: "security-wrong", example: "security-example", steps: true, source: true },
  { id: "activity", limits: "activity-limits", wrong: "activity-wrong", example: "activity-example", steps: true, source: true },
  { id: "account", limits: "account-limits", wrong: "account-wrong", example: "account-example", steps: true, source: true },
  { id: "container", limits: "container-limits", wrong: "container-wrong", example: "container-example", steps: true, source: true },
  { id: "limits", limits: null, wrong: "limits-wrong", example: "limits-example", steps: false, source: false },
  { id: "selfhost", limits: "selfhost-limits", wrong: "selfhost-wrong", example: "selfhost-example", steps: true, source: true },
  { id: "troubleshooting", limits: null, wrong: "troubleshooting-connection", example: "troubleshooting-example", steps: false, source: false },
  { id: "api", limits: "api-rates", wrong: "api-wrong", example: "api-example", steps: true, source: true },
];

const BANNED = /powerful|seamless|effortless|unlock|supercharge|journey|elevate|built for|revolutioni[sz]e|streamline/i;

function html(id: string): string {
  const Page = CONTENT[id];
  return renderToStaticMarkup(createElement(() => Page()));
}

describe("reference guide pages", () => {
  for (const page of PAGES) {
    describe(page.id, () => {
      const out = html(page.id);

      it("has steps, limits, what can go wrong and a worked example where the page needs them", () => {
        if (page.steps) expect(out, "steps").toMatch(/id="[a-z0-9-]*steps"/);
        if (page.limits) expect(out, page.limits).toContain(`id="${page.limits}"`);
        expect(out, page.wrong).toContain(`id="${page.wrong}"`);
        expect(out, page.example).toContain(`id="${page.example}`);
      });

      it("says why it works this way", () => {
        expect(out).toContain("Why it works this way");
      });

      if (page.source) {
        it("names the file that holds each limit", () => {
          expect(out).toContain("In the code:");
        });
      }

      it("uses no em or en dashes, no banned words and the name Egg", () => {
        expect(out).not.toMatch(/[–—]/);
        expect(out).not.toMatch(BANNED);
        expect(out).not.toMatch(/Nest Deploy/);
      });

      it("uses each heading id once", () => {
        const ids = [...out.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
        const repeated = ids.filter((x, i) => ids.indexOf(x) !== i);
        expect(repeated).toEqual([]);
      });

      it("links only to docs pages that exist", () => {
        const known = new Set(DOCS_SECTIONS.map((s) => s.id));
        const targets = [...out.matchAll(/href="\/docs\/([a-z-]+)/g)].map((m) => m[1]);
        expect(targets.filter((t) => !known.has(t))).toEqual([]);
      });
    });
  }
});

describe("build memory facts", () => {
  const container = html("container");
  it("gives the default and the range on the container page", () => {
    expect(container).toContain("2048 MB");
    expect(container).toContain("512 MB");
    expect(container).toContain("8192 MB");
  });
  it("says build memory is per server", () => {
    expect(container).toMatch(/belongs to the server/);
  });
});

describe("disconnect and local mode facts", () => {
  it("says disconnect keeps projects by default and asks before deleting them", () => {
    const out = html("security");
    expect(out).toContain("Left unticked, which is the default, the projects are kept");
    expect(out).toContain("Also delete the N projects on this server");
  });
  it("says local mode is LOCAL_MODE=1 and off by default", () => {
    const out = html("selfhost");
    expect(out).toContain("LOCAL_MODE");
    expect(out).toMatch(/Off by default/);
  });
});
