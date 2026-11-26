import { type NextRequest } from "next/server";
import { optedOut, recordHit } from "@/server/analytics-events";
import { handle } from "@/server/http";
import { clientIp } from "@/server/rate-limit";

type Ctx = { params: Promise<{ key: string }> };

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
  return clientIp(req.headers) ?? "0.0.0.0";
}

export const POST = handle<Ctx>(
  async (req, { params }) => {
    const { key } = await params;
    // The script already stays quiet for these. A request that still carries the
    // signal (an old copy of the script, a hand-made call) is not recorded either.
    if (optedOut(req.headers)) return new Response(null, { status: 204, headers: CORS });
    // sendBeacon sends text/plain, so read the body as text and parse it ourselves.
    const raw = await req.text();
    let body: unknown = {};
    try {
      body = JSON.parse(raw.slice(0, 5000));
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
