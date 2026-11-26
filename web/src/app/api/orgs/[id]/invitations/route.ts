import { z } from "zod";
import { ORG_ROLES } from "@/server/db/schema";
import { authed, handle, ok, readJson } from "@/server/http";
import { createInvitation, pendingInvitations } from "@/server/invitations";

type Ctx = { params: Promise<{ id: string }> };

const createBody = z.object({ email: z.string().max(254), role: z.enum(ORG_ROLES) });

/**
 * Invite someone. The response carries the one-time link only when no email
 * is configured; it is never readable again afterwards.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const body = await readJson(req, createBody);
  return ok({ invitation: await createInvitation(user.id, id, body) }, 201);
});

/** Invitations that can still be accepted. Admins only. Never includes a token or link. */
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok({ invitations: await pendingInvitations(user.id, id) });
});
