import type { NextRequest } from "next/server";
import { jsonWithEtag } from "@/server/etag";
import { buildOpenApi } from "@/server/api-v1-openapi";

/** Public on purpose: it describes the API and holds no data. */
export function GET(req?: NextRequest) {
  return jsonWithEtag(req, buildOpenApi(), "public, max-age=300");
}
