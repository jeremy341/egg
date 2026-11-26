import { z } from "zod";
import { authed, handle, ok, readJson } from "@/server/http";
import { acceptInvitation } from "@/server/invitations";

/**
 * Accept with the token from the invitation link. The token travels in the
 * body, not the URL, so it stays out of access logs. The signed-in account's
 * verified email must match the invited address.
 */
export const POST = handle(async (req) => {
  const user = await authed();
  const body = await readJson(req, z.object({ token: z.string().min(16).max(200) }));
  return ok(await acceptInvitation(user.id, body.token));
});
