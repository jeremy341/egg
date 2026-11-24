import { NextResponse } from "next/server";
import { createPersonalKey, createPersonalKeyInput, listKeysForUser } from "@/server/ssh-keys";
import { rateLimiter } from "@/server/rate-limit";
import { HttpError, authed, handle, readJson } from "@/server/http";

/** Never cache anything here: a response can hold a private key. */
const NO_STORE = { "Cache-Control": "no-store" };

/** The signed-in user's keys, revoked ones included. The list never carries a private key. */
export const GET = handle(async () => {
  const user = await authed();
  return NextResponse.json({ keys: await listKeysForUser(user.id) }, { headers: NO_STORE });
});

/**
 * Create a personal key. The response carries the private key once; it cannot
 * be read again. Browser sign-in only: a bearer token cannot reach this route.
 */
export const POST = handle(async (req) => {
  const user = await authed();
  const input = await readJson(req, createPersonalKeyInput);
  const rate = rateLimiter().check(`ssh-keys:${user.id}`, 20, 60_000);
  if (!rate.allowed) throw new HttpError(429, "Too many SSH key changes. Try again shortly.", "rate_limited", { "Retry-After": String(rate.retryAfterSeconds) });
  const { key, privateKey } = await createPersonalKey(user.id, input);
  return NextResponse.json({ key, privateKey }, { status: 201, headers: NO_STORE });
});
