import { authed, handle, ok } from "@/server/http";
import { listProjectDir } from "@/server/files";
import { enforceRateLimit } from "@/server/rate-limit";

type Ctx = { params: Promise<{ id: string }> };

/** List one folder inside the project's folder on the container, over SSH. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  enforceRateLimit("sshCall", user.id);
  const path = req.nextUrl.searchParams.get("path") ?? "";
  return ok(await listProjectDir(user.id, id, path));
});
