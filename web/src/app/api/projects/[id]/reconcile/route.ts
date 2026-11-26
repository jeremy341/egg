import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { authenticate } from "@/server/api-v1-http";
import { requireScope, type Scope } from "@/server/api-tokens";
import { inspectRepositoryDrift, reconcileRepository } from "@/server/github/reconcile";

type Ctx = { params: Promise<{ id: string }> };
async function actor(req: Request, scope: Scope) {
  if (req.headers.has("authorization")) { const p = await authenticate(req); requireScope(p, scope); return p.userId; }
  return (await authed()).id;
}
export const GET = handle<Ctx>(async (req, { params }) => {
  const userId = await actor(req, "deployments:read");
  const res = ok(await inspectRepositoryDrift(userId, (await params).id));
  res.headers.set("Cache-Control", "no-store"); return res;
});
export const POST = handle<Ctx>(async (req, { params }) => {
  const userId = await actor(req, "deployments:write");
  const body = await readJson(req, z.object({ confirm: z.literal(true), expectedSha: z.string().regex(/^[0-9a-f]{40}$/i) }).strict());
  return ok(await reconcileRepository(userId, (await params).id, body.expectedSha));
});
