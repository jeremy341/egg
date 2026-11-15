import { authed, handle, ok } from "@/server/http";
import { readJsonLimited } from "@/server/body-limit";
import { planImport } from "@/server/adoption-import";
type Ctx = { params: Promise<{ id: string }> };
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  const res = ok({ plan: await planImport(user.id, id, await readJsonLimited(req)) }, 201);
  res.headers.set("Cache-Control", "no-store");
  return res;
});
