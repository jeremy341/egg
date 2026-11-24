import { NextResponse, type NextRequest } from "next/server";
import { trustProxyEnabled } from "@/server/config";
import { refusalText, admitRequest, type Admission } from "@/server/rate-limit-core";
import { recordIngress } from "@/server/backend-metrics";

/**
 * The public JSON data routes. They get the `ingressJson` limit (60 a minute per address) on top of the general one.
 * Keep this list in step with the public routes above.
 */
const PUBLIC_JSON = [/^\/api\/stats$/, /^\/api\/public\//, /^\/api\/status\//];

/**
 * Cheap first gate: no session cookie means no dashboard. Real validation
 * (expiry, revocation) happens in the server code that reads the session.
 */
const PUBLIC = [
  /^\/$/,
  /^\/login$/,
  /^\/api\/auth\//,
  /^\/api\/webhooks\//,
  /^\/api\/hooks\//,
  // GitHub builds: only these credential-gated endpoints are public to the proxy. Upload bodies stream around
  // the proxy; the small env lookup still passes through it and checks its scoped bearer credential in the route.
  /^\/api\/builds\/(?:upload|env)$/,
  // Public by design: the analytics snippet, its collector, and status pages.
  /^\/api\/analytics\/script$/,
  /^\/api\/collect\//,
  /^\/status\//,
  // The public stats page and its data, and the API and agent endpoints. The
  // API and agent endpoints check their own bearer token; the proxy only lets them through.
  /^\/stats$/,
  /^\/api\/stats$/,
  // The homepage deployments feed: public rows of projects whose owners opted in, public repositories only.
  /^\/api\/public\/deployments$/,
  // The public Nest status page and its data: whether Egg can reach Nest, nothing about any user.
  /^\/nest-status$/,
  /^\/api\/status\/nest$/,
  // The anonymous security report intake, this exact path only. The public /security form posts here and reads
  // one boolean from GET. The route checks origin, rate limits and size itself. The administrator inbox is under /api/admin.
  /^\/api\/security-reports$/,
  /^\/api\/v1\//,
  /^\/api\/mcp$/,
];

/**
 * The public API allows any origin, so a browser page (a static dashboard, a
 * team tool) can call it with a token it holds. That is safe because the API
 * is bearer-only and never reads cookies: a browser attaches no credentials,
 * so a cross-site page gets nothing it could not already get with the token.
 * Credentials are not allowed, which keeps the wildcard origin honest.
 */
const API_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Expose-Headers": "Retry-After",
  "Access-Control-Max-Age": "600",
};

/**
 * Dashboard routes. Signed-out visitors are sent to sign-in only for these, so a
 * mistyped public address reaches the not-found page instead of the login page.
 */
const DASHBOARD = new RegExp("^/(account|activity|admin|connect|container|deployments|developer|domains|logs|projects|resources|new)(/|$)");

/** The 429 for a refused request: a short plain body and Retry-After, never a redirect. */
function refused(admission: Extract<Admission, { refused: true }>, pathname: string) {
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    "Retry-After": String(admission.retryAfterSeconds),
    "Cache-Control": "no-store",
  };
  // Browsers only let a cross-origin page read Retry-After if CORS exposes it.
  if (pathname.startsWith("/api/v1/")) Object.assign(headers, API_CORS);
  return new NextResponse(`${refusalText(admission.banned, admission.retryAfterSeconds)}\n`, { status: 429, headers });
}

export function proxy(req: NextRequest) {
  // Checked first, before any other work: the address rate limits and the temporary ban (src/server/rate-limit-core.ts).
  const path = req.nextUrl.pathname;
  const admission = admitRequest(req.headers, {
    trustProxy: trustProxyEnabled(),
    bucket: PUBLIC_JSON.some((p) => p.test(path)) ? "json" : "all",
  });
  recordIngress(admission.refused);
  if (admission.refused) return refused(admission, path);
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/v1/")) {
    if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: API_CORS });
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(API_CORS)) res.headers.set(k, v);
    return res;
  }
  // A docs page as Markdown (/docs/<slug>.md) is served by the route at /docs-md/<slug>. Public, like the page itself.
  const markdown = /^\/docs\/([^/]+)\.md$/.exec(pathname);
  if (markdown) return NextResponse.rewrite(new URL(`/docs-md/${markdown[1]}`, req.url));
  if (PUBLIC.some((p) => p.test(pathname))) return NextResponse.next();
  if (req.cookies.has("egg_session")) return NextResponse.next();
  if (!DASHBOARD.test(pathname) && !pathname.startsWith("/api/")) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in required" } },
      { status: 401 }
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Next.js copies the body of every proxied request into memory, up to experimental.proxyClientMaxBodySize
  // (next.config.ts, 1 MB), before any route runs. Four routes take bodies over that and are skipped here, so
  // they stream straight to their handler, which bounds them itself (src/ingress-limits.test.ts holds this list):
  //   - api/builds/upload : a release of up to 500 MB, checked with its own bearer credential.
  //   - api/webhooks/github : up to 5 MiB, public here anyway, so the proxy did nothing for it.
  //   - api/security-reports : up to about 4.3 MB, public here anyway (the exact path only).
  //   - api/projects/<id>/files/write : a file of up to 50 MB; the handler checks the session first.
  // Each is also capped in deploy/Caddyfile. Do not add a route that takes a large body without skipping it here.
  // The static-asset exemption is for asset URLs only: an API path that merely ends
  // in an image extension (a tracker pixel, a junk id) still passes the proxy, so
  // the ingress limits and bans apply to it.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|api/builds/upload$|api/webhooks/github$|api/security-reports$|api/projects/[^/]+/files/write$|(?!api/).*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
