import { describe, expect, it } from "vitest";
import { findTargets, hasOwnCreateButton, navFor } from "@/lib/nav";

const PATHS = [
  "/projects",
  "/deployments",
  "/logs",
  "/resources",
  "/domains",
  "/activity",
  "/container",
  "/developer",
  "/connect",
  "/docs",
  "/docs/quickstart",
  "/account",
  "/projects/demo/deployments",
  "/projects/demo/deployments/abc12345",
  "/projects/demo/analytics",
  "/projects/demo/files",
  "/projects/demo/terminal",
  "/projects/demo/settings",
];

describe("page titles", () => {
  it("are sentence case: only the first word is capitalised", () => {
    for (const path of PATHS) {
      const { title, backLabel } = navFor(path);
      for (const text of [title, backLabel]) {
        if (!text) continue;
        const rest = text.split(" ").slice(1);
        expect(rest.filter((w) => /^[A-Z][a-z]/.test(w)), `${path}: ${text}`).toEqual([]);
      }
    }
  });

  it("titles the docs pages Docs and keeps them in the Find palette", () => {
    expect(navFor("/docs").title).toBe("Docs");
    expect(navFor("/docs/quickstart").title).toBe("Docs");
    expect(findTargets([]).some((t) => t.href === "/docs" && t.label === "Docs")).toBe(true);
  });

  it("names the connect page the way the sidebar and the page do", () => {
    expect(navFor("/connect").title).toBe("Connect a server");
    expect(navFor("/projects/demo/deployments").title).toBe("Project deployments");
  });
});

describe("create button", () => {
  it("is left to the Projects page, which has its own New project button", () => {
    expect(hasOwnCreateButton("/projects")).toBe(true);
    expect(hasOwnCreateButton("/deployments")).toBe(false);
    expect(hasOwnCreateButton("/projects/demo")).toBe(false);
  });
});
