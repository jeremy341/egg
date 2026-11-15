import { z } from "zod";
import { checkProjectConflicts, conflictsInput } from "@/server/adoption";
import { HttpError, authed, handle, ok, readJson } from "@/server/http";
import { rateLimiter } from "@/server/rate-limit";

const body = conflictsInput.extend({ serverId: z.string().min(1).max(100) });

/** Reads cost an SSH session, so they get a small allowance of their own. */
const LIMIT = { limit: 20, windowMs: 60_000 };

/**
 * Ask a container whether a new project would run into something already
 * there: a service, folder or port that is not Nest Deploy's, or the same
 * repository running by hand. Read-only. 404 for a server that is not yours,
 * 429 past 20 requests a minute.
 */
export const POST = handle(async (req) => {
  const user = await authed();
  const input = await readJson(req, body);
  const hit = rateLimiter().check(`projectConflicts:${user.id}`, LIMIT.limit, LIMIT.windowMs);
  if (!hit.allowed) {
    throw new HttpError(
      429,
      `Too many checks. Wait ${hit.retryAfterSeconds} second${hit.retryAfterSeconds === 1 ? "" : "s"} and try again.`,
      "rate_limited",
      { "Retry-After": String(hit.retryAfterSeconds) }
    );
  }
  const { serverId, ...rest } = input;
  return ok({ conflicts: await checkProjectConflicts(user.id, serverId, rest) });
});
