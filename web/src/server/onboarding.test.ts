import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db";
import { upsertUser } from "@/server/auth/session";
import { clearMarks, getMarks, onboardingFacts, setMark } from "@/server/onboarding";
import { useFreshDb } from "@/server/test/db";

let cleanup: () => Promise<void>;

beforeAll(async () => {
  const t = await useFreshDb();
  cleanup = t.cleanup;
});
afterAll(async () => cleanup());

async function person(id: string) {
  return upsertUser({ id, name: `Person ${id}`, email: null, slackId: null });
}

const day = (d: string) => new Date(`${d}T12:00:00Z`);

async function addServer(userId: string, id: string, status: "connected" | "pending" | "error" | "disconnected") {
  const db = await getDb();
  await db.insert(schema.servers).values({
    id,
    userId,
    nestUsername: `nest-${id}`,
    host: `${id}.private-host.example`,
    publicKey: "ssh-ed25519 AAAA",
    privateKeyEnc: "sealed",
    keyFingerprint: "SHA256:abc",
    status,
    createdAt: day("2026-10-01"),
  });
}

async function addProject(userId: string, id: string, serverId: string, slug: string, createdAt: Date) {
  const db = await getDb();
  await db.insert(schema.projects).values({
    id,
    userId,
    serverId,
    slug,
    name: `Project ${slug}`,
    repoUrl: `https://github.com/example/${slug}`,
    runtime: "node",
    port: 3000,
    createdAt,
    updatedAt: createdAt,
  });
}

async function addDeployment(projectId: string, id: string, state: "queued" | "ready" | "error", createdAt: Date) {
  const db = await getDb();
  await db.insert(schema.deployments).values({
    id,
    projectId,
    env: "production",
    state,
    source: "manual",
    branch: "main",
    port: 3000,
    releaseId: `rel-${id}`,
    createdAt,
  });
}

async function addDomain(userId: string, serverId: string, id: string, status: "pending" | "valid" | "invalid") {
  const db = await getDb();
  await db.insert(schema.domains).values({
    id,
    userId,
    serverId,
    domain: `${id}.example.test`,
    port: 3000,
    status,
    createdAt: day("2026-10-02"), updatedAt: day("2026-10-02")
  });
}

describe("marks", () => {
  it("a person with no row has no marks", async () => {
    const u = await person("ob-none");
    expect(await getMarks(u.id)).toEqual({});
  });

  it("setMark creates the preferences row and later reads see it", async () => {
    const u = await person("ob-create");
    expect(await setMark(u.id, "connect", "done")).toEqual({ connect: "done" });
    expect(await getMarks(u.id)).toEqual({ connect: "done" });

    const db = await getDb();
    const row = await db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, u.id)).get();
    expect(row?.onboarding).toBe('{"connect":"done"}');
    // The other preferences keep their defaults.
    expect(row?.theme).toBe("system");
    expect(row?.analyticsDefaults).toBe("{}");
  });

  it("a mark on one chapter keeps the others", async () => {
    const u = await person("ob-keep");
    await setMark(u.id, "connect", "done");
    expect(await setMark(u.id, "import", "skipped")).toEqual({ connect: "done", import: "skipped" });
    expect(await getMarks(u.id)).toEqual({ connect: "done", import: "skipped" });
  });

  it("overwriting a mark replaces it", async () => {
    const u = await person("ob-overwrite");
    await setMark(u.id, "deploy", "paused");
    expect(await setMark(u.id, "deploy", "done")).toEqual({ deploy: "done" });
    expect(await getMarks(u.id)).toEqual({ deploy: "done" });
  });

  it("clearMarks with a chapter removes only that one", async () => {
    const u = await person("ob-clear-one");
    await setMark(u.id, "connect", "done");
    await setMark(u.id, "address", "skipped");
    expect(await clearMarks(u.id, "connect")).toEqual({ address: "skipped" });
    expect(await getMarks(u.id)).toEqual({ address: "skipped" });
  });

  it("clearMarks with no chapter removes all of them", async () => {
    const u = await person("ob-clear-all");
    await setMark(u.id, "connect", "done");
    await setMark(u.id, "import", "done");
    await setMark(u.id, "deploy", "paused");
    expect(await clearMarks(u.id)).toEqual({});
    expect(await getMarks(u.id)).toEqual({});
  });

  it("clearing a person with no row creates nothing harmful", async () => {
    const u = await person("ob-clear-empty");
    expect(await clearMarks(u.id, "connect")).toEqual({});
    expect(await getMarks(u.id)).toEqual({});
  });

  it("marks set at the same moment all survive", async () => {
    const u = await person("ob-race");
    await Promise.all([setMark(u.id, "connect", "done"), setMark(u.id, "import", "skipped")]);
    expect(await getMarks(u.id)).toEqual({ connect: "done", import: "skipped" });

    // Several rounds of overlapping writes, including the row being created in the first one.
    const fresh = await person("ob-race-fresh");
    for (let round = 0; round < 5; round++) {
      await Promise.all([
        setMark(fresh.id, "connect", "done"),
        setMark(fresh.id, "import", "done"),
        setMark(fresh.id, "deploy", "paused"),
        setMark(fresh.id, "address", "skipped"),
      ]);
      expect(await getMarks(fresh.id)).toEqual({ connect: "done", import: "done", deploy: "paused", address: "skipped" });
    }
    await Promise.all([clearMarks(fresh.id, "import"), setMark(fresh.id, "deploy", "done"), clearMarks(fresh.id, "address")]);
    expect(await getMarks(fresh.id)).toEqual({ connect: "done", deploy: "done" });
  });

  it("one person's marks never show for another", async () => {
    const a = await person("ob-iso-a");
    const b = await person("ob-iso-b");
    await setMark(a.id, "connect", "done");
    expect(await getMarks(b.id)).toEqual({});
    await setMark(b.id, "import", "skipped");
    await clearMarks(b.id);
    expect(await getMarks(a.id)).toEqual({ connect: "done" });
  });

  it("damaged stored text reads as no marks, and the next write repairs it", async () => {
    const u = await person("ob-damaged");
    await setMark(u.id, "connect", "done");
    const db = await getDb();
    await db
      .update(schema.userPreferences)
      .set({ onboarding: "{not json" })
      .where(eq(schema.userPreferences.userId, u.id));
    expect(await getMarks(u.id)).toEqual({});

    expect(await setMark(u.id, "import", "done")).toEqual({ import: "done" });
    const row = await db.select().from(schema.userPreferences).where(eq(schema.userPreferences.userId, u.id)).get();
    expect(JSON.parse(row?.onboarding ?? "null")).toEqual({ import: "done" });
  });

  it("unknown keys in stored text are dropped on the next write", async () => {
    const u = await person("ob-unknown");
    const db = await getDb();
    await setMark(u.id, "connect", "done");
    await db
      .update(schema.userPreferences)
      .set({ onboarding: '{"connect":"done","telepathy":"done","import":"nope"}' })
      .where(eq(schema.userPreferences.userId, u.id));
    expect(await getMarks(u.id)).toEqual({ connect: "done" });
    expect(await setMark(u.id, "deploy", "skipped")).toEqual({ connect: "done", deploy: "skipped" });
  });
});

describe("onboardingFacts", () => {
  it("a brand-new user has zeros and nulls", async () => {
    const u = await person("ob-facts-new");
    expect(await onboardingFacts(u.id)).toEqual({
      servers: [],
      projectCount: 0,
      firstProject: null,
      firstDeployment: null,
      hasActiveDomain: false,
    });
  });

  it("a user with one connected server and no project", async () => {
    const u = await person("ob-facts-server");
    await addServer(u.id, "ob-srv-1", "connected");
    const facts = await onboardingFacts(u.id);
    expect(facts).toEqual({
      servers: [{ status: "connected" }],
      projectCount: 0,
      firstProject: null,
      firstDeployment: null,
      hasActiveDomain: false,
    });
    // Only the status is read from a server: no key or host leaks into the facts.
    expect(Object.keys(facts.servers[0] ?? {})).toEqual(["status"]);
  });

  it("firstDeployment is the newest deployment of the OLDEST project", async () => {
    const u = await person("ob-facts-deploys");
    await addServer(u.id, "ob-srv-2", "connected");
    await addProject(u.id, "ob-proj-old", "ob-srv-2", "old-app", day("2026-11-01"));
    await addProject(u.id, "ob-proj-new", "ob-srv-2", "new-app", day("2026-11-05"));
    await addDeployment("ob-proj-old", "ob-dep-1", "ready", day("2026-11-01"));
    await addDeployment("ob-proj-old", "ob-dep-2", "error", day("2026-11-03"));
    // Newer than the old project's deployments, but on the newer project: must not be picked.
    await addDeployment("ob-proj-new", "ob-dep-3", "queued", day("2026-11-06"));

    const facts = await onboardingFacts(u.id);
    expect(facts.projectCount).toBe(2);
    expect(facts.firstProject).toEqual({ slug: "old-app" });
    expect(facts.firstDeployment).toEqual({ state: "error" });
    expect(facts.hasActiveDomain).toBe(false);
  });

  it("a project with no deployment gives a null firstDeployment", async () => {
    const u = await person("ob-facts-nodeploy");
    await addServer(u.id, "ob-srv-3", "pending");
    await addProject(u.id, "ob-proj-solo", "ob-srv-3", "solo", day("2026-11-02"));
    const facts = await onboardingFacts(u.id);
    expect(facts.projectCount).toBe(1);
    expect(facts.firstProject).toEqual({ slug: "solo" });
    expect(facts.firstDeployment).toBeNull();
    expect(facts.servers).toEqual([{ status: "pending" }]);
  });

  it("a valid domain counts as an active domain", async () => {
    const u = await person("ob-facts-valid");
    await addServer(u.id, "ob-srv-4", "connected");
    await addDomain(u.id, "ob-srv-4", "ob-dom-valid", "valid");
    expect((await onboardingFacts(u.id)).hasActiveDomain).toBe(true);
  });

  it("a pending domain does not count", async () => {
    const u = await person("ob-facts-pending");
    await addServer(u.id, "ob-srv-5", "connected");
    await addDomain(u.id, "ob-srv-5", "ob-dom-pending", "pending");
    await addDomain(u.id, "ob-srv-5", "ob-dom-invalid", "invalid");
    expect((await onboardingFacts(u.id)).hasActiveDomain).toBe(false);
  });

  it("another person's servers, projects and domains are not counted", async () => {
    const owner = await person("ob-facts-owner");
    const other = await person("ob-facts-other");
    await addServer(owner.id, "ob-srv-6", "connected");
    await addProject(owner.id, "ob-proj-owner", "ob-srv-6", "owned", day("2026-11-01"));
    await addDomain(owner.id, "ob-srv-6", "ob-dom-owner", "valid");
    const facts = await onboardingFacts(other.id);
    expect(facts.servers).toEqual([]);
    expect(facts.projectCount).toBe(0);
    expect(facts.hasActiveDomain).toBe(false);
  });
});
