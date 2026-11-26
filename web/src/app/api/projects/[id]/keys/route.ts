import { NextResponse } from "next/server";
import { createProjectKey, createProjectKeyInput } from "@/server/ssh-keys";
import { rateLimiter } from "@/server/rate-limit";
import { HttpError, authed, handle, readJson } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Create a project's key. A git key returns its private half once; a GitHub
 * deploy key returns none, since it stays sealed inside Egg.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const input = await readJson(req, createProjectKeyInput);
  const rate = rateLimiter().check(`ssh-keys:${user.id}`, 20, 60_000);
  if (!rate.allowed) throw new HttpError(429, "Too many SSH key changes. Try again shortly.", "rate_limited", { "Retry-After": String(rate.retryAfterSeconds) });
  const { key, privateKey } = await createProjectKey(user.id, id, input);
  return NextResponse.json({ key, privateKey }, { status: 201, headers: NO_STORE });
});
