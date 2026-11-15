import { authed, handle, ok } from "@/server/http";
import { readJsonLimited } from "@/server/body-limit";
import { SESSION_COOKIE } from "@/server/auth/session";
import { confirmImport } from "@/server/adoption-import";
type Ctx = { params: Promise<{ id: string; planId: string }> };
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id, planId } = await params;
  await confirmImport(user.id, id, planId, await readJsonLimited(req), req.cookies.get(SESSION_COOKIE)?.value);
  return ok({ imported: true });
});
