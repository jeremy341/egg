import { NextResponse } from "next/server";
import { revokeKey } from "@/server/ssh-keys";
import { rateLimiter } from "@/server/rate-limit";
import { HttpError, authed, handle } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Revoke one of the signed-in user's keys. A deploy key is removed from GitHub
 * first; if GitHub refuses, the key stays active. Someone else's key, or one
 * already revoked, is a 404.
 */
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const rate = rateLimiter().check(`ssh-keys:${user.id}`, 20, 60_000);
  if (!rate.allowed) throw new HttpError(429, "Too many SSH key changes. Try again shortly.", "rate_limited", { "Retry-After": String(rate.retryAfterSeconds) });
  await revokeKey(user.id, id);
  return NextResponse.json({ revoked: true }, { headers: NO_STORE });
});
