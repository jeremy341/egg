import { type NextRequest } from "next/server";
import { featuresForKey, NO_FEATURES } from "@/server/analytics-config";
import { buildScript } from "@/server/analytics-script";

/**
 * The analytics snippet, built for the key in the address. It reports the page
 * path and the referring site, once per page load. A project that has switched
 * on clicks, time on page or funnel steps gets those few extra lines and
 * nothing else; with every switch off it is the plain page view script. It does
 * nothing when the browser sends Do Not Track or Global Privacy Control, sets
 * no cookie and stores nothing in the browser.
 *
 * An unknown key, or an older snippet with no key in the address, gets the plain
 * script, so nothing about a key can be probed from here.
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";
  const found = key.startsWith("nda_") ? await featuresForKey(key).catch(() => null) : null;
  const f = found?.features ?? NO_FEATURES;
  const script = buildScript({
    clicks: f.clicks,
    time: f.time,
    goals: f.funnel ? f.steps.filter((s) => s.kind === "track").map((s) => s.value) : [],
  });
  return new Response(script, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // Short for a keyed script so a switch takes effect within minutes.
      "cache-control": key ? "public, max-age=300" : "public, max-age=3600",
      "access-control-allow-origin": "*",
    },
  });
}
