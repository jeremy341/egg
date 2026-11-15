import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { enableAnalytics, recordPageview } from "@/server/analytics";
import { NO_FEATURES, featuresForUser, updateFeatures } from "@/server/analytics-config";
import {
  UNKNOWN_COUNTRY,
  countryOf,
  countryToStore,
  isPublicIp,
  locationsSummary,
  summariseLocations,
} from "@/server/analytics-locations";
import { worldShapes } from "@/server/world-map";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";
import { codeForShape, countryName } from "@/lib/world-codes";
import { classFill, locationScale } from "@/lib/location-scale";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let serverId: string;
let n = 0;
const now = new Date("2026-11-04T12:00:00Z");
const ua = "Mozilla/5.0 Firefox";

async function newProject() {
  n += 1;
  const p = await createProject(userId, {
    serverId,
    repoUrl: "https://github.com/sam/app.git",
    runtime: "node" as const,
    port: 4000 + n,
    name: `Geo ${n}`,
    slug: `geo-${n}`,
  });
  const { key } = await enableAnalytics(userId, p.id);
  return { id: p.id, key };
}
const rows = async (projectId: string) =>
  (await getDb()).select().from(schema.pageviews).where(eq(schema.pageviews.projectId, projectId));

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "u9", name: "Geo", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "geo-r")).id;
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("the switch", () => {
  it("is off by default, for the defaults object and for a new project", async () => {
    expect(NO_FEATURES.locations).toBe(false);
    const p = await newProject();
    expect((await featuresForUser(userId, p.id)).locations).toBe(false);
  });
});

describe("country lookup", () => {
  it("is unknown for local and private addresses", async () => {
    for (const ip of ["127.0.0.1", "::1", "10.1.2.3", "192.168.0.9", "172.16.5.5", "169.254.1.1", "100.64.0.1", "0.0.0.0", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not an address", ""]) {
      expect(await countryOf(ip)).toBe(UNKNOWN_COUNTRY);
    }
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("10.0.0.1")).toBe(false);
  });

  it("finds a country offline for a public address", async () => {
    expect(await countryOf("8.8.8.8")).toBe("US");
    expect(await countryOf("::ffff:8.8.8.8")).toBe("US");
  });

  it("looks nothing up when the switch is off, and stores nothing for an unknown address", async () => {
    expect(await countryToStore(false, "8.8.8.8")).toBeNull();
    expect(await countryToStore(true, "8.8.8.8")).toBe("US");
    expect(await countryToStore(true, "10.0.0.1")).toBeNull();
  });
});

describe("storage", () => {
  it("stores no country while the switch is off", async () => {
    const p = await newProject();
    expect(await recordPageview(p.key, { p: "/", pt: 1 }, { ip: "8.8.8.8", ua }, now)).toBe(true);
    expect((await rows(p.id))[0].country).toBeNull();
  });

  it("stores only the two-letter code when it is on, and deletes them when it is turned off", async () => {
    const p = await newProject();
    await updateFeatures(userId, p.id, { locations: true });
    await recordPageview(p.key, { p: "/", pt: 1 }, { ip: "8.8.8.8", ua }, now);
    await recordPageview(p.key, { p: "/", pt: 1 }, { ip: "10.0.0.7", ua }, now);
    const stored = await rows(p.id);
    expect(stored.map((r) => r.country)).toEqual(["US", null]);
    // No row holds the address anywhere.
    expect(JSON.stringify(stored)).not.toContain("8.8.8.8");
    await updateFeatures(userId, p.id, { locations: false });
    expect((await rows(p.id)).every((r) => r.country === null)).toBe(true);
  });

  it("summarises only this project", async () => {
    const a = await newProject();
    const b = await newProject();
    await updateFeatures(userId, a.id, { locations: true });
    await updateFeatures(userId, b.id, { locations: true });
    await recordPageview(a.key, { p: "/", pt: 1 }, { ip: "8.8.8.8", ua }, now);
    await recordPageview(b.key, { p: "/", pt: 1 }, { ip: "81.2.69.142", ua }, now);
    const summary = await locationsSummary(userId, a.id, 30, now);
    expect(summary.rows.map((r) => r.code)).toEqual(["US"]);
  });
});

describe("summary rounding", () => {
  it("shows under 10 as fewer than 10 and rounds the rest", () => {
    const s = summariseLocations([
      { code: "FR", visits: 1234 },
      { code: "DE", visits: 47 },
      { code: "NZ", visits: 3 },
      { code: "JP", visits: 9 },
      { code: null, visits: 500 },
      { code: "xx", visits: 5 },
    ]);
    expect(s.rows.map((r) => [r.code, r.count])).toEqual([
      ["FR", { approx: 1200 }],
      ["DE", { approx: 47 }],
      ["JP", { lessThan: 10 }],
      ["NZ", { lessThan: 10 }],
    ]);
    expect(s.rows[0].name).toBe("France");
    expect(JSON.stringify(s)).not.toContain('"approx":3');
  });

  it("a project with a few views in total never shows a small exact number", () => {
    const s = summariseLocations([{ code: "FR", visits: 2 }]);
    expect(s.total).toEqual({ lessThan: 10 });
  });
});

describe("the map", () => {
  it("joins every shape that has a code to a real country name", () => {
    const shapes = worldShapes().features;
    expect(shapes.length).toBeGreaterThan(150);
    const coded = shapes.filter((s) => s.properties.code);
    expect(new Set(coded.map((s) => s.properties.code)).size).toBe(coded.length);
    expect(coded.find((s) => s.properties.code === "FR")?.geometry.type).toBe("MultiPolygon");
    expect(shapes.some((s) => s.properties.name === "Antarctica")).toBe(false);
    expect(codeForShape(undefined, "Kosovo")).toBe("XK");
    expect(countryName("DE")).toBe("Germany");
  });

  it("shades with the theme, not fixed colours, and keeps 'fewer than 10' apart from none", () => {
    const scale = locationScale([{ approx: 1200 }, { approx: 40 }, { lessThan: 10 }]);
    expect(scale.classOf(undefined)).toBe(0);
    expect(scale.classOf({ lessThan: 10 })).toBe(1);
    expect(scale.classOf({ approx: 1200 })).toBe(4);
    expect(scale.classOf({ approx: 40 })).toBe(2);
    for (const cls of [0, 1, 2, 3, 4]) expect(classFill(cls)).toMatch(/var\(--/);
    expect(classFill(3)).not.toMatch(/#|rgb|hsl/);
  });
});
