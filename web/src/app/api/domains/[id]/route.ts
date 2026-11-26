import { readJsonLimited } from "@/server/body-limit";
import { removeDomain, updateDomain } from "@/server/domains";
import { HttpError, authed, handle, ok } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";

// Same per-user write budget as adding a domain: re-pointing and removing are writes too.
const WRITE = { key: "domains:write", limit: 20, windowMs: 60_000 };

type Ctx = { params: Promise<{ id: string }> };

function take(userId: string) {
  const result = rateLimiter().check(`${WRITE.key}:${userId}`, WRITE.limit, WRITE.windowMs);
  if (result.allowed) return;
  const seconds = result.retryAfterSeconds;
  throw new HttpError(
    429,
    `Too many domain requests. Wait ${seconds} second${seconds === 1 ? "" : "s"} and try again.`,
    "rate_limited",
    { "Retry-After": String(seconds) }
  );
}

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  take(user.id);
  const { id } = await params;
  return ok(await updateDomain(user.id, id, await readJsonLimited(req, { fallback: {} })));
});

export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  take(user.id);
  const { id } = await params;
  await removeDomain(user.id, id);
  return ok({ ok: true });
});
