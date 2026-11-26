import { readJsonLimited } from "@/server/body-limit";
import { addDomain, listDomains } from "@/server/domains";
import { HttpError, authed, handle, ok } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";

/** Small per-user, per-minute buckets for the browser domain routes (v1 has its own API budget). */
const LIST = { key: "domains:list", limit: 60, windowMs: 60_000 };
const WRITE = { key: "domains:write", limit: 20, windowMs: 60_000 };

function take(userId: string, rate: typeof LIST) {
  const result = rateLimiter().check(`${rate.key}:${userId}`, rate.limit, rate.windowMs);
  if (result.allowed) return;
  const seconds = result.retryAfterSeconds;
  throw new HttpError(
    429,
    `Too many domain requests. Wait ${seconds} second${seconds === 1 ? "" : "s"} and try again.`,
    "rate_limited",
    { "Retry-After": String(seconds) }
  );
}

export const GET = handle(async () => {
  const user = await authed();
  take(user.id, LIST);
  return ok({ domains: await listDomains(user.id) });
});

export const POST = handle(async (req) => {
  const user = await authed();
  take(user.id, WRITE);
  const body = await readJsonLimited(req, { fallback: {} });
  return ok(await addDomain(user.id, body), 201);
});
