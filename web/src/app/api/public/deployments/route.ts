import type { NextRequest } from "next/server";
import { connection } from "next/server";
import { jsonWithEtag } from "@/server/etag";
import { handle } from "@/server/http";
import { getPublicFeed } from "@/server/public-feed-cache";
import { clientIp, enforceRateLimit } from "@/server/rate-limit";

/**
 * The latest deployments of projects whose owners chose to show them on the Egg homepage, public
 * repositories only (see server/public-feed.ts for exactly which fields and why). Anyone may read it:
 * no sign-in, no cookie. The data is built at most once a minute however many people ask, and
 * browsers and CDNs may keep it for the same minute. An ETag lets a client that already has it get an
 * empty 304. Per client address it is rate limited like the other public routes.
 */
export const GET = handle(async (req: NextRequest) => {
  await connection();
  enforceRateLimit("publicFeed", clientIp(req.headers) ?? "unknown-client");
  const deployments = await getPublicFeed();
  return jsonWithEtag(req, { deployments }, "public, max-age=60");
});
