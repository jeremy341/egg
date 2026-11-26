import { z } from "zod";
import { readTextLimited } from "@/server/body-limit";
import { requireProjectFeature } from "@/server/permission-guards";
import { authed, handle, HttpError, notFound, ok, zodToHttp } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";
import { isSessionId, terminals, TERMINAL_LIMITS } from "@/server/terminal";

type Ctx = { params: Promise<{ id: string; sessionId: string }> };

// JSON escaping can make a payload several times longer than the keystrokes it
// carries, so the body gets generous room; the byte limit is checked on `data`.
const MAX_BODY_BYTES = 8 * TERMINAL_LIMITS.inputBytes;

const input = z.object({ data: z.string().min(1).max(TERMINAL_LIMITS.inputBytes) });

/**
 * Keystrokes from the browser. Same-origin only (the handle wrapper), owner
 * only, at most 8 KB per request and 300 requests a minute per user. Counts as activity for the idle timer.
 * The body is never logged.
 */
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id, sessionId } = await params;
  // The terminal switch is read on every call, so turning it off stops input and output at once.
  await requireProjectFeature(user.id, id, "terminal");
  if (!isSessionId(sessionId)) throw notFound("Terminal session not found");
  enforceRateLimit("terminalInput", user.id);
  // Counted as it arrives, so a body with no Content-Length cannot be larger than this either.
  const text = await readTextLimited(req, MAX_BODY_BYTES).catch((e: unknown) => {
    if (e instanceof HttpError && e.status === 413) throw new HttpError(413, "That is too much input at once.", "too_large");
    throw e;
  });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be JSON", "bad_json");
  }
  const parsed = input.safeParse(json);
  if (!parsed.success) throw zodToHttp(parsed.error);
  const { data } = parsed.data;
  const info = terminals().write(user.id, id, sessionId, data);
  return ok({ expiresAt: info.expiresAt, serverNow: info.serverNow });
});
