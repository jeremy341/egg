import type { NextRequest } from "next/server";
import { config } from "@/server/config";
import { jsonWithEtag } from "@/server/etag";
import { OAUTH_SCOPES } from "@/server/oauth";

/**
 * RFC 8414 authorization-server metadata. Identical for every visitor, so it
 * is safe to cache publicly and supports conditional GETs like /openapi.json.
 */
export function GET(req?: NextRequest) {
  const issuer = config().APP_URL;
  const base = issuer.replace(/\/+$/, "");

  return jsonWithEtag(
    req,
    {
      issuer,
      authorization_endpoint: `${base}/api/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      revocation_endpoint: `${base}/api/oauth/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: OAUTH_SCOPES,
    },
    "public, max-age=300"
  );
}
