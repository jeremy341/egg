import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { resolveProjectAccess } from "@/server/permissions";
import { acceptTransfer, cancelTransfer, declineTransfer, pendingTransfersFor, requestTransfer, TRANSFER_DAYS } from "@/server/ownership-transfer";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const t0 = new Date("2026-11-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  ctx = await useFreshDb();
  const ids = ["owner", "member", "outsider", "gone", "orgless"];
  await ctx.db.insert(schema.users).values(ids.map((id) => ({ id, hackClubId: id, name: id, email: `${id}@example.com`, createdAt: t0 })));
  await ctx.db.insert(schema.servers).values({ id: "s", userId: "owner", nestUsername: "owner", host: "host", publicKey: "key", privateKeyEnc: "sealed", keyFingerprint: "fp", createdAt: t0 });
  await ctx.db.insert(schema.organizations).values({ id: "org", name: "Org", slug: "org", ownerId: "owner", createdAt: t0, updatedAt: t0 });
  await ctx.db.insert(schema.orgMembers).values([
    { orgId: "org", userId: "owner", role: "owner", createdAt: t0 },
    { orgId: "org", userId: "member", role: "member", createdAt: t0 },
    { orgId: "org", userId: "gone", role: "member", createdAt: t0 },
  ]);
  const base = { serverId: "s", repoUrl: "https://github.com/a/b", runtime: "node" as const, port: 3000, createdAt: t0, updatedAt: t0 };
  await ctx.db.insert(schema.projects).values([
    { ...base, id: "p", userId: "owner", slug: "p", name: "P", orgId: "org" },
    { ...base, id: "solo", userId: "owner", slug: "solo", name: "Solo", orgId: null },
  ]);
  await ctx.db.insert(schema.projectMembers).values([
    { projectId: "p", userId: "member", role: "member", createdAt: t0 },
    { projectId: "p", userId: "gone", role: "viewer", createdAt: t0 },
    { projectId: "solo", userId: "member", role: "viewer", createdAt: t0 },
  ]);
});
afterAll(async () => ctx.cleanup());

describe("requesting a transfer", () => {
  it("only the current owner can ask; anyone else gets not found", async () => {
    await expect(requestTransfer("member", "p", "member", t0)).rejects.toMatchObject({ status: 404 });
    await expect(requestTransfer("outsider", "p", "member", t0)).rejects.toMatchObject({ status: 404 });
  });

  it("the recipient must already be a project member", async () => {
    await expect(requestTransfer("owner", "p", "outsider", t0)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses transfer to yourself", async () => {
    await expect(requestTransfer("owner", "p", "owner", t0)).rejects.toMatchObject({ status: 400 });
  });

  it("allows one pending request per project", async () => {
    const first = await requestTransfer("owner", "p", "member", t0);
    expect(first.expiresAt.getTime() - t0.getTime()).toBe(TRANSFER_DAYS * DAY);
    await expect(requestTransfer("owner", "p", "gone", t0)).rejects.toMatchObject({ status: 409 });
    expect((await pendingTransfersFor("member", t0)).map((t) => t.id)).toContain(first.id);
    await cancelTransfer("owner", first.id, t0);
  });
});

describe("accepting, declining and expiry", () => {
  it("only the recipient can accept, and the owner keeps the project until they do", async () => {
    const req = await requestTransfer("owner", "p", "member", t0);
    await expect(acceptTransfer("owner", req.id, t0)).rejects.toMatchObject({ status: 404 });
    await expect(acceptTransfer("gone", req.id, t0)).rejects.toMatchObject({ status: 404 });
    expect(await resolveProjectAccess("owner", "p")).toEqual({ view: true, edit: true, admin: true });
    await cancelTransfer("owner", req.id, t0);
  });

  it("accepting moves ownership, and the previous owner stays as admin", async () => {
    const req = await requestTransfer("owner", "p", "member", t0);
    await expect(acceptTransfer("member", req.id, t0)).resolves.toEqual({ projectId: "p" });
    const project = await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, "p")).get();
    expect(project?.userId).toBe("member");
    const oldOwner = await ctx.db
      .select()
      .from(schema.projectMembers)
      .where(eq(schema.projectMembers.userId, "owner"))
      .all();
    expect(oldOwner.find((m) => m.projectId === "p")?.role).toBe("admin");
    // The new owner no longer has a member row for it.
    const newOwnerRow = await ctx.db.select().from(schema.projectMembers).where(eq(schema.projectMembers.userId, "member")).all();
    expect(newOwnerRow.find((m) => m.projectId === "p")).toBeUndefined();
    expect(await resolveProjectAccess("member", "p")).toEqual({ view: true, edit: true, admin: true });
    // The request is used up.
    await expect(acceptTransfer("member", req.id, t0)).rejects.toMatchObject({ status: 410 });
  });

  it("a declined request can not be accepted afterwards", async () => {
    // Reset: the project now belongs to "member"; "owner" is an admin member.
    const req = await requestTransfer("member", "p", "owner", t0);
    await declineTransfer("owner", req.id, t0);
    await expect(acceptTransfer("owner", req.id, t0)).rejects.toMatchObject({ status: 410 });
    expect((await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, "p")).get())?.userId).toBe("member");
  });

  it("an expired request can not be accepted, and it stops blocking a new one", async () => {
    const req = await requestTransfer("member", "p", "owner", t0);
    const late = new Date(t0.getTime() + TRANSFER_DAYS * DAY);
    await expect(acceptTransfer("owner", req.id, late)).rejects.toMatchObject({ status: 410 });
    // A new request is allowed once the old one has lapsed.
    const again = await requestTransfer("member", "p", "owner", late);
    await cancelTransfer("member", again.id, late);
  });

  it("a recipient who lost project membership cannot accept", async () => {
    const req = await requestTransfer("member", "p", "gone", t0);
    await ctx.db.delete(schema.projectMembers).where(eq(schema.projectMembers.userId, "gone"));
    await expect(acceptTransfer("gone", req.id, t0)).rejects.toMatchObject({ status: 409 });
    await cancelTransfer("member", req.id, t0);
    await ctx.db.insert(schema.projectMembers).values({ projectId: "p", userId: "gone", role: "viewer", createdAt: t0 });
  });

  it("a recipient who left the organization cannot accept an org project", async () => {
    const req = await requestTransfer("member", "p", "gone", t0);
    await ctx.db.delete(schema.orgMembers).where(eq(schema.orgMembers.userId, "gone"));
    await expect(acceptTransfer("gone", req.id, t0)).rejects.toMatchObject({ status: 409 });
    await cancelTransfer("member", req.id, t0);
    await ctx.db.insert(schema.orgMembers).values({ orgId: "org", userId: "gone", role: "member", createdAt: t0 });
  });

  it("refuses to accept after the owner changed underneath the request", async () => {
    // Request from "owner" on the solo project; then "owner" is replaced as owner by someone else.
    const req = await requestTransfer("owner", "solo", "member", t0);
    await ctx.db.update(schema.projects).set({ userId: "gone" }).where(eq(schema.projects.id, "solo"));
    await expect(acceptTransfer("member", req.id, t0)).rejects.toMatchObject({ status: 409 });
    await ctx.db.update(schema.projects).set({ userId: "owner" }).where(eq(schema.projects.id, "solo"));
    await cancelTransfer("owner", req.id, t0);
  });

  it("the owner can cancel, and a cancelled request cannot be accepted", async () => {
    const req = await requestTransfer("member", "p", "owner", t0);
    await cancelTransfer("member", req.id, t0);
    await expect(acceptTransfer("owner", req.id, t0)).rejects.toMatchObject({ status: 410 });
  });
});

describe("personal project", () => {
  it("a project with no organization still requires a project membership for the recipient", async () => {
    await expect(requestTransfer("owner", "solo", "outsider", t0)).rejects.toMatchObject({ status: 400 });
    const req = await requestTransfer("owner", "solo", "member", t0);
    await cancelTransfer("owner", req.id, t0);
  });
});
