import { userDetailForAdmin } from "@/server/admin-users";
import { authed, handle, ok } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req, { params }: Ctx) => {
  const user = await authed();
  const res = ok(await userDetailForAdmin(user.id, (await params).id));
  res.headers.set("Cache-Control", "private, no-store");
  return res;
});
