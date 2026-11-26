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
  "/keys",
  "/docs",
  "/docs/quickstart",
  "/account",
  "/settings",
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

  it("titles the keys page Keys and lists it in the Find palette", () => {
    expect(navFor("/keys").title).toBe("Keys");
    expect(findTargets([]).some((t) => t.href === "/keys" && t.label === "Keys")).toBe(true);
  });
});

describe("team nav", () => {
  it("lists Keys after Connect and marks it current on the keys page", () => {
    const labels = navFor("/projects").items.map((i) => i.label);
    expect(labels.slice(-2)).toEqual(["Connect", "Keys"]);
    const current = navFor("/keys").items.filter((i) => i.active("/keys"));
    expect(current.map((i) => i.href)).toEqual(["/keys"]);
  });
});

describe("create button", () => {
  it("is left to the Projects page, which has its own New project button", () => {
    expect(hasOwnCreateButton("/projects")).toBe(true);
    expect(hasOwnCreateButton("/deployments")).toBe(false);
    expect(hasOwnCreateButton("/projects/demo")).toBe(false);
  });
});

describe("project nav", () => {
  it("lists every project page", () => {
    expect(navFor("/projects/demo").items.map((i) => i.label)).toEqual([
      "Overview",
      "Deployments",
      "Analytics",
      "Files",
      "Terminal",
      "Settings",
    ]);
  });

  it("titles and marks the project pages", () => {
    const ctx = navFor("/projects/demo/settings");
    expect(ctx.title).toBe("Project settings");
    expect(ctx.items.some((i) => i.href === "/projects/demo/settings" && i.active("/projects/demo/settings"))).toBe(true);
    expect(navFor("/projects/demo/analytics").backHref).toBe("/projects/demo");
  });
});
