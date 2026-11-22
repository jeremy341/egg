# Security audit: dependencies and configuration

## Status after the May–November round

Checked on 2026-11-08, revised 2026-11-22. Paths are under `web/`. The original sections are kept as they were written; the status table below records what has since been fixed or removed.

| Section | Status | Where |
|---|---|---|
| 1. Production dependencies | **Fixed 2026-11-22** | `shadcn` is no longer in `web/package.json` (`dependencies` or `devDependencies`), so the minimatch and deepmerge advisories that came through it no longer apply. `audit:prod` is still run in CI; the old "optional fix" was effectively resolved by removing the package. |
| 1a. Repeatable audit command | **Fixed, CI present** | `package.json` script `audit:prod` = `pnpm audit --prod --audit-level high`, and `.github/workflows/ci.yml` (added 2026-11-15) runs it on push to `main` and on pull requests. The old "There is no CI workflow yet" claim is historical. CI also runs typecheck, lint, tests and a Caddyfile validation step. |
| 2. Security headers | Fixed, with one gap | `next.config.ts` `headers()` sends CSP, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and (in production) HSTS on every route, pinned by `src/app/(marketing)/security/security-facts.test.ts`. The CSP still has `'unsafe-inline'` for scripts; a nonce breaks the app under `cacheComponents`, and the two fixes (turn `cacheComponents` off, or Next's experimental SRI mode) have not been chosen. **Still open.** |
| 3. Committed secrets | No change | `git ls-files` shows only `web/.env.example` |
| 4. `--user` on Windows | **Removed with the build runner** | The central Docker build runner that read `process.platform` and set `--user` no longer exists (checked 2026-11-22). Builds run on the user's container under a cap or in GitHub Actions, so this finding is historical. |
| 4. Build network access | Open, by design | The capped build on the user's container needs network access for package installs; no egress filtering is applied inside that scope. |

Still open on 2026-11-22: the CSP nonce (section 2), the build's network access, and the two `shadcn` findings only as history (the package is gone). `--user` on Windows and the missing CI workflow are closed as described above.

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

**Update 2026-11-22:** none of that is needed now. `shadcn` is not listed in `web/package.json` at all, so neither advisory reaches a production dependency. This section is kept for history.

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

A `compose.yaml` is now tracked at the repository root (it starts the web app and the worker; no build happens on that server). The old "No Dockerfile or compose file is tracked" line was true when this section was written. `examples/github-actions/deploy-on-release.yml` uses `permissions: {}` and a secret hook, which is fine.

The old build container (`src/server/deploy/build.ts`) args `--cap-drop ALL`, `no-new-privileges`, memory, CPU and pids limits are historical: the central Docker build runner was removed (2026-11-22). No build image is started on Egg's host now.

- **Low, historical:** `--user` was only set on non-Windows hosts. That code is gone, so the finding no longer applies.
- **Low, still true in a different place:** the install and build on the user's container have network access, so untrusted repo build scripts can reach the internet. This is needed for package installs, so it is a deliberate trade-off (`docs/design/security-audit-exec.md`, "Still open" 4).
- Dockerfile and Compose deployment modes are now validated for dangerous Compose fields (`privileged`, `cap_add`, `devices`, `network_mode`, external networks, host binds) in `src/server/deploy/docker-target.ts`; see the tests in `docker-target.test.ts`.
