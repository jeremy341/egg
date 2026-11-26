import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { upsertUser } from "@/server/auth/session";
import { getDb, schema } from "@/server/db";
import { buildPublicFeed } from "@/server/public-feed";
import { getPreferences, updatePreferences } from "@/server/preferences";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { enableStatusPage, publicStatus } from "@/server/status-page";
import { useFreshDb } from "@/server/test/db";

// The Hack Club name and the email must never reach a public page.
const HC_NAME = "Samantha Hackclub";
const EMAIL = "samantha@example.test";
const SHA = "e".repeat(40);

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let userId: string;
let projectId: string;
let statusKey: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  const user = await upsertUser({ id: "names-owner", name: HC_NAME, email: EMAIL, slackId: null });
  userId = user.id;
  const serverId = (await createServer(userId, "names-owner")).id;
  projectId = (
    await createProject(userId, {
      serverId,
      name: "Names app",
      repoUrl: "https://github.com/sam/names.git",
      runtime: "node",
      port: 3000,
      slug: "names-app",
    })
  ).id;
  const db = await getDb();
  await db
    .update(schema.projects)
    .set({ repoFullName: "sam/names", installationId: 9001, homepageFeed: true, monitorState: "up" })
    .where(eq(schema.projects.id, projectId));
  await db.insert(schema.deployments).values({
    id: "names-dep-1",
    projectId,
    env: "production",
    state: "ready",
    source: "manual",
    branch: "main",
    port: 3000,
    releaseId: "names-rel-1",
    commitSha: SHA,
    commitMessage: "Ship the names",
    createdAt: new Date("2026-11-20T10:00:00Z"),
  });
  statusKey = (await enableStatusPage(userId, projectId)).key;
});

afterAll(async () => {
  await ctx.cleanup();
});

const publicFeed = () => buildPublicFeed({ visibility: async () => "public" });

describe("the public name on the homepage feed", () => {
  it("is Someone until the person sets a display name", async () => {
    const [row] = await publicFeed();
    expect(row?.by).toBe("Someone");
  });

  it("is the display name once one is set and the switch is on", async () => {
    await updatePreferences(userId, { displayName: "Sam" });
    const [row] = await publicFeed();
    expect(row?.by).toBe("Sam");
  });

  it("is Someone when the switch is off, even with a display name", async () => {
    await updatePreferences(userId, { showNamePublic: false });
    expect((await getPreferences(userId)).showNamePublic).toBe(false);
    const [row] = await publicFeed();
    expect(row?.by).toBe("Someone");
  });

  it("never contains the Hack Club name or the email, in any switch position", async () => {
    for (const on of [true, false]) {
      await updatePreferences(userId, { showNamePublic: on });
      const text = JSON.stringify(await publicFeed());
      expect(text).not.toContain(HC_NAME);
      expect(text).not.toContain("Samantha");
      expect(text).not.toContain(EMAIL);
    }
  });
});

describe("the public name on a status page", () => {
  it("shows the display name while the switch is on", async () => {
    await updatePreferences(userId, { showNamePublic: true, displayName: "Sam" });
    const status = await publicStatus(statusKey);
    expect(status?.owner).toBe("Sam");
  });

  it("shows Someone when the switch is off", async () => {
    await updatePreferences(userId, { showNamePublic: false });
    const status = await publicStatus(statusKey);
    expect(status?.owner).toBe("Someone");
  });

  it("shows Someone when no display name is set, and never the Hack Club name", async () => {
    await updatePreferences(userId, { showNamePublic: true, displayName: null });
    const status = await publicStatus(statusKey);
    expect(status?.owner).toBe("Someone");
    const text = JSON.stringify(status);
    expect(text).not.toContain(HC_NAME);
    expect(text).not.toContain(EMAIL);
  });
});

describe("the switch", () => {
  it("is stored per person and defaults to on for someone who has never saved preferences", async () => {
    const fresh = await upsertUser({ id: "names-fresh", name: "Fresh Person", email: null, slackId: null });
    expect((await getPreferences(fresh.id)).showNamePublic).toBe(true);
  });

  it("refuses a value that is not true or false", async () => {
    await expect(updatePreferences(userId, { showNamePublic: "no" as unknown as boolean })).rejects.toMatchObject({
      status: 400,
    });
  });
});
