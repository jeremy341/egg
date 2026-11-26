import type { NextRequest } from "next/server";
import { jsonWithEtag } from "@/server/etag";
import { buildAgentSpec } from "@/server/api-v1-openapi";

/** Public on purpose, like openapi.json: a short index of operations, no data. */
export function GET(req?: NextRequest) {
  return jsonWithEtag(req, buildAgentSpec(), "public, max-age=300");
}
