import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { cancelCleanup, getCleanupStatus, retryCleanup } from "@/server/cleanup";
type Ctx = { params: Promise<{ id: string }> };
export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  return ok({ cleanup: await getCleanupStatus(user.id, (await params).id) });
});
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const body = await readJson(req, z.object({ confirmIdle: z.boolean().default(false) }));
  return ok({ cleanup: await retryCleanup(user.id, (await params).id, body.confirmIdle === true) });
});
export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  await cancelCleanup(user.id, (await params).id);
  return ok({ ok: true });
});
