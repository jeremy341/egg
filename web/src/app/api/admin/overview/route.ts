import { adminOverview } from "@/server/admin";
import { authed, handle, ok } from "@/server/http";

export const GET = handle(async () => {
  const user = await authed();
  const res = ok(await adminOverview(user.id));
  res.headers.set("Cache-Control", "no-store");
  return res;
});
