import type { NextRequest } from "next/server";
import { config } from "@/server/config";
import { jsonWithEtag } from "@/server/etag";
import { protectedResourceMetadata } from "@/server/oauth";

/** The same RFC 9728 document at the unsuffixed path, for clients that probe the root. */
export function GET(req?: NextRequest) {
  return jsonWithEtag(req, protectedResourceMetadata(config().APP_URL), "public, max-age=300");
}
