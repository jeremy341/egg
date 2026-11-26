import { authed, handle, ok } from "@/server/http";
import { deleteConnection } from "@/server/providers/connections";
export const DELETE = handle(async (req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await authed();
  return ok(await deleteConnection(user.id, (await ctx.params).id, req.nextUrl.searchParams.get("detach") === "true"));
});
