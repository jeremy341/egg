import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Reads its country database from its own folder, so it is loaded from node_modules, not bundled.
  serverExternalPackages: ["geoip-country"],
  // Next.js buffers the body of every request that passes through src/proxy.ts, in memory, up to this size, and
  // quietly cuts the rest. The routes with large bodies (build uploads, file uploads, the GitHub webhook, security
  // reports) are skipped by the proxy matcher, so what is left needs little: JSON bodies are capped at 256 KB and
  // a server action defaults to 1 MB. Keep this small: it is memory held per request before any handler runs.
  experimental: {
    proxyClientMaxBodySize: "1mb",
  },
  partialPrefetching: true,
  // Security headers on every route. script-src keeps 'unsafe-inline' on purpose: with
  // cacheComponents the pages have a prerendered shell, and its inline bootstrap scripts are
  // built before any request exists, so they cannot carry a per-request nonce (a nonce policy
  // blocked hydration in a production build). A strict nonce policy needs cacheComponents off.
  // frame-ancestors, base-uri, object-src and form-action are the parts that matter most and
  // need no relaxing.
  async headers() {
    const production = process.env.NODE_ENV === "production";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      `connect-src 'self'${production ? "" : " ws: wss:"}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ");
    const list = [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    ];
    if (production) list.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
    return [{ source: "/:path*", headers: list }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
