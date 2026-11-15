import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, schema } from "@/server/db";
import { updateFeatures } from "@/server/analytics-config";
import { flowSummary, summariseFlow, type FlowRow, type FlowSummary } from "@/server/analytics-flow";
import { upsertUser } from "@/server/auth/session";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let otherId: string;
let serverId: string;
let otherServerId: string;
let n = 0;
const now = new Date("2026-11-04T12:00:00Z");

/** A page view on a UTC day and time, for the pure counting function. */
const view = (visitor: string, day: string, time: string, path: string, referrer: string | null = null): FlowRow => ({
  visitor,
  at: Date.parse(`${day}T${time}Z`),
  path,
  referrer,
});

const linkValue = (s: FlowSummary, source: string, target: string) =>
  s.links.find((l) => l.source === source && l.target === target)?.value ?? 0;

async function newProject(owner: string, server: string) {
  n += 1;
  const p = await createProject(owner, {
    serverId: server,
    repoUrl: "https://github.com/sam/app.git",
    runtime: "node" as const,
    port: 8000 + n,
    name: `Flow ${n}`,
    slug: `flow-${n}`,
  });
  return p.id;
}

beforeAll(async () => {
  ctx = await useFreshDb();
  userId = (await upsertUser({ id: "fl1", name: "Flow", email: null, slackId: null })).id;
  otherId = (await upsertUser({ id: "fl2", name: "Other", email: null, slackId: null })).id;
  serverId = (await createServer(userId, "flow-r")).id;
  otherServerId = (await createServer(otherId, "flow-o")).id;
});
afterAll(async () => {
  await ctx.cleanup();
});

describe("summariseFlow", () => {
  it("names a direct first page and a single page visit as Left", () => {
    const s = summariseFlow(
      [
        view("a", "2026-11-04", "10:00:00", "/"),
        view("a", "2026-11-04", "10:05:00", "/pricing"),
        view("b", "2026-11-04", "11:00:00", "/"),
      ],
      30
    );
    expect(s.enabled).toBe(true);
    expect(s.days).toBe(30);
    expect(s.visits).toBe(2);
    expect(linkValue(s, "from:Direct", "first:/")).toBe(2);
    expect(linkValue(s, "first:/", "next:/pricing")).toBe(1);
    expect(linkValue(s, "first:/", "next:Left")).toBe(1);
  });

  it("uses the first view's referrer and orders visits by time, not by input order", () => {
    const s = summariseFlow(
      [
        view("a", "2026-11-04", "10:05:00", "/pricing", "news.example"),
        view("a", "2026-11-04", "10:00:00", "/", "news.example"),
      ],
      30
    );
    expect(linkValue(s, "from:news.example", "first:/")).toBe(1);
    expect(linkValue(s, "first:/", "next:/pricing")).toBe(1);
  });

  it("groups the rest of each column as Other", () => {
    // Ten visits from referrers a (3), b (2), c, d, e, f, g (1 each): f and g fall outside the top five.
    const referrers: [string, number][] = [["a.com", 3], ["b.com", 2], ["c.com", 1], ["d.com", 1], ["e.com", 1], ["f.com", 1], ["g.com", 1]];
    const rows: FlowRow[] = [];
    let k = 0;
    for (const [host, count] of referrers) {
      for (let i = 0; i < count; i++) {
        k += 1;
        rows.push(view(`r${k}`, "2026-11-04", "09:00:00", "/", host));
      }
    }
    const s = summariseFlow(rows, 30);
    expect(s.visits).toBe(10);
    expect(linkValue(s, "from:a.com", "first:/")).toBe(3);
    expect(linkValue(s, "from:e.com", "first:/")).toBe(1);
    expect(linkValue(s, "from:Other", "first:/")).toBe(2);
    expect(s.links.some((l) => l.source === "from:f.com")).toBe(false);

    // Nine visits to /a (2) and /b to /h (1 each): /g and /h fall outside the top six first pages.
    const pages = ["/a", "/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h"];
    const byPage = summariseFlow(pages.map((p, i) => view(`p${i}`, "2026-11-04", "09:00:00", p)), 30);
    expect(linkValue(byPage, "from:Direct", "first:Other")).toBe(2);
    expect(linkValue(byPage, "first:Other", "next:Left")).toBe(2);
    expect(linkValue(byPage, "from:Direct", "first:/a")).toBe(2);

    // Eight visits whose second pages are /n1 (2) and /n2 to /n8 (1 each): /n7 and /n8 fall outside the top six.
    const nexts = ["/n1", "/n1", "/n2", "/n3", "/n4", "/n5", "/n6", "/n7", "/n8"];
    const rowsNext = nexts.flatMap((p, i) => [
      view(`q${i}`, "2026-11-04", "08:00:00", "/"),
      view(`q${i}`, "2026-11-04", "08:01:00", p),
    ]);
    const byNext = summariseFlow(rowsNext, 30);
    expect(linkValue(byNext, "first:/", "next:Other")).toBe(2);
    expect(linkValue(byNext, "first:/", "next:/n1")).toBe(2);
  });

  it("counts two visitors on the same day as two visits", () => {
    const s = summariseFlow(
      [view("v1", "2026-11-04", "10:00:00", "/"), view("v2", "2026-11-04", "10:00:00", "/")],
      30
    );
    expect(s.visits).toBe(2);
    expect(linkValue(s, "from:Direct", "first:/")).toBe(2);
  });

  it("counts the same visitor hash on two days as two visits", () => {
    const s = summariseFlow(
      [view("v1", "2026-11-04", "10:00:00", "/"), view("v1", "2026-11-05", "10:00:00", "/")],
      30
    );
    expect(s.visits).toBe(2);
  });
});

describe("flowSummary", () => {
  it("is empty and disabled while the referrers switch is off", async () => {
    const p = await newProject(userId, serverId);
    const db = await getDb();
    await db.insert(schema.pageviews).values({
      projectId: p,
      at: new Date("2026-11-04T10:00:00Z"),
      path: "/",
      referrer: "news.example",
      visitor: "v1",
    });
    expect(await flowSummary(userId, p, 30, now)).toEqual({ days: 30, enabled: false, visits: 0, links: [] });
  });

  it("builds the flow from stored page views of this project only, in the range", async () => {
    const p = await newProject(userId, serverId);
    const other = await newProject(userId, serverId);
    await updateFeatures(userId, p, { referrers: true });
    const db = await getDb();
    const rows = [
      { projectId: p, at: "2026-11-04T10:00:00Z", path: "/", referrer: "news.example", visitor: "v1" },
      { projectId: p, at: "2026-11-04T10:01:00Z", path: "/pricing", referrer: null, visitor: "v1" },
      { projectId: p, at: "2026-11-04T11:00:00Z", path: "/", referrer: null, visitor: "v2" },
      { projectId: p, at: "2026-09-01T11:00:00Z", path: "/old", referrer: null, visitor: "v3" },
      { projectId: other, at: "2026-11-04T11:30:00Z", path: "/", referrer: "other.example", visitor: "v9" },
    ];
    for (const r of rows) await db.insert(schema.pageviews).values({ ...r, at: new Date(r.at) });
    const s = await flowSummary(userId, p, 30, now);
    expect(s.enabled).toBe(true);
    expect(s.visits).toBe(2);
    expect(linkValue(s, "from:news.example", "first:/")).toBe(1);
    expect(linkValue(s, "from:Direct", "first:/")).toBe(1);
    expect(linkValue(s, "first:/", "next:/pricing")).toBe(1);
    expect(linkValue(s, "first:/", "next:Left")).toBe(1);
    expect(s.links.some((l) => l.target === "first:/old" || l.source === "from:other.example")).toBe(false);
  });

  it("refuses another user's project with a 404", async () => {
    const theirs = await newProject(otherId, otherServerId);
    await expect(flowSummary(userId, theirs, 30, now)).rejects.toMatchObject({ status: 404 });
  });
});
