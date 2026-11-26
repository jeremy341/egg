import { NextResponse } from "next/server";
import { rotateProjectKey, rotateProjectKeyInput } from "@/server/ssh-keys";
import { rateLimiter } from "@/server/rate-limit";
import { HttpError, authed, handle, readJson } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Replace the project's active key of this kind. The response carries the new
 * private key once when it is a git key; `removedFromGithub` says whether the
 * old deploy key was taken off GitHub.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const input = await readJson(req, rotateProjectKeyInput);
  const rate = rateLimiter().check(`ssh-keys:${user.id}`, 20, 60_000);
  if (!rate.allowed) throw new HttpError(429, "Too many SSH key changes. Try again shortly.", "rate_limited", { "Retry-After": String(rate.retryAfterSeconds) });
  const { key, privateKey, removedFromGithub } = await rotateProjectKey(user.id, id, input);
  return NextResponse.json({ key, privateKey, removedFromGithub }, { headers: NO_STORE });
});
