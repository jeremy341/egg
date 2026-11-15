import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertUser } from "@/server/auth/session";
import { DEFAULT_PREFERENCES } from "@/lib/preferences";
import { getPreferences, preferencesPatch, updatePreferences } from "@/server/preferences";
import { useFreshDb } from "@/server/test/db";

describe("preferencesPatch", () => {
  const ok = (v: unknown) => preferencesPatch.safeParse(v);

  it("accepts each field on its own", () => {
    expect(ok({ theme: "dark" }).success).toBe(true);
    expect(ok({ accent: "violet" }).success).toBe(true);
    expect(ok({ density: "compact" }).success).toBe(true);
    expect(ok({ reducedMotion: "no-preference" }).success).toBe(true);
    expect(ok({ avatar: "pixel-08" }).success).toBe(true);
    expect(ok({}).success).toBe(true);
  });

  it.each([
    { theme: "neon" },
    { accent: "pink" },
    { density: "tiny" },
    { reducedMotion: "always" },
    { avatar: "pixel-99" },
    { avatar: "../../etc/passwd" },
    { avatar: "<img src=x>" },
    { unknown: 1 },
  ])("rejects %j", (v) => {
    expect(ok(v).success).toBe(false);
  });

  it("accepts analytics defaults for the known switches only", () => {
    expect(ok({ analyticsDefaults: { clicks: true, retention: false } }).success).toBe(true);
    expect(ok({ analyticsDefaults: {} }).success).toBe(true);
    expect(ok({ analyticsDefaults: { telepathy: true } }).success).toBe(false);
    expect(ok({ analyticsDefaults: { clicks: "yes" } }).success).toBe(false);
    expect(DEFAULT_PREFERENCES.analyticsDefaults).toEqual({});
  });

  it("trims the display name, treats empty as unset, and caps it at 40", () => {
    expect(ok({ displayName: "  Maya  " }).data?.displayName).toBe("Maya");
    expect(ok({ displayName: "   " }).data?.displayName).toBeNull();
    expect(ok({ displayName: null }).data?.displayName).toBeNull();
    expect(ok({ displayName: "x".repeat(40) }).success).toBe(true);
    expect(ok({ displayName: "x".repeat(41) }).success).toBe(false);
  });

  it("refuses control, invisible and direction-changing characters in the name", () => {
    for (const bad of ["a\nb", "a\u0000b", "a\u0007b", "a​b", "a‮b", "a⁦b", "a﻿b", "a\u0085b"]) {
      expect(ok({ displayName: bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(ok({ displayName: "José" }).success).toBe(true);
  });

  it("checks the default branch is a git ref name of at most 100 characters", () => {
    expect(ok({ defaultBranch: "main" }).data?.defaultBranch).toBe("main");
    expect(ok({ defaultBranch: " release/1.0 " }).data?.defaultBranch).toBe("release/1.0");
    expect(ok({ defaultBranch: "" }).data?.defaultBranch).toBeNull();
    expect(ok({ defaultBranch: null }).data?.defaultBranch).toBeNull();
    for (const bad of ["has space", "-x", "a..b", "x.lock", "a~b", "x".repeat(101)]) {
      expect(ok({ defaultBranch: bad }).success, bad).toBe(false);
    }
  });
});

describe("saved preferences", () => {
  let cleanup: () => Promise<void>;
  let userId: string;
  beforeAll(async () => {
    const t = await useFreshDb();
    cleanup = t.cleanup;
    userId = (await upsertUser({ id: "hc-prefs", name: "Pref Person", email: null, slackId: null })).id;
  });
  afterAll(async () => cleanup());

  it("gives the defaults to someone with no row", async () => {
    expect(await getPreferences(userId)).toEqual(DEFAULT_PREFERENCES);
  });

  it("saves a partial update and keeps the rest", async () => {
    const a = await updatePreferences(userId, { theme: "dark", displayName: "  Pip " });
    expect(a).toEqual({ ...DEFAULT_PREFERENCES, theme: "dark", displayName: "Pip" });
    const b = await updatePreferences(userId, { accent: "green", avatar: "pixel-05", defaultBranch: "trunk" });
    expect(b).toEqual({
      ...DEFAULT_PREFERENCES,
      theme: "dark",
      displayName: "Pip",
      accent: "green",
      avatar: "pixel-05",
      defaultBranch: "trunk",
    });
    expect(await getPreferences(userId)).toEqual(b);
  });

  it("clears a field with null", async () => {
    const c = await updatePreferences(userId, { displayName: null, defaultBranch: "" });
    expect(c.displayName).toBeNull();
    expect(c.defaultBranch).toBeNull();
    expect(c.accent).toBe("green");
  });

  it("rejects bad input with a 400 and changes nothing", async () => {
    await expect(updatePreferences(userId, { accent: "pink" })).rejects.toMatchObject({ status: 400 });
    await expect(updatePreferences(userId, { displayName: "x".repeat(41) })).rejects.toMatchObject({ status: 400 });
    await expect(updatePreferences(userId, "nope")).rejects.toMatchObject({ status: 400 });
    expect((await getPreferences(userId)).accent).toBe("green");
  });
});
