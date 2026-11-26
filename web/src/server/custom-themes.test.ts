import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import {
  CUSTOM_THEME_LIMIT,
  QUICK_DEFAULTS,
  THEME_TOKENS,
  checkContrast,
  deriveTokens,
  parseThemeInput,
  type ThemeTokens,
} from "@/lib/custom-theme";
import { contrastHex } from "@/lib/theme-color";
import { parseAppearance, parseCustomThemes } from "@/lib/preferences";
import { HttpError } from "@/server/http";
import {
  cookieThemes,
  createTheme,
  deleteTheme,
  getTheme,
  listThemes,
  themeInput,
  updateTheme,
} from "@/server/custom-themes";
import { getPreferences, updatePreferences } from "@/server/preferences";

// The route layer and the database are real. Only sign-in is replaced.
vi.mock("@/server/auth/current", () => ({
  getCurrentUser: vi.fn(),
  requireUser: vi.fn(),
}));

import { getCurrentUser } from "@/server/auth/current";
import { GET as listRoute, POST as createRoute } from "@/app/api/themes/route";
import { DELETE as deleteRoute, GET as getRoute, PUT as putRoute } from "@/app/api/themes/[id]/route";
import { PATCH as patchPreferences } from "@/app/api/preferences/route";

let cleanup: () => Promise<void>;
let alice: Awaited<ReturnType<typeof upsertUser>>;
let bob: Awaited<ReturnType<typeof upsertUser>>;
let carol: Awaited<ReturnType<typeof upsertUser>>;

const dark = () => ({ name: "Midnight", scheme: "dark" as const, tokens: deriveTokens(QUICK_DEFAULTS.dark, "dark") });
const light = (name = "Paper") => ({ name, scheme: "light" as const, tokens: deriveTokens(QUICK_DEFAULTS.light, "light") });

beforeAll(async () => {
  const t = await useFreshDb();
  cleanup = t.cleanup;
  alice = await upsertUser({ id: "hc-theme-alice", name: "Alice", email: null, slackId: null });
  bob = await upsertUser({ id: "hc-theme-bob", name: "Bob", email: null, slackId: null });
  carol = await upsertUser({ id: "hc-theme-carol", name: "Carol", email: null, slackId: null });
});
afterAll(async () => cleanup());

async function created(userId: string, input: unknown) {
  const r = await createTheme(userId, input);
  if (!r.ok) throw new Error(`not created: ${r.message}`);
  return r.theme;
}

describe("saving a custom theme", () => {
  it("saves a set that passes, and reads it back with its name, scheme and colours", async () => {
    const r = await createTheme(alice.id, light());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.theme.name).toBe("Paper");
    expect(r.theme.scheme).toBe("light");
    expect(r.theme.preset).toBe(`custom:${r.theme.id}`);
    expect(r.theme.id).toMatch(/^[a-z0-9]{16}$/);
    expect(r.theme.tokens).toEqual(light().tokens);
    expect(r.warnings).toEqual([]);
    expect((await getTheme(alice.id, r.theme.id)).name).toBe("Paper");
    expect((await listThemes(alice.id)).map((t) => t.id)).toContain(r.theme.id);
  });

  it("trims the name", async () => {
    const t = await created(alice.id, { ...light(), name: "  Spaced out  " });
    expect(t.name).toBe("Spaced out");
  });

  it("blocks a failing body pair, names it with the ratio, and suggests a colour that passes", async () => {
    const before = (await listThemes(alice.id)).length;
    const tokens = { ...light().tokens, foreground: "#9a9a9a" };
    const r = await createTheme(alice.id, { name: "Faint", scheme: "light", tokens });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.blocking.map((p) => p.id).sort()).toEqual(["text-card", "text-page"]);
    expect(r.message).toMatch(/Text on the page is \d\.\d\d:1; it needs 4\.5:1\. Try #[0-9a-f]{6}\./);
    expect(r.message).toContain("Text on a card");
    // Nothing was saved.
    expect(await listThemes(alice.id)).toHaveLength(before);
    // The suggested colour passes, and saves.
    const fix = r.blocking[0].suggestion!;
    for (const bg of [tokens["ds-background-200"], tokens["ds-background-100"]]) {
      expect(contrastHex(fix, bg)).toBeGreaterThanOrEqual(4.5);
    }
    const again = await createTheme(alice.id, { name: "Faint fixed", scheme: "light", tokens: { ...tokens, foreground: fix } });
    expect(again.ok).toBe(true);
  });

  it("saves a set with only low-priority problems, and returns them as warnings", async () => {
    const tokens: ThemeTokens = { ...light().tokens, destructive: "#ffb3b3", "ds-focus-color": "#f0f0f0" };
    expect(checkContrast(tokens, "light").blocking).toEqual([]);
    const r = await createTheme(alice.id, { name: "Pale danger", scheme: "light", tokens });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.map((p) => p.id)).toEqual(expect.arrayContaining(["danger", "ring"]));
  });

  const bad: [string, unknown][] = [
    ["a colour that is css", { ...dark(), tokens: { ...dark().tokens, primary: "#fff;background:url(x)" } }],
    ["a colour that is a url", { ...dark(), tokens: { ...dark().tokens, primary: "url(https://example.com/x.png)" } }],
    ["a five digit colour", { ...dark(), tokens: { ...dark().tokens, primary: "#12345" } }],
    ["a colour with a space", { ...dark(), tokens: { ...dark().tokens, primary: "#fff " } }],
    ["a function", { ...dark(), tokens: { ...dark().tokens, primary: "rgb(0 0 0)" } }],
    ["a missing colour", { ...dark(), tokens: Object.fromEntries(Object.entries(dark().tokens).filter(([k]) => k !== "link")) }],
    ["an unknown colour name", { ...dark(), tokens: { ...dark().tokens, "background-image": "#fff" } }],
    ["an unknown key", { ...dark(), owner: "someone" }],
    ["an id", { ...dark(), id: "abc" }],
    ["a user id", { ...dark(), userId: "hc-theme-bob" }],
    ["no name", { ...dark(), name: "" }],
    ["a name of spaces", { ...dark(), name: "    " }],
    ["a name over 40", { ...dark(), name: "x".repeat(41) }],
    ["a control character in the name", { ...dark(), name: "a\u0000b" }],
    ["an invisible character in the name", { ...dark(), name: "a‮b" }],
    ["a bad scheme", { ...dark(), scheme: "sepia" }],
    ["tokens as a list", { ...dark(), tokens: [] }],
    ["not an object", "theme"],
  ];
  it.each(bad)("rejects %s with a 400 and saves nothing", async (_what, input) => {
    const before = (await listThemes(alice.id)).length;
    await expect(createTheme(alice.id, input)).rejects.toMatchObject({ status: 400 });
    expect(await listThemes(alice.id)).toHaveLength(before);
  });

  it("agrees with the browser's own check (parseThemeInput) on every one of those", () => {
    for (const [what, input] of bad) {
      expect(themeInput.safeParse(input).success, what).toBe(false);
      expect(parseThemeInput(input).ok, what).toBe(false);
    }
    for (const input of [dark(), light(), { ...light(), name: "x".repeat(40) }]) {
      expect(themeInput.safeParse(input).success).toBe(true);
      expect(parseThemeInput(input).ok).toBe(true);
    }
  });

  it("accepts 3, 4, 6 and 8 digit colours", async () => {
    const tokens: ThemeTokens = { ...dark().tokens, "pixel-dot": "#fff", "ds-gray-alpha-100": "#ffff", link: "#52a8ffaa", "skeleton-highlight": "#333333" };
    expect((await createTheme(carol.id, { name: "Digits", scheme: "dark", tokens })).ok).toBe(true);
  });
});

describe("the limit of 20 themes", () => {
  it("allows 20, refuses the 21st with a 409, and counts each person on their own", async () => {
    const u = await upsertUser({ id: "hc-theme-limit", name: "Limit", email: null, slackId: null });
    for (let i = 0; i < CUSTOM_THEME_LIMIT; i++) await created(u.id, light(`Theme ${i}`));
    expect(await listThemes(u.id)).toHaveLength(20);
    const err = await createTheme(u.id, light("One too many")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 409, code: "limit" });
    expect(await listThemes(u.id)).toHaveLength(20);
    // Someone else is not held back by it.
    expect((await createTheme(bob.id, light("Bob's first"))).ok).toBe(true);
    // Deleting one makes room.
    await deleteTheme(u.id, (await listThemes(u.id))[0].id);
    expect((await createTheme(u.id, light("Fits again"))).ok).toBe(true);
    // Updating is not creating: it works at the limit.
    const full = await listThemes(u.id);
    expect(full).toHaveLength(20);
    expect((await updateTheme(u.id, full[0].id, light("Renamed"))).ok).toBe(true);
  });
});

describe("owner-only reads and writes", () => {
  it("answers another person's theme id with not found, for a read, an update and a delete", async () => {
    const mine = await created(alice.id, dark());
    for (const attempt of [
      () => getTheme(bob.id, mine.id),
      () => updateTheme(bob.id, mine.id, light("Taken")),
      () => deleteTheme(bob.id, mine.id),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ status: 404 });
    }
    // Nothing changed.
    const still = await getTheme(alice.id, mine.id);
    expect(still.name).toBe("Midnight");
    expect(still.scheme).toBe("dark");
    expect((await listThemes(bob.id)).map((t) => t.id)).not.toContain(mine.id);
    expect(Object.keys(await cookieThemes(bob.id))).not.toContain(mine.preset);
  });

  it("does not let a person choose someone else's theme", async () => {
    const mine = await created(alice.id, dark());
    await expect(updatePreferences(bob.id, { preset: mine.preset })).rejects.toMatchObject({ status: 400 });
    await expect(updatePreferences(bob.id, { darkPreset: mine.preset })).rejects.toMatchObject({ status: 400 });
    expect((await getPreferences(bob.id)).preset).not.toBe(mine.preset);
  });

  it("updates the person's own theme", async () => {
    const mine = await created(carol.id, dark());
    const r = await updateTheme(carol.id, mine.id, { ...light("Now light") });
    expect(r.ok).toBe(true);
    const after = await getTheme(carol.id, mine.id);
    expect(after).toMatchObject({ name: "Now light", scheme: "light", id: mine.id });
    expect(after.updatedAt).toBeGreaterThanOrEqual(mine.updatedAt);
    // An update is held to the contrast rules too.
    const blocked = await updateTheme(carol.id, mine.id, { name: "Faint", scheme: "light", tokens: { ...light().tokens, foreground: "#bbbbbb" } });
    expect(blocked.ok).toBe(false);
    expect((await getTheme(carol.id, mine.id)).name).toBe("Now light");
  });
});

describe("choosing a custom theme", () => {
  it("is saved in the preferences, and read back", async () => {
    const t = await created(alice.id, dark());
    const l = await created(alice.id, light("Day"));
    const saved = await updatePreferences(alice.id, { matchDevice: true, lightPreset: l.preset, darkPreset: t.preset, preset: t.preset });
    expect(saved).toMatchObject({ lightPreset: l.preset, darkPreset: t.preset, preset: t.preset });
    expect(await getPreferences(alice.id)).toMatchObject({ lightPreset: l.preset, darkPreset: t.preset, preset: t.preset });
  });

  it("refuses an unknown theme, and a theme in a slot of the other scheme", async () => {
    const d = await created(alice.id, dark());
    const l = await created(alice.id, light("Day 2"));
    await expect(updatePreferences(alice.id, { preset: "custom:0000000000000000" })).rejects.toMatchObject({ status: 400 });
    await expect(updatePreferences(alice.id, { lightPreset: d.preset })).rejects.toMatchObject({ message: expect.stringContaining("light") });
    await expect(updatePreferences(alice.id, { darkPreset: l.preset })).rejects.toMatchObject({ status: 400 });
    // The shape of the id is checked before the database is asked.
    await expect(updatePreferences(alice.id, { preset: "custom:../../x" })).rejects.toMatchObject({ status: 400 });
    await expect(updatePreferences(alice.id, { preset: "custom:" })).rejects.toMatchObject({ status: 400 });
  });

  it("falls back to the default for the theme's scheme when the theme is deleted", async () => {
    const u = await upsertUser({ id: "hc-theme-fallback", name: "Fallback", email: null, slackId: null });
    const d = await created(u.id, dark());
    const l = await created(u.id, light("Day"));
    await updatePreferences(u.id, { matchDevice: false, lightPreset: l.preset, darkPreset: d.preset, preset: d.preset });
    await deleteTheme(u.id, d.id);
    expect(await getPreferences(u.id)).toMatchObject({ darkPreset: "egg-dark", preset: "egg-dark", lightPreset: l.preset });
    await updatePreferences(u.id, { preset: l.preset });
    await deleteTheme(u.id, l.id);
    expect(await getPreferences(u.id)).toMatchObject({ lightPreset: "egg-light", preset: "egg-light", darkPreset: "egg-dark" });
    await expect(getTheme(u.id, d.id)).rejects.toMatchObject({ status: 404 });
  });

  it("shows the default for a choice that points at a theme that is already gone", async () => {
    const u = await upsertUser({ id: "hc-theme-stale", name: "Stale", email: null, slackId: null });
    await updatePreferences(u.id, { matchDevice: false });
    const db = await getDb();
    await db
      .update(schema.userPreferences)
      .set({ accent: "custom:deadbeefdeadbeef", lightPreset: "custom:deadbeefdeadbeef", darkPreset: "custom:cafebabecafebabe" })
      .where(eq(schema.userPreferences.userId, u.id));
    expect(await getPreferences(u.id)).toMatchObject({ preset: "egg-dark", lightPreset: "egg-light", darkPreset: "egg-dark" });
  });

  it("puts a theme that changes scheme back out of the slot it no longer fits", async () => {
    const u = await upsertUser({ id: "hc-theme-flip", name: "Flip", email: null, slackId: null });
    const t = await created(u.id, light("Flip"));
    await updatePreferences(u.id, { lightPreset: t.preset });
    await updateTheme(u.id, t.id, dark());
    expect((await getPreferences(u.id)).lightPreset).toBe("egg-light");
  });

  it("is removed from the account when the person is removed", async () => {
    const u = await upsertUser({ id: "hc-theme-cascade", name: "Cascade", email: null, slackId: null });
    await created(u.id, dark());
    const db = await getDb();
    await db.delete(schema.users).where(eq(schema.users.id, u.id));
    expect(await listThemes(u.id)).toEqual([]);
  });

  it("does not show or apply a stored theme whose colours no longer pass the rules", async () => {
    const u = await upsertUser({ id: "hc-theme-corrupt", name: "Corrupt", email: null, slackId: null });
    const t = await created(u.id, dark());
    const db = await getDb();
    const tokens = { ...dark().tokens, primary: "#fff;background:url(x)" };
    await db.update(schema.userThemes).set({ tokens: JSON.stringify(tokens) }).where(eq(schema.userThemes.id, t.id));
    expect(await listThemes(u.id)).toEqual([]);
    await expect(getTheme(u.id, t.id)).rejects.toMatchObject({ status: 404 });
    expect(await cookieThemes(u.id)).toEqual({});
  });

  it("still shows a theme saved before the selected-text and button-hover colours existed, with both worked out", async () => {
    const u = await upsertUser({ id: "hc-theme-legacy", name: "Legacy", email: null, slackId: null });
    const t = await created(u.id, dark());
    const db = await getDb();
    const { "selected-foreground": _a, "primary-hover": _b, ...old } = dark().tokens;
    void _a;
    void _b;
    await db.update(schema.userThemes).set({ tokens: JSON.stringify(old) }).where(eq(schema.userThemes.id, t.id));
    expect((await getTheme(u.id, t.id)).tokens).toEqual(dark().tokens);
  });
});

describe("the routes", () => {
  const url = "http://localhost:3000/api/themes";
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (method: string, body?: unknown, headers: Record<string, string> = {}, path = url) =>
    new NextRequest(path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });

  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue(alice);
  });

  it("needs a signed-in person", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await listRoute(req("GET"), undefined)).status).toBe(401);
    expect((await createRoute(req("POST", light()), undefined)).status).toBe(401);
    expect((await getRoute(req("GET"), ctx("abcdefgh12345678"))).status).toBe(401);
    expect((await deleteRoute(req("DELETE"), ctx("abcdefgh12345678"))).status).toBe(401);
  });

  it("blocks writes from another site, for create, replace and delete", async () => {
    const mine = await created(alice.id, dark());
    const evil = { origin: "https://evil.example" };
    expect((await createRoute(req("POST", light(), evil), undefined)).status).toBe(403);
    expect((await putRoute(req("PUT", light(), evil), ctx(mine.id))).status).toBe(403);
    expect((await deleteRoute(req("DELETE", undefined, evil), ctx(mine.id))).status).toBe(403);
    expect((await createRoute(req("POST", light(), { "sec-fetch-site": "cross-site" }), undefined)).status).toBe(403);
    expect((await getTheme(alice.id, mine.id)).name).toBe("Midnight");
  });

  it("creates with a 201 and the theme, lists, reads, replaces and deletes", async () => {
    const res = await createRoute(req("POST", light("Routed")), undefined);
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { theme, warnings } = await res.json();
    expect(theme).toMatchObject({ name: "Routed", scheme: "light" });
    expect(warnings).toEqual([]);
    const list = await (await listRoute(req("GET"), undefined)).json();
    expect(list.themes.map((t: { id: string }) => t.id)).toContain(theme.id);
    expect((await (await getRoute(req("GET"), ctx(theme.id))).json()).theme.name).toBe("Routed");
    const put = await putRoute(req("PUT", { ...light("Routed again") }), ctx(theme.id));
    expect(put.status).toBe(200);
    expect((await put.json()).theme.name).toBe("Routed again");
    expect((await deleteRoute(req("DELETE"), ctx(theme.id))).status).toBe(200);
    expect((await getRoute(req("GET"), ctx(theme.id))).status).toBe(404);
  });

  it("answers a failing body pair with a 422 that names the pair, the ratio and the suggested colour", async () => {
    const res = await createRoute(req("POST", { name: "Faint", scheme: "light", tokens: { ...light().tokens, foreground: "#aaaaaa" } }), undefined);
    expect(res.status).toBe(422);
    const { error } = await res.json();
    expect(error.code).toBe("contrast");
    expect(error.message).toMatch(/Text on the page is \d\.\d\d:1; it needs 4\.5:1\. Try #[0-9a-f]{6}\./);
    expect(error.pairs[0]).toMatchObject({ id: "text-page", min: 4.5, pass: false });
    expect(error.pairs[0].suggestion).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("answers bad input with a 400, a body that is not JSON with a 400, and an oversized body with a 413", async () => {
    const res = await createRoute(req("POST", { ...dark(), tokens: { ...dark().tokens, primary: "url(x)" } }), undefined);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation");
    expect((await createRoute(req("POST", "not json"), undefined)).status).toBe(400);
    expect((await createRoute(req("POST", { ...dark(), name: "x".repeat(20_000) }), undefined)).status).toBe(413);
  });

  it("answers 409 at the limit", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(await upsertUser({ id: "hc-theme-route-limit", name: "RL", email: null, slackId: null }));
    for (let i = 0; i < CUSTOM_THEME_LIMIT; i++) expect((await createRoute(req("POST", light(`T${i}`)), undefined)).status).toBe(201);
    const res = await createRoute(req("POST", light("Extra")), undefined);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("limit");
  });

  it("answers another person's theme id, and an id of the wrong shape, with 404", async () => {
    const mine = await created(alice.id, dark());
    vi.mocked(getCurrentUser).mockResolvedValue(bob);
    expect((await getRoute(req("GET"), ctx(mine.id))).status).toBe(404);
    expect((await putRoute(req("PUT", light()), ctx(mine.id))).status).toBe(404);
    expect((await deleteRoute(req("DELETE"), ctx(mine.id))).status).toBe(404);
    expect((await getRoute(req("GET"), ctx("../../etc/passwd"))).status).toBe(404);
    expect((await getRoute(req("GET"), ctx("UPPER-CASE-ID-123"))).status).toBe(404);
    expect((await getTheme(alice.id, mine.id)).id).toBe(mine.id);
  });

  it("puts a chosen custom theme in the egg_prefs cookie that the preferences route sets", async () => {
    const t = await created(alice.id, dark());
    const res = await patchPreferences(req("PATCH", { matchDevice: false, preset: t.preset }, {}, "http://localhost:3000/api/preferences"), undefined);
    expect(res.status).toBe(200);
    const header = res.headers.get("set-cookie")!;
    const value = decodeURIComponent(/egg_prefs=([^;]+)/.exec(header)![1]);
    expect(value).toContain(`preset=${t.preset}`);
    expect(value).toContain(`t_${t.id}=d,0:#`);
    const raw = /egg_prefs=([^;]+)/.exec(header)![1];
    expect(parseCustomThemes(raw)[t.preset]?.tokens).toEqual(t.tokens);
    expect(parseAppearance(raw)).toMatchObject({ matchDevice: false, preset: t.preset });
    expect(THEME_TOKENS.length).toBe(Object.keys(t.tokens).length);
  });
});
