import { z } from "zod";
import { NextResponse } from "next/server";
import { OAUTH_SCOPES, registerClient } from "@/server/oauth";
import { authed, handle, readJson } from "@/server/http";

// The client secret is displayed exactly once (only its hash is stored), so
// intermediaries must never keep a copy of this response.
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * RFC 7591 dynamic client registration. The signed-in user owns the client, so
 * it appears in their settings and can be revoked from there.
 */
const registerBody = z
  .object({
    name: z.string().trim().min(1, "Give the client a name").max(80),
    redirectUris: z
      .array(z.string().url("Each redirect URI must be an absolute URL"))
      .min(1, "At least one redirect URI is required")
      .refine((uris) => new Set(uris).size === uris.length, "Redirect URIs must be unique"),
    scopes: z
      .array(z.enum(OAUTH_SCOPES))
      .min(1, "At least one scope is required")
      .refine((scopes) => new Set(scopes).size === scopes.length, "Scopes must be unique"),
  })
  .strict();

export const POST = handle(async (req) => {
  const user = await authed();
  const input = await readJson(req, registerBody);
  const client = await registerClient({ userId: user.id, ...input });

  return NextResponse.json(
    {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      name: client.name,
      redirect_uris: client.redirectUris,
      scopes: client.scopes,
      client_id_issued_at: Math.floor(new Date(client.createdAt).getTime() / 1000),
      client_secret_expires_at: 0,
      token_endpoint_auth_method: "client_secret_post",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
    { status: 201, headers: NO_STORE }
  );
});
