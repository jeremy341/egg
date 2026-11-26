import { authed, handle, ok } from "@/server/http";
import { acceptTransfer } from "@/server/ownership-transfer";

type Ctx = { params: Promise<{ id: string }> };

/** The recipient accepts. Everything is re-checked at this moment. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  return ok(await acceptTransfer(user.id, id));
});
