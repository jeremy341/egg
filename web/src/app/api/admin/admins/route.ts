import type { NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, isFreshAuth } from "@/server/auth/session";
import { authed, handle, ok, readJson } from "@/server/http";
import { grantInstanceAdmin, listInstanceAdmins, revokeInstanceAdmin } from "@/server/instance-admins";
import { enforceRateLimit } from "@/server/rate-limit";

/** Administrators: list them, grant with a verified email, or remove a granted one. Each change needs a fresh sign-in. */

// The service validates the body itself, so the route only needs to read it.
const anything = z.unknown();

export const GET = handle(async () => {
  const user = await authed();
  const res = ok(await listInstanceAdmins(user.id));
  res.headers.set("Cache-Control", "no-store");
  return res;
});

export const POST = handle(async (req: NextRequest) => {
  const user = await authed();
  enforceRateLimit("adminGrant", user.id);
  const body = await readJson(req, anything);
  const fresh = await isFreshAuth(req.cookies.get(SESSION_COOKIE)?.value);
  return ok(await grantInstanceAdmin(user.id, body, fresh), 201);
});

export const DELETE = handle(async (req: NextRequest) => {
  const user = await authed();
  enforceRateLimit("adminGrant", user.id);
  const body = await readJson(req, anything);
  const fresh = await isFreshAuth(req.cookies.get(SESSION_COOKIE)?.value);
  return ok(await revokeInstanceAdmin(user.id, body, fresh));
});
