import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERMISSIONS,
  ENABLE_COPY,
  LIVE_RELEASE_NOTICE,
  OFF_MESSAGES,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  SECTION_INTRO,
  needsFreshSignIn,
  normalizePermissions,
  permissionsOrDefault,
  typedConfirmFor,
} from "@/lib/container-permissions";

describe("typedConfirmFor", () => {
  const sam = typedConfirmFor("sam-r");

  it("exposes the text to type", () => {
    expect(sam.expected).toBe("sam-r");
  });

  it("accepts the exact name", () => {
    expect(sam.matches("sam-r")).toBe(true);
  });

  it("ignores spaces and line breaks around what was typed", () => {
    expect(sam.matches("  sam-r")).toBe(true);
    expect(sam.matches("sam-r  ")).toBe(true);
    expect(sam.matches("\tsam-r\n")).toBe(true);
  });

  it("is case sensitive", () => {
    expect(sam.matches("Sam-R")).toBe(false);
    expect(sam.matches("SAM-R")).toBe(false);
  });

  it("rejects anything that is not the whole name", () => {
    expect(sam.matches("")).toBe(false);
    expect(sam.matches("   ")).toBe(false);
    expect(sam.matches("sam")).toBe(false);
    expect(sam.matches("sam-r2")).toBe(false);
    expect(sam.matches("sam-rr")).toBe(false);
    expect(sam.matches("sam r")).toBe(false);
    expect(sam.matches("sa m-r")).toBe(false);
  });

  it("does not accept the hostname for the username", () => {
    expect(sam.matches("sam-r.hackclub.app")).toBe(false);
  });

  it("trims the expected name too", () => {
    const padded = typedConfirmFor("  sam-r ");
    expect(padded.expected).toBe("sam-r");
    expect(padded.matches("sam-r")).toBe(true);
  });

  it("never matches when there is no server name", () => {
    expect(typedConfirmFor("").matches("")).toBe(false);
    expect(typedConfirmFor("   ").matches("  ")).toBe(false);
  });
});

describe("normalizePermissions", () => {
  it("returns the defaults for nothing", () => {
    expect(normalizePermissions(undefined)).toEqual(DEFAULT_PERMISSIONS);
    expect(normalizePermissions(null)).toEqual(DEFAULT_PERMISSIONS);
    expect(normalizePermissions("yes")).toEqual(DEFAULT_PERMISSIONS);
  });

  it("keeps real booleans and defaults the rest", () => {
    expect(normalizePermissions({ terminal: true })).toEqual({
      terminal: true,
      fileWrites: false,
      orphanRemoval: false,
    });
    expect(normalizePermissions({ fileWrites: true })).toEqual({
      terminal: false,
      fileWrites: true,
      orphanRemoval: false,
    });
    expect(normalizePermissions({ fileWrites: false, orphanRemoval: false })).toEqual({
      terminal: false,
      fileWrites: false,
      orphanRemoval: false,
    });
  });

  it("does not treat truthy values as on", () => {
    expect(normalizePermissions({ terminal: 1, fileWrites: "false", orphanRemoval: 0 })).toEqual(DEFAULT_PERMISSIONS);
  });
});

describe("permissionsOrDefault", () => {
  it("returns the loaded permissions", async () => {
    await expect(permissionsOrDefault(async () => ({ terminal: true, fileWrites: false, orphanRemoval: true }))).resolves.toEqual({
      terminal: true,
      fileWrites: false,
      orphanRemoval: true,
    });
  });

  it("falls back to the defaults when the load fails", async () => {
    await expect(
      permissionsOrDefault(async () => {
        throw new Error("down");
      })
    ).resolves.toEqual(DEFAULT_PERMISSIONS);
  });
});

describe("copy", () => {
  it("defaults every switch off", () => {
    expect(DEFAULT_PERMISSIONS).toEqual({ terminal: false, fileWrites: false, orphanRemoval: false });
    for (const key of PERMISSION_KEYS) expect(DEFAULT_PERMISSIONS[key]).toBe(false);
  });

  it("falls back to everything off when nothing usable was loaded", () => {
    expect(normalizePermissions({ terminal: "yes", orphanRemoval: 1 })).toEqual({
      terminal: false,
      fileWrites: false,
      orphanRemoval: false,
    });
  });

  it("describes leftover removal as off by default, limited to nd- services and ~/.nest-deploy folders, without claiming older servers keep their setting", () => {
    const d = PERMISSION_DESCRIPTIONS.orphanRemoval;
    expect(d).toMatch(/Off by default/);
    expect(d).not.toMatch(/On by default/);
    expect(d).toContain("nd-");
    expect(d).toContain("~/.nest-deploy");
    expect(d).not.toMatch(/earlier keeps/);
  });

  it("tells the owner what the terminal can do to apps Nest Deploy did not deploy", () => {
    expect(PERMISSION_DESCRIPTIONS.terminal).toMatch(/not deploy/);
  });

  it("says file changes only reach shared/ and never other apps", () => {
    expect(PERMISSION_DESCRIPTIONS.fileWrites).toMatch(/only/);
    expect(PERMISSION_DESCRIPTIONS.fileWrites).toContain("shared/");
  });

  it("says in the section intro that every switch starts off, that file changes were turned off once for all servers, and that a switch never restarts an app", () => {
    expect(SECTION_INTRO).toMatch(/off until you turn them on/);
    expect(SECTION_INTRO).not.toMatch(/connected earlier keep/);
    expect(SECTION_INTRO).toMatch(/File changes were turned off for all servers once, in an update; after that, each switch keeps the value you set\./);
    expect(SECTION_INTRO).toMatch(/never restarts/);
    expect(SECTION_INTRO).not.toMatch(/[–—]/);
  });

  it("falls back to file changes off when nothing usable was loaded", () => {
    expect(normalizePermissions({}).fileWrites).toBe(false);
    expect(normalizePermissions({ fileWrites: "true" }).fileWrites).toBe(false);
  });

  it("describes file changes as off by default, able to change the running code, with a read-only live release", () => {
    const d = PERMISSION_DESCRIPTIONS.fileWrites;
    expect(d).toMatch(/Off by default/);
    expect(d).toMatch(/change the code your app runs/);
    expect(d).toContain("current/) is always read only");
    expect(d).not.toMatch(/On by default/);
    expect(OFF_MESSAGES.fileWrites).toMatch(/^File changes are turned off/);
    expect(LIVE_RELEASE_NOTICE.title).toMatch(/live release/);
    expect(LIVE_RELEASE_NOTICE.title).toMatch(/read only/);
    expect(LIVE_RELEASE_NOTICE.body).toContain("shared/");
  });

  it("asks for the typed Nest username for the terminal and for file changes, not for leftovers", () => {
    expect(needsFreshSignIn("terminal")).toBe(true);
    expect(needsFreshSignIn("fileWrites")).toBe(true);
    expect(needsFreshSignIn("orphanRemoval")).toBe(false);
  });

  it("words the file changes confirmation around the running code and a read-only live release", () => {
    const copy = ENABLE_COPY.fileWrites;
    const text = copy.description("sam-r.hackclub.app");
    expect(copy.title).toBe("Turn on file changes?");
    expect(copy.button).toBe("Turn on file changes");
    expect(text).toContain("sam-r.hackclub.app");
    expect(text).toMatch(/change the code your app runs/);
    expect(text).toMatch(/terminal access/);
    expect(text).toContain("current/) stays read only");
    expect(ENABLE_COPY.terminal.description("x")).toMatch(/root/);
  });

  it("has a label, description and off message for every switch", () => {
    for (const key of PERMISSION_KEYS) {
      expect(PERMISSION_LABELS[key]).toBeTruthy();
      expect(PERMISSION_DESCRIPTIONS[key]).toBeTruthy();
      expect(OFF_MESSAGES[key]).toBeTruthy();
    }
  });

  it("uses no em or en dashes", () => {
    const all = [
      ...Object.values(PERMISSION_LABELS),
      ...Object.values(PERMISSION_DESCRIPTIONS),
      ...Object.values(OFF_MESSAGES),
      SECTION_INTRO,
      ...Object.values(ENABLE_COPY).flatMap((c) => [c.title, c.description("x"), c.button]),
      LIVE_RELEASE_NOTICE.title,
      LIVE_RELEASE_NOTICE.body,
    ].join(" ");
    expect(all).not.toMatch(/[–—]/);
  });
});
