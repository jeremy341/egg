# Security audit: authentication, sessions, API, proxy

Date: 2026-11-06. Scope: `web/src/proxy.ts`, `server/auth/**`, `api-tokens.ts`, `api-v1*.ts`, `mcp.ts`, `http.ts`, `rate-limit.ts`, `crypto.ts`, `app/api/auth|tokens`, `next.config.ts`. Each fix has a test written first (or alongside, for route glue).

## Findings

| # | Sev | Finding and evidence | Status |
|---|---|---|---|
| 1 | High | Open redirect after re-confirmation. `callback/route.ts` and `reauth/route.ts` accepted any `next` starting with `/` and not `//`. `/\evil.example` and `/<tab>/evil.example` pass that check and the URL parser turns them into `https://evil.example/`. | Fixed: `auth/redirect.ts` `safeNextPath` (rejects backslash and control characters, re-checks origin). Used in both routes. |
| 2 | Medium | No security headers anywhere (`next.config.ts` had no `headers()`): clickjacking on the dashboard, no CSP, nosniff, HSTS, referrer or permissions policy. | Fixed: `next.config.ts` `headers()` on every route. Checked with curl on `/`, `/login`, `/stats`, `/api/v1/me`, `/api/analytics/script`, `/api/stats`: all 200 or 401 as before, API CORS intact. |
| 3 | Medium | No rate limit on sign-in routes, and none on unrecognised access tokens (each guess is a database read). | Fixed: 20 sign-in tries per address per minute (login, callback, reauth, dev); 60 bad tokens per address per minute, checked before the lookup (`api-v1-http.ts`). Address is the right-most `X-Forwarded-For` entry. Not throttled when no proxy header exists. |
| 4 | Medium | `readCappedText` trusted `Content-Length`, then read the whole body. A chunked body had no cap. | Fixed: bytes are counted as they stream and reading stops at the cap. |
| 5 | Low | CSRF check let any write through when `Origin` was missing. | Fixed: a write with no `Origin` but `Sec-Fetch-Site: cross-site` or `same-site` is now 403 (`http.ts`). curl and webhooks, which send neither, still work. |
| 6 | Low | Sign-in state cookie parsed without shape checks: `null`, or a numeric `s`, threw and gave a 500. | Fixed: `parseOauthCookie` (zod); bad cookies redirect to `invalid_request`. |
| 7 | Low | Sign-in kept the old session alive (no rotation of the cookie being replaced). Tokens were always new, so no fixation was possible, but the old one lived on for 30 days. | Fixed: `createSession(..., replacing)` deletes it in callback and dev login. |
| 8 | Low | Proxy matcher `.*\.(?:svg\|png...)` was a plain string, so `\.` became `.` and any path ending in `png`, `svg`... skipped the proxy (no cookie gate, no CORS). Handlers still check auth. | Fixed: `\\.` in `proxy.ts`. |

## Checked, no defect

- Session cookie: httpOnly, SameSite=Lax, Secure in production, path `/` (`session.ts:112`). Token is 32 random bytes, only its SHA-256 is stored, expiry enforced in `userForSessionToken`.
- API tokens: `ndp_` plus 32 random bytes, SHA-256 at rest, looked up by hash (no secret-dependent comparison, so no timing oracle). Expired, revoked and unknown tokens are indistinguishable (`principalFor`). OAuth state uses `safeEqual`.
- Scope: `callEndpoint` runs `requireScope` first; webhook and export routes call it themselves. Existing tests cover a 403 for every endpoint.
- IDOR: every service reached from `/api/v1` filters by `userId` (projects, deployments, domains, servers, webhooks, tokens); other users' ids give 404. Token update and revoke are scoped to the owner.
- CORS: `*` without credentials; no `cookies()` or session lookup under `/api/v1` or `/api/mcp`; tests confirm cookies are ignored. Dashboard API routes get no CORS headers.
- Dev login: 404 when `NODE_ENV=production` or `DEV_LOGIN` is off, regardless of the other; tested.
- CSRF: every cookie-backed write uses `handle()`. `skipOriginCheck` is only on bearer or token-keyed routes (v1, mcp, hooks, collect, webhooks).
- Errors: 500s are generic; the callback maps all failures to fixed codes; MCP logs only the error name. No bearer value, session token or secret is logged.

## Not fixed

- CSP keeps `'unsafe-inline'` for scripts because Next.js inlines hydration scripts. A per-request nonce in `proxy.ts` is the stronger fix.
- `readJson` (cookie routes) has no body cap beyond the 50 MB proxy limit; callers are signed in. File upload routes need the large limit.
- Address-based limits are per process and trust the proxy's `X-Forwarded-For`. Without a proxy header nothing is limited.
- The login page has no message for `error=rate_limited` (UI is out of scope); it shows the generic sign-in error.
