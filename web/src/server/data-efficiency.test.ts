import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { speedSummary, summariseVitals } from "@/server/analytics-speed";
import { projectViews } from "@/server/queries";
import { computeStats } from "@/server/stats";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
beforeAll(async () => {
  ctx = await useFreshDb();
  const date = new Date("2026-11-01T12:00:00Z");
  await ctx.db.insert(schema.users).values([{id:"owner", hackClubId:"owner", name:"Owner", createdAt:date}, {id:"other", hackClubId:"other", name:"Other", createdAt:date}]);
  await ctx.db.insert(schema.servers).values({id:"server", userId:"owner", nestUsername:"owner", host:"host", publicKey:"key", privateKeyEnc:"sealed", keyFingerprint:"fp", createdAt:date});
  await ctx.db.insert(schema.projects).values({id:"project", userId:"owner", serverId:"server", slug:"project", name:"Project", repoUrl:"https://github.com/a/b", runtime:"node", port:3000, createdAt:date, updatedAt:date});
  await ctx.db.insert(schema.projects).values({id:"small", userId:"owner", serverId:"server", slug:"small", name:"Small", repoUrl:"https://github.com/a/b", runtime:"node", port:3001, createdAt:date, updatedAt:date});
  await ctx.db.run(sql`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<20001) INSERT INTO analytics_vitals(project_id,at,path,lcp) SELECT 'project', ${date.getTime()} + x, '/', CASE WHEN x=1 THEN 9000 ELSE 1000 END FROM n`);
  await ctx.db.insert(schema.deployments).values([
    {id:"dep-a", projectId:"project", env:"production", state:"ready", source:"manual", branch:"main", port:3000, releaseId:"a", createdAt:date},
    {id:"dep-z", projectId:"project", env:"production", state:"error", source:"manual", branch:"main", port:3000, releaseId:"z", createdAt:date},
  ]);
  await ctx.db.insert(schema.analyticsVitals).values(Array.from({ length: 52 }, (_, i) => ({
    projectId: "small", at: date, path: "/", lcp: i * 101, cls: i % 2 ? null : i / 100,
    inp: i === 0 ? 200 : null, fcp: null, ttfb: null,
  })));
});
afterAll(async () => ctx.cleanup());
describe("data read bounds", () => {
  it("includes all reports in the requested window, including beyond 20000", async () => {
    const s = await speedSummary("owner", "project", 30, new Date("2026-11-02T00:00:00Z"));
    expect(s.reports).toBe(20001);
    expect(s.metrics[0].bands.map(b => b.reports)).toEqual([20000, 0, 1]);
    expect(s.metrics[0].daily[0].reports).toBe(20001);
    await expect(speedSummary("other", "project", 30)).rejects.toMatchObject({status:404});
  });
  it("resolves timestamp ties consistently and never exposes another owner's project", async () => {
    expect((await projectViews("owner")).find(p => p.id === "project")?.latestDeploymentId).toBe("dep-z");
    expect(await projectViews("other")).toEqual([]);
  });
  it("preserves exact medians, nearest-rank percentiles, daily results and null metrics", async () => {
    const at = new Date("2026-11-01T12:00:00Z");
    const rows = Array.from({ length: 52 }, (_, i) => ({ at, lcp: i * 101, cls: i % 2 ? null : i / 100,
      inp: i === 0 ? 200 : null, fcp: null, ttfb: null }));
    expect(await speedSummary("owner", "small", 30, new Date("2026-11-02T00:00:00Z"))).toEqual(summariseVitals(rows));
  });
  it("excludes negative build durations from exact public percentiles", async () => {
    const at = new Date("2026-11-01T12:00:00Z");
    await ctx.db.insert(schema.deployments).values(Array.from({ length: 52 }, (_, i) => ({
      id: `timing-${i}`, projectId: "small", env: "production" as const, state: "ready" as const,
      source: "manual" as const, branch: "main", port: 3001, releaseId: `timing-${i}`,
      createdAt: at, startedAt: at, finishedAt: new Date(at.getTime() + (i === 51 ? -1 : (i + 1) * 1000)),
    })));
    const s = await computeStats(new Date("2026-11-02T00:00:00Z"));
    expect(s.buildTime).toEqual({ finished: { approx: 51 }, minimumFinished: 50, medianSeconds: 26, p90Seconds: 46 });
  });
});

