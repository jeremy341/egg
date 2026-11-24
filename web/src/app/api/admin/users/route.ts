import type { NextRequest } from "next/server";
import { listUsersForAdmin } from "@/server/admin-users";
import { authed, handle, ok } from "@/server/http";

/** Account search for administrators. The service refuses anyone who is not an administrator. */
export const GET = handle(async (req: NextRequest) => {
  const user = await authed();
  const res = ok(await listUsersForAdmin(user.id, req.nextUrl.searchParams.get("q")));
  res.headers.set("Cache-Control", "private, no-store");
  return res;
});
