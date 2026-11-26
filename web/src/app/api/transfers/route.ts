import { authed, handle, ok } from "@/server/http";
import { pendingTransfersFor } from "@/server/ownership-transfer";

/** Transfers waiting for the signed-in user to accept or decline. */
export const GET = handle(async () => {
  const user = await authed();
  return ok({ transfers: await pendingTransfersFor(user.id) });
});
