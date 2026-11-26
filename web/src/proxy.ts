import { NextResponse, type NextRequest } from "next/server";

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
  // GitHub builds: POST /api/builds/upload and GET /api/builds/env check their own scoped bearer credential
  // (and the matcher below skips these paths). Nothing is read from the URL.
  /^\/api\/builds\//,
  // Public by design: the analytics snippet, its collector, and status pages.
  /^\/api\/analytics\/script$/,
  /^\/api\/collect\//,
  /^\/status\//,
  // The public stats page and its data, and the API and agent endpoints. The
  // API and agent endpoints check their own bearer token; the proxy only lets them through.
  /^\/stats$/,
  /^\/api\/stats$/,
  // The public Nest status page and its data: whether Egg can reach Nest, nothing about any user.
  /^\/nest-status$/,
  /^\/api\/status\/nest$/,
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
const DASHBOARD = new RegExp("^/(account|activity|admin|connect|container|deployments|developer|docs|domains|logs|projects|resources|new)(/|$)");

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/v1/")) {
    if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: API_CORS });
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(API_CORS)) res.headers.set(k, v);
    return res;
  }
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
  // /api/builds/ is skipped so a release of up to 500 MB streams straight to its route and is not buffered here.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/builds/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
