import { authed, handle, ok } from "@/server/http";
import { listGrafts, requireGraftAdmin } from "@/server/grafts/registry";

export const GET = handle(async () => {
  const user = await authed();
  await requireGraftAdmin(user.id);
  return ok({ grafts: await listGrafts() });
});
