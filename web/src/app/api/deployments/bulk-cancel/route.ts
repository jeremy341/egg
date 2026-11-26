import { z } from "zod";
import { MAX_BULK, cancelPreview, runBulk } from "@/server/deployments-bulk";
import { authed, handle, ok, readJson } from "@/server/http";
import { enforceRateLimit } from "@/server/rate-limit";

const Body = z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(MAX_BULK) });

/** Per-item results: { results: [{ id, ok, message? }] }. Each id is checked on its own. */
export const POST = handle(async (req) => {
  const user = await authed();
  const { ids } = await readJson(req, Body);
  // Every id opens a fresh SSH session. Charge the shared slow-call bucket for the request, then charge a
  // dedicated per-item bucket so one request cannot open up to MAX_BULK sessions in one minute.
  enforceRateLimit("sshCall", user.id);
  for (let i = 0; i < ids.length; i++) enforceRateLimit("bulkSsh", user.id);
  const results = await runBulk(ids, (id) => cancelPreview(user.id, id));
  return ok({ results });
});
