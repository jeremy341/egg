import type { NextRequest } from "next/server";
import { config } from "@/server/config";
import { jsonWithEtag } from "@/server/etag";
import { protectedResourceMetadata } from "@/server/oauth";

/**
 * RFC 9728 protected-resource metadata for the MCP endpoint. Clients find it
 * from the `resource_metadata` parameter on a 401 from /api/mcp, then learn
 * which authorization server to sign in with. Identical for every visitor.
 */
export function GET(req?: NextRequest) {
  return jsonWithEtag(req, protectedResourceMetadata(config().APP_URL), "public, max-age=300");
}
