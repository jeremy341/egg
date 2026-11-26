import { checkDomainApp, verifyDomain } from "@/server/domains";
import { HttpError, authed, handle, ok } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";

// DNS lookups cost real time, so checking a domain gets its own small per-user budget.
const CHECK = { key: "domains:verify", limit: 12, windowMs: 60_000 };

type Ctx = { params: Promise<{ id: string }> };

/**
 * DNS check first (status and reason are unchanged), then, if DNS is right,
 * the app check over HTTPS. The result is added as `app`.
 */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const result = rateLimiter().check(`${CHECK.key}:${user.id}`, CHECK.limit, CHECK.windowMs);
  if (!result.allowed) {
    const seconds = result.retryAfterSeconds;
    throw new HttpError(
      429,
      `Too many domain checks. Wait ${seconds} second${seconds === 1 ? "" : "s"} and try again.`,
      "rate_limited",
      { "Retry-After": String(seconds) }
    );
  }
  const { id } = await params;
  const dns = await verifyDomain(user.id, id);
  const app = await checkDomainApp(user.id, id, dns.status);
  return ok({ ...dns, app });
});
