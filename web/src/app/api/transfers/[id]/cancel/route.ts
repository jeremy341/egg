import { authed, handle, ok } from "@/server/http";
import { cancelTransfer } from "@/server/ownership-transfer";

type Ctx = { params: Promise<{ id: string }> };

/** The current owner withdraws a pending request. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  await cancelTransfer(user.id, id);
  return ok({ ok: true });
});
