import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { useFreshDb } from "@/server/test/db";
import { getCurrentUser } from "@/server/auth/current";
import type { OrgRole } from "@/server/db/schema";

vi.mock("@/server/auth/current", () => ({
  getCurrentUser: vi.fn(),
  requireUser: vi.fn(),
}));

import { POST as createInvite, GET as listInvites } from "@/app/api/orgs/[id]/invitations/route";
import { POST as resendInvite } from "@/app/api/orgs/[id]/invitations/[invitationId]/resend/route";
import { DELETE as cancelInvite } from "@/app/api/orgs/[id]/invitations/[invitationId]/route";
import { POST as acceptInvite } from "@/app/api/invitations/accept/route";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const t0 = new Date("2026-11-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

beforeAll(async () => {
  ctx = await useFreshDb();
  const rows = [
    { id: "owner", email: "owner@example.com", verified: true },
    { id: "admin", email: "admin@example.com", verified: true },
    { id: "member", email: "member@example.com", verified: true },
    { id: "stranger", email: "stranger@example.com", verified: true },
    { id: "invitee", email: "invitee@example.com", verified: true },
    { id: "other", email: "other@example.com", verified: true },
    { id: "unverified", email: "unverified@example.com", verified: false },
  ];
  await ctx.db.insert(schema.users).values(rows.map((r) => ({ id: r.id, hackClubId: r.id, name: r.id, email: r.email, emailVerified: r.verified, createdAt: t0 })));
});
afterAll(async () => ctx.cleanup());
beforeEach(() => vi.mocked(getCurrentUser).mockResolvedValue(null));

function as(id: string) {
  vi.mocked(getCurrentUser).mockResolvedValue({ id, name: id, email: `${id}@example.com`, hackClubId: id } as never);
}

async function makeOrg(members: [string, OrgRole][]): Promise<string> {
  seq += 1;
  const id = `iorg${seq}`;
  await ctx.db.insert(schema.organizations).values({ id, name: `Org ${seq}`, slug: `iorg-${seq}`, ownerId: "owner", createdAt: t0, updatedAt: t0 });
  await ctx.db.insert(schema.orgMembers).values(members.map(([userId, role]) => ({ orgId: id, userId, role, createdAt: t0 })));
  return id;
}

const ORIGIN = "http://localhost:3000";
function req(method: string, path: string, body?: unknown) {
  return new NextRequest(`${ORIGIN}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const orgCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const invCtx = (id: string, invitationId: string) => ({ params: Promise.resolve({ id, invitationId }) });

/** Invite as an admin of `orgId` and return the invitation id and its one-time token. */
async function invite(orgId: string, email: string, role: OrgRole = "member") {
  as("admin");
  const res = await createInvite(req("POST", "/x", { email, role }), orgCtx(orgId));
  expect(res.status).toBe(201);
  const { invitation } = await res.json();
  expect(invitation.delivery).toBe("link");
  return { id: invitation.id as string, token: (invitation.link as string).split("/invite/")[1] };
}

async function setExpiry(invitationId: string, when: Date) {
  await ctx.db.update(schema.invitations).set({ expiresAt: when }).where(eq(schema.invitations.id, invitationId));
}

describe("POST /api/orgs/[id]/invitations", () => {
  it("refuses a plain member with 403", async () => {
    const org = await makeOrg([["member", "member"]]);
    as("member");
    expect((await createInvite(req("POST", "/x", { email: "x@example.com", role: "guest" }), orgCtx(org))).status).toBe(403);
  });

  it("refuses a non-member with 404", async () => {
    const org = await makeOrg([["member", "member"]]);
    as("stranger");
    expect((await createInvite(req("POST", "/x", { email: "x@example.com", role: "guest" }), orgCtx(org))).status).toBe(404);
  });

  it("lets an admin invite, returns the link once, and refuses an admin inviting an owner", async () => {
    const org = await makeOrg([["admin", "admin"]]);
    const { token } = await invite(org, "invitee@example.com", "member");
    expect(token.length).toBeGreaterThan(20);
    as("admin");
    expect((await createInvite(req("POST", "/x", { email: "other@example.com", role: "owner" }), orgCtx(org))).status).toBe(403);
  });

  it("refuses a malformed email with 400, and an address that is already a member with 409", async () => {
    const org = await makeOrg([["admin", "admin"], ["member", "member"]]);
    as("admin");
    expect((await createInvite(req("POST", "/x", { email: "not-an-email", role: "guest" }), orgCtx(org))).status).toBe(400);
    expect((await createInvite(req("POST", "/x", { email: "member@example.com", role: "guest" }), orgCtx(org))).status).toBe(409);
  });

  it("refuses an unknown role with 400", async () => {
    const org = await makeOrg([["admin", "admin"]]);
    as("admin");
    expect((await createInvite(req("POST", "/x", { email: "x@example.com", role: "king" }), orgCtx(org))).status).toBe(400);
  });
});

describe("GET /api/orgs/[id]/invitations", () => {
  it("lists only pending invitations, without tokens", async () => {
    const org = await makeOrg([["admin", "admin"]]);
    const pending = await invite(org, "invitee@example.com");
    const cancelled = await invite(org, "other@example.com");
    as("admin");
    expect((await cancelInvite(req("DELETE", "/x"), invCtx(org, cancelled.id))).status).toBe(200);
    const body = await (await listInvites(req("GET", "/x"), orgCtx(org))).json();
    const ids = body.invitations.map((i: { id: string }) => i.id);
    expect(ids).toContain(pending.id);
    expect(ids).not.toContain(cancelled.id);
    expect(JSON.stringify(body)).not.toContain(pending.token);
  });

  it("refuses a member with 403", async () => {
    const org = await makeOrg([["member", "member"]]);
    as("member");
    expect((await listInvites(req("GET", "/x"), orgCtx(org))).status).toBe(403);
  });
});

describe("resend", () => {
  it("issues a new link, and the old link stops working at once", async () => {
    const org = await makeOrg([["admin", "admin"]]);
    const first = await invite(org, "invitee@example.com");
    as("admin");
    const res = await resendInvite(req("POST", "/x"), invCtx(org, first.id));
    expect(res.status).toBe(200);
    const newToken = (await res.json()).invitation.link.split("/invite/")[1];
    expect(newToken).not.toBe(first.token);
    as("invitee");
    expect((await acceptInvite(req("POST", "/x", { token: first.token }))).status).toBe(404);
    expect((await acceptInvite(req("POST", "/x", { token: newToken }))).status).toBe(200);
  });

  it("refuses an accepted invitation with 409, and a member with 403", async () => {
    const org = await makeOrg([["admin", "admin"], ["member", "member"]]);
    const inv = await invite(org, "invitee@example.com");
    as("invitee");
    expect((await acceptInvite(req("POST", "/x", { token: inv.token }))).status).toBe(200);
    as("admin");
    expect((await resendInvite(req("POST", "/x"), invCtx(org, inv.id))).status).toBe(409);
    const open = await invite(org, "other@example.com");
    as("member");
    expect((await resendInvite(req("POST", "/x"), invCtx(org, open.id))).status).toBe(403);
  });

  it("refuses an invitation from another organization as not found", async () => {
    const orgA = await makeOrg([["admin", "admin"]]);
    const orgB = await makeOrg([["admin", "admin"]]);
    const inv = await invite(orgA, "invitee@example.com");
    as("admin");
    expect((await resendInvite(req("POST", "/x"), invCtx(orgB, inv.id))).status).toBe(404);
  });
});

describe("cancel", () => {
  it("stops the link at once; accepting a cancelled invitation is 410", async () => {
    const org = await makeOrg([["admin", "admin"]]);
    const inv = await invite(org, "invitee@example.com");
    as("admin");
    expect((await cancelInvite(req("DELETE", "/x"), invCtx(org, inv.id))).status).toBe(200);
    as("invitee");
    expect((await acceptInvite(req("POST", "/x", { token: inv.token }))).status).toBe(410);
  });

  it("refuses to cancel an accepted invitation with 409, a member with 403, and another org's invitation with 404", async () => {
    const org = await makeOrg([["admin", "admin"], ["member", "member"]]);
    const other = await makeOrg([["admin", "admin"]]);
    const accepted = await invite(org, "invitee@example.com");
    as("invitee");
    expect((await acceptInvite(req("POST", "/x", { token: accepted.token }))).status).toBe(200);
    as("admin");
    expect((await cancelInvite(req("DELETE", "/x"), invCtx(org, accepted.id))).status).toBe(409);

    const open = await invite(org, "other@example.com");
    as("member");
    expect((await cancelInvite(req("DELETE", "/x"), invCtx(org, open.id))).status).toBe(403);

    as("admin");
    expect((await cancelInvite(req("DELETE", "/x"), invCtx(other, open.id))).status).toBe(404);
  });
});

describe("POST /api/invitations/accept", () => {
  it("adds the person with the invited role, and the link is one-time", async () => {
    const org = await makeOrg([["admin", "admin"]]);
    const inv = await invite(org, "invitee@example.com", "member");
    as("invitee");
    const res = await acceptInvite(req("POST", "/x", { token: inv.token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: org, role: "member" });
    const again = await acceptInvite(req("POST", "/x", { token: inv.token }));
    expect(again.status).toBe(410);
    expect(JSON.stringify(await again.json())).toMatch(/already used/);
  });

  it("refuses an expired invitation with 410, and does not add the person", async () => {
    const org = await makeOrg([["admin", "admin"]]);
    const inv = await invite(org, "invitee@example.com");
    await setExpiry(inv.id, new Date(Date.now() - DAY));
    as("invitee");
    const res = await acceptInvite(req("POST", "/x", { token: inv.token }));
    expect(res.status).toBe(410);
    expect(JSON.stringify(await res.json())).toMatch(/expired/);
    expect(await ctx.db.select().from(schema.orgMembers).where(eq(schema.orgMembers.orgId, org)).all()).toHaveLength(1);
  });

  it("refuses a different signed-in account with 403", async () => {
    const org = await makeOrg([["admin", "admin"]]);
    const inv = await invite(org, "invitee@example.com");
    as("other");
    expect((await acceptInvite(req("POST", "/x", { token: inv.token }))).status).toBe(403);
  });

  it("refuses an account whose email is not verified, with 403", async () => {
    const org = await makeOrg([["admin", "admin"]]);
    const inv = await invite(org, "unverified@example.com");
    as("unverified");
    expect((await acceptInvite(req("POST", "/x", { token: inv.token }))).status).toBe(403);
  });

  it("refuses an unknown token with 404, and a short token with 400", async () => {
    as("invitee");
    expect((await acceptInvite(req("POST", "/x", { token: "x".repeat(40) }))).status).toBe(404);
    expect((await acceptInvite(req("POST", "/x", { token: "short" }))).status).toBe(400);
  });

  it("keeps an existing member's higher role when they accept a lower invitation", async () => {
    const org = await makeOrg([["admin", "admin"]]);
    // A guest invitation is issued first; the invitee is then made admin by other means before accepting.
    const inv = await invite(org, "invitee@example.com", "guest");
    await ctx.db.insert(schema.orgMembers).values({ orgId: org, userId: "invitee", role: "admin", createdAt: t0 });
    as("invitee");
    const res = await acceptInvite(req("POST", "/x", { token: inv.token }));
    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("admin");
    const row = await ctx.db
      .select()
      .from(schema.orgMembers)
      .where(and(eq(schema.orgMembers.orgId, org), eq(schema.orgMembers.userId, "invitee")))
      .get();
    expect(row?.role).toBe("admin");
  });
});
