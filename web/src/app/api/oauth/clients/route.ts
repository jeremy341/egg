import { NextResponse } from "next/server";
import { authed, handle, HttpError, notFound } from "@/server/http";
import { listUserClients, revokeClient } from "@/server/oauth";

/** The list exposes client ids and redirect URIs, so never cache it. */
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The signed-in user's registered OAuth clients. There is no admin surface:
 * the session user is the only owner the server is asked about. Secrets and
 * hashes never leave the server module.
 */
export const GET = handle(async () => {
  const user = await authed();
  return NextResponse.json({ clients: await listUserClients(user.id) }, { headers: NO_STORE });
});

/**
 * Revoke one of the signed-in user's OAuth clients. `id` is the client's row
 * id, not its public `client_id`. The server layer removes the client's grants
 * and issued tokens with it. Someone else's or an unknown id is a 404.
 */
export const DELETE = handle(async (req) => {
  const user = await authed();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) throw new HttpError(400, "Give the id of the client to revoke.", "validation");
  if (!(await revokeClient(user.id, id))) throw notFound("OAuth client not found");
  return NextResponse.json({ revoked: true }, { headers: NO_STORE });
});
