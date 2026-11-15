# Security audit: dependencies and configuration

## Status after the May–November round

Checked on 2026-11-08. Paths are under `web/`.

| Section | Status | Where |
|---|---|---|
| 1. Production dependencies | Open, low risk | `corepack pnpm audit --prod --audit-level high` exits 0 (no high or critical). `pnpm audit --prod` still lists 1 moderate (minimatch) and 1 low (deepmerge), both through `shadcn`, which is still in `dependencies` in `package.json`. The optional fix (move `shadcn` to `devDependencies`, or add overrides) has not been done |
| 1a. Repeatable audit command | Fixed | `package.json` script `audit:prod` = `pnpm audit --prod --audit-level high`. **There is no CI workflow yet** (no `.github/workflows`), so nothing runs it automatically; it is run by hand |
| 2. Security headers | Fixed, with one gap | `next.config.ts` `headers()` sends CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and (in production) HSTS on every route, pinned by `src/app/(marketing)/security/security-facts.test.ts`. The CSP still has `'unsafe-inline'` for scripts; a nonce breaks the app under `cacheComponents`, and the two fixes (turn `cacheComponents` off, or Next's experimental SRI mode) have not been chosen |
| 3. Committed secrets | No change | `git ls-files` shows only `web/.env.example` |
| 4. `--user` on Windows | Open, low | `src/server/deploy/build.ts` still sets `--user` only when `process.platform !== "win32"` |
| 4. Build network access | Open, by design | No `--network` restriction; package installs need it |

Still open: the two `shadcn` advisories (section 1), `--user` on Windows, the CSP nonce, no CI workflow for `audit:prod`.

Date: 2026-11-06. Scope: `web/`.

## 1. Production dependencies

Lockfile: `web/pnpm-lock.yaml` (no bun lockfile exists). Command: `pnpm audit --prod`.

**High: 0. Critical: 0.** Two lower findings, both reached only through `shadcn`:

| Sev | Package | Installed | Fixed | Imported by app? |
|---|---|---|---|---|
| Moderate | minimatch (GHSA-g3hv-75wg-m249, ReDoS) | 10.2.6 | 11.0.1 | No |
| Low | deepmerge (GHSA-gcqx-w48m-w2h4, prototype poisoning) | 4.3.1 | 4.3.2 | No |

Grep of `src`, `worker`, `scripts` and the root configs finds no import of either package. `shadcn` is only used as `@import "shadcn/tailwind.css"` in `src/app/globals.css`.

**Fix (optional):** `shadcn` is a runtime dependency but is only a CSS and CLI helper. Move it to `devDependencies`, or add pnpm overrides `"deepmerge": ">=4.3.2"` and `"minimatch": ">=11.0.1"`.

## 2. Security headers

`web/next.config.ts` has no `headers()`. `web/src/proxy.ts` only sets CORS on `/api/v1/*`. Only the CSV export and file download routes set `x-content-type-options: nosniff`.

| Header | Status | Severity |
|---|---|---|
| Content-Security-Policy | Missing | Medium |
| frame-ancestors / X-Frame-Options | Missing (clickjacking on the dashboard) | Medium |
| Strict-Transport-Security | Missing | Medium (production) |
| X-Content-Type-Options | Missing globally | Low |
| Referrer-Policy | Missing | Low |
| Permissions-Policy | Missing | Low |

**Fix:** add to `next.config.ts`:

```ts
async headers() {
  const h = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  ];
  if (process.env.NODE_ENV === "production")
    h.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  return [{ source: "/:path*", headers: h }];
}
```

Notes:
- The `'unsafe-inline'` script allowance is a starting point. A nonce-based CSP set in `proxy.ts` is stronger.
- `/api/analytics/script` and `/api/collect/*` are embedded by third-party sites. Exempt them from `frame-ancestors`, and keep their CORS headers.

## 3. Committed secrets

- Tracked env files: only `web/.env.example`, which holds empty placeholders and no values.
- `web/.env.local` exists on disk but is **not tracked**. `.gitignore` covers it with `.env*` and `!.env.example`.
- Git history shows no `.env`, `.pem` or `.key` file ever added.
- Key-header and token patterns match only fake test fixtures (`activity.test.ts`, `export-csv-routes.test.ts`). No finding.

## 4. Docker and deploy scripts

No Dockerfile or compose file is tracked. `examples/github-actions/deploy-on-release.yml` uses `permissions: {}` and a secret hook, which is fine.

Build container (`src/server/deploy/build.ts`) args: `--cap-drop ALL`, `no-new-privileges`, and memory, CPU and pids limits. It publishes no ports.

- **Low:** `--user` is only set on non-Windows hosts. On Windows the build runs as the image's default user, which is usually root. Fix: pass an explicit non-root `--user 1000:1000` on every platform.
- **Low:** the build container has no `--network` restriction, so untrusted repo build scripts have outbound access. This is probably needed for package installs, so it is a deliberate trade-off.
