import { authed, handle, ok } from "@/server/http";
import { declineTransfer } from "@/server/ownership-transfer";

type Ctx = { params: Promise<{ id: string }> };

/** The recipient declines. The owner keeps the project. */
export const POST = handle<Ctx>(async (_req, { params }) => {
  const user = await authed();
  const { id } = await params;
  await declineTransfer(user.id, id);
  return ok({ ok: true });
});
