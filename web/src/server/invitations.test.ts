import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/server/db";
import { sha256Hex } from "@/server/crypto";
import { setMailSenderForTests, type MailMessage } from "@/server/mail";
import { orgRoleOf, createOrganization } from "@/server/organizations";
import { useFreshDb } from "@/server/test/db";
import {
  INVITATION_DAYS,
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  listInvitations,
  resendInvitation,
} from "@/server/invitations";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let orgId: string;
const t0 = new Date("2026-11-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const sent: MailMessage[] = [];

/** Pull the token out of a link we issued. Tests only; the server never returns it again. */
function tokenFrom(link: string): string {
  return link.split("/invite/")[1];
}

beforeAll(async () => {
  ctx = await useFreshDb();
  const users = [
    { id: "owner", email: "owner@example.com" },
    { id: "admin", email: "admin@example.com" },
    { id: "member", email: "member@example.com" },
    { id: "invitee", email: "invitee@example.com" },
    { id: "other", email: "other@example.com" },
  ];
  await ctx.db.insert(schema.users).values(users.map((u) => ({ id: u.id, hackClubId: u.id, name: u.id, email: u.email, emailVerified: true, createdAt: t0 })));
  const created = await createOrganization("owner", "Acme Labs", t0);
  orgId = created.id;
  await ctx.db.insert(schema.orgMembers).values([
    { orgId, userId: "admin", role: "admin", createdAt: t0 },
    { orgId, userId: "member", role: "member", createdAt: t0 },
  ]);
});
afterAll(async () => {
  setMailSenderForTests(null);
  await ctx.cleanup();
});
afterEach(() => setMailSenderForTests(null));

describe("delivery", () => {
  it("with no email configured, returns a one-time link and stores only its hash", async () => {
    const inv = await createInvitation("owner", orgId, { email: "Invitee@Example.com", role: "member" }, t0);
    expect(inv.delivery).toBe("link");
    if (inv.delivery !== "link") throw new Error("expected link");
    expect(inv.email).toBe("invitee@example.com");
    expect(inv.expiresAt.getTime() - t0.getTime()).toBe(INVITATION_DAYS * DAY);

    const row = await ctx.db.select().from(schema.invitations).where(eq(schema.invitations.id, inv.id)).get();
    expect(row?.tokenHash).toBe(sha256Hex(tokenFrom(inv.link)));
    // The raw token appears nowhere in the stored row.
    expect(JSON.stringify(row)).not.toContain(tokenFrom(inv.link));
    // And the list never returns it.
    const listed = await listInvitations("owner", orgId);
    expect(JSON.stringify(listed)).not.toContain(tokenFrom(inv.link));
  });

  it("with email configured, sends the link to the invited address and returns no link", async () => {
    setMailSenderForTests(async (m) => {
      sent.push(m);
    });
    const inv = await createInvitation("owner", orgId, { email: "mailed@example.com", role: "guest" }, t0);
    expect(inv.delivery).toBe("email");
    expect("link" in inv).toBe(false);
    expect(sent.at(-1)?.to).toBe("mailed@example.com");
    expect(sent.at(-1)?.text).toContain("/invite/");
  });

  it("falls back to a one-time link when the email send fails", async () => {
    setMailSenderForTests(async () => {
      throw new Error("down");
    });
    // The override throws, which sendMail reports as false.
    const inv = await createInvitation("owner", orgId, { email: "fallback@example.com", role: "member" }, t0);
    expect(inv.delivery).toBe("link");
  });

  it("refuses an address that is already a member, and a bad address", async () => {
    await expect(createInvitation("owner", orgId, { email: "member@example.com", role: "member" }, t0)).rejects.toMatchObject({ status: 409 });
    await expect(createInvitation("owner", orgId, { email: "not-an-email", role: "member" }, t0)).rejects.toMatchObject({ status: 400 });
  });
});

describe("who may invite", () => {
  it("lets an admin invite members and guests but not owners", async () => {
    await expect(createInvitation("admin", orgId, { email: "a1@example.com", role: "guest" }, t0)).resolves.toMatchObject({ role: "guest" });
    await expect(createInvitation("admin", orgId, { email: "a2@example.com", role: "owner" }, t0)).rejects.toMatchObject({ status: 403 });
  });

  it("stops a plain member and a stranger from inviting", async () => {
    await expect(createInvitation("member", orgId, { email: "m1@example.com", role: "guest" }, t0)).rejects.toMatchObject({ status: 403 });
    await expect(createInvitation("other", orgId, { email: "o1@example.com", role: "guest" }, t0)).rejects.toMatchObject({ status: 404 });
  });
});

describe("accepting", () => {
  it("joins the organization with the invited role, and works only once", async () => {
    const inv = await createInvitation("owner", orgId, { email: "invitee@example.com", role: "admin" }, t0);
    if (inv.delivery !== "link") throw new Error("expected link");
    const token = tokenFrom(inv.link);

    await expect(acceptInvitation("invitee", token, t0)).resolves.toEqual({ orgId, role: "admin" });
    expect(await orgRoleOf("invitee", orgId)).toBe("admin");
    await expect(acceptInvitation("invitee", token, t0)).rejects.toMatchObject({ status: 410 });
  });

  it("refuses an account whose email is not the invited one", async () => {
    const inv = await createInvitation("owner", orgId, { email: "invitee2@example.com", role: "member" }, t0);
    if (inv.delivery !== "link") throw new Error("expected link");
    await expect(acceptInvitation("other", tokenFrom(inv.link), t0)).rejects.toMatchObject({ status: 403 });
    expect(await orgRoleOf("other", orgId)).toBeNull();
  });

  it("refuses an account whose email is matched but not verified", async () => {
    await ctx.db.insert(schema.users).values({ id: "unver", hackClubId: "unver", name: "unver", email: "unver@example.com", emailVerified: false, createdAt: t0 });
    const inv = await createInvitation("owner", orgId, { email: "unver@example.com", role: "member" }, t0);
    if (inv.delivery !== "link") throw new Error("expected link");
    await expect(acceptInvitation("unver", tokenFrom(inv.link), t0)).rejects.toMatchObject({ status: 403 });
    expect(await orgRoleOf("unver", orgId)).toBeNull();
    await ctx.db.update(schema.users).set({ emailVerified: true }).where(eq(schema.users.id, "unver"));
    await expect(acceptInvitation("unver", tokenFrom(inv.link), t0)).resolves.toMatchObject({ orgId });
  });

  it("does not let two concurrent accepts both succeed", async () => {
    await ctx.db.insert(schema.users).values({ id: "twin", hackClubId: "twin", name: "twin", email: "twin@example.com", emailVerified: true, createdAt: t0 });
    const inv = await createInvitation("owner", orgId, { email: "twin@example.com", role: "member" }, t0);
    if (inv.delivery !== "link") throw new Error("expected link");
    const token = tokenFrom(inv.link);
    const results = await Promise.allSettled([acceptInvitation("twin", token, t0), acceptInvitation("twin", token, t0)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("never demotes an existing member who accepts an invitation with a lower role", async () => {
    // createInvitation refuses an address that is already a member, so seed the row directly.
    const token = "seeded-token-for-demotion-check";
    await ctx.db.insert(schema.invitations).values({
      id: "demote",
      orgId,
      email: "member@example.com",
      role: "guest",
      tokenHash: sha256Hex(token),
      invitedBy: "owner",
      expiresAt: new Date(t0.getTime() + DAY),
      createdAt: t0,
      updatedAt: t0,
    });
    await expect(acceptInvitation("member", token, t0)).resolves.toEqual({ orgId, role: "member" });
    expect(await orgRoleOf("member", orgId)).toBe("member");
  });
});

describe("expiry", () => {
  it("is valid until 7 days exactly, and expired at 7 days", async () => {
    const inv = await createInvitation("owner", orgId, { email: "exp1@example.com", role: "member" }, t0);
    if (inv.delivery !== "link") throw new Error("expected link");
    await ctx.db.insert(schema.users).values({ id: "exp1", hackClubId: "exp1", name: "exp1", email: "exp1@example.com", emailVerified: true, createdAt: t0 });
    const token = tokenFrom(inv.link);
    const justBefore = new Date(t0.getTime() + INVITATION_DAYS * DAY - 1);
    const atExpiry = new Date(t0.getTime() + INVITATION_DAYS * DAY);
    await expect(acceptInvitation("exp1", token, atExpiry)).rejects.toMatchObject({ status: 410 });
    await expect(acceptInvitation("exp1", token, justBefore)).resolves.toMatchObject({ orgId });
  });

  it("an expired invitation can be replaced by resending, and the old link stays dead", async () => {
    await ctx.db.insert(schema.users).values({ id: "exp2", hackClubId: "exp2", name: "exp2", email: "exp2@example.com", emailVerified: true, createdAt: t0 });
    const inv = await createInvitation("owner", orgId, { email: "exp2@example.com", role: "member" }, t0);
    if (inv.delivery !== "link") throw new Error("expected link");
    const oldToken = tokenFrom(inv.link);
    const later = new Date(t0.getTime() + 10 * DAY);
    const again = await resendInvitation("owner", inv.id, later);
    if (again.delivery !== "link") throw new Error("expected link");
    expect(again.expiresAt.getTime()).toBe(later.getTime() + INVITATION_DAYS * DAY);
    await expect(acceptInvitation("exp2", oldToken, later)).rejects.toMatchObject({ status: 404 });
    await expect(acceptInvitation("exp2", tokenFrom(again.link), later)).resolves.toMatchObject({ orgId });
  });
});

describe("resend and cancel", () => {
  it("resend rotates the token; the previous link no longer works", async () => {
    await ctx.db.insert(schema.users).values({ id: "rs", hackClubId: "rs", name: "rs", email: "rs@example.com", emailVerified: true, createdAt: t0 });
    const inv = await createInvitation("owner", orgId, { email: "rs@example.com", role: "guest" }, t0);
    if (inv.delivery !== "link") throw new Error("expected link");
    const again = await resendInvitation("admin", inv.id, t0);
    if (again.delivery !== "link") throw new Error("expected link");
    expect(tokenFrom(again.link)).not.toBe(tokenFrom(inv.link));
    await expect(acceptInvitation("rs", tokenFrom(inv.link), t0)).rejects.toMatchObject({ status: 404 });
    await expect(acceptInvitation("rs", tokenFrom(again.link), t0)).resolves.toMatchObject({ role: "guest" });
  });

  it("a cancelled invitation cannot be accepted", async () => {
    await ctx.db.insert(schema.users).values({ id: "cx", hackClubId: "cx", name: "cx", email: "cx@example.com", emailVerified: true, createdAt: t0 });
    const inv = await createInvitation("owner", orgId, { email: "cx@example.com", role: "member" }, t0);
    if (inv.delivery !== "link") throw new Error("expected link");
    await cancelInvitation("admin", inv.id, t0);
    await expect(acceptInvitation("cx", tokenFrom(inv.link), t0)).rejects.toMatchObject({ status: 410 });
    await expect(resendInvitation("owner", inv.id, t0)).rejects.toMatchObject({ status: 409 });
    expect(await orgRoleOf("cx", orgId)).toBeNull();
  });

  it("a plain member cannot cancel or resend", async () => {
    const inv = await createInvitation("owner", orgId, { email: "guard@example.com", role: "member" }, t0);
    await expect(cancelInvitation("member", inv.id, t0)).rejects.toMatchObject({ status: 403 });
    await expect(resendInvitation("member", inv.id, t0)).rejects.toMatchObject({ status: 403 });
  });
});
