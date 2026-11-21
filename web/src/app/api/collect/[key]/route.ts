import { type NextRequest } from "next/server";
import { UNKNOWN_IP } from "@/server/analytics";
import { optedOut, recordHit } from "@/server/analytics-events";
import { handle, HttpError } from "@/server/http";
import { clientIp } from "@/server/rate-limit";
import { readTextLimited } from "@/server/body-limit";

type Ctx = { params: Promise<{ key: string }> };
export const COLLECT_BODY_LIMIT_BYTES = 5_000;

// Any site may report to its own key, so this answers every origin. It only
// ever writes an analytics event; it reads nothing and returns nothing.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Without TRUST_PROXY there is no trusted address, so every visitor counts as one. */
function visitorIp(req: NextRequest): string {
  return clientIp(req.headers) ?? UNKNOWN_IP;
}

export const POST = handle<Ctx>(
  async (req, { params }) => {
    const { key } = await params;
    // The script already stays quiet for these. A request that still carries the
    // signal (an old copy of the script, a hand-made call) is not recorded either.
    if (optedOut(req.headers)) return new Response(null, { status: 204, headers: CORS });
    // sendBeacon sends text/plain, so read the body as text and parse it ourselves.
    let raw: string;
    try {
      raw = await readTextLimited(req, COLLECT_BODY_LIMIT_BYTES);
    } catch (err) {
      // Keep the collector's CORS response shape while refusing to buffer large
      // or chunked bodies. This endpoint deliberately reveals nothing about keys.
      if (err instanceof HttpError && err.status === 413) {
        return new Response(null, { status: 413, headers: CORS });
      }
      throw err;
    }
    let body: unknown = {};
    try {
      body = JSON.parse(raw);
    } catch {
      /* a malformed body is dropped by the validator */
    }
    try {
      await recordHit(key, body, {
        ip: visitorIp(req),
        ua: req.headers.get("user-agent") ?? "",
      });
    } catch {
      /* bad input is dropped, and looks the same as success from outside */
    }
    // The answer is the same whether or not the key exists, so keys cannot be probed.
    return new Response(null, { status: 204, headers: CORS });
  },
  { skipOriginCheck: true }
);
