import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { getActiveAccountCleanup, requestAccountCleanup } from "@/server/cleanup";

export const GET = handle(async () => {
  const user = await authed();
  return ok({ cleanup: await getActiveAccountCleanup(user.id) });
});
export const POST = handle(async (req) => {
  const user = await authed();
  const body = await readJson(req, z.object({ confirm: z.string().max(200) }));
  return ok({ cleanup: await requestAccountCleanup(user.id, user.name, body.confirm) }, 202);
});
