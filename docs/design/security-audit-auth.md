# Security audit: authentication, sessions, API, proxy

## Status after the May–November round

Checked against the code on 2026-11-08. Paths are under `web/`. Fixed means the code does what the finding asked for; open means it does not yet. The original tables below are kept as they were written.

| # | Status | Where |
|---|---|---|
| 1 | Fixed | `src/server/auth/redirect.ts` `safeNextPath`, used by `src/app/api/auth/callback/route.ts` and `reauth/route.ts` |
| 2 | Partly fixed | `next.config.ts` `headers()` sends the frame, object, base and form rules, nosniff, referrer, permissions and HSTS on every route. The script policy still has `'unsafe-inline'` (see "Still open" 1) |
| 3 | Fixed, with a condition | `src/server/auth/throttle.ts` (20 a minute) and `src/server/api-v1-http.ts` (60 a minute, checked before the lookup). Both are skipped when there is no trusted address, which is the default: see "Still open" 3 |
| 4 | Fixed | `src/server/api-v1-http.ts` `readCappedText` counts streamed bytes; `src/server/body-limit.ts` does the same for the other routes |
| 5 | Fixed | `src/server/http.ts` `assertSameOrigin` (Sec-Fetch-Site `cross-site` and `same-site` are refused when Origin is missing) |
| 6 | Fixed | `src/server/auth/redirect.ts` `parseOauthCookie` |
| 7 | Fixed | `src/server/auth/session.ts` `createSession(..., replacing)` |
| 8 | Fixed | `src/proxy.ts` matcher uses `\\.` |

Built since the audit:

- **Body cap for signed-in JSON routes.** `src/server/body-limit.ts` `readJsonLimited` caps at 256 KB (`JSON_BODY_LIMIT`) and answers 413. `readJson` in `src/server/http.ts` uses it, and so do the routes that read the body themselves (`src/app/api/servers/[id]/route.ts`, `.../servers/[id]/test/route.ts`, `.../projects/[id]/terminal/route.ts`). File uploads keep their own limit (`UPLOAD_LIMIT`, 50 MB). Closes the old "Not fixed" item on `readJson`.
- **`TRUST_PROXY`.** `src/server/config.ts` `trustProxyEnabled`, `src/server/rate-limit.ts` `pickClientIp` and `clientIp`, and `.env.example` (`TRUST_PROXY=0`). Off by default: `X-Forwarded-For` and `X-Real-IP` are ignored, so a client can no longer pick its own address. On, the right-most `X-Forwarded-For` entry is used. Side effect: with it off there is no address, so the sign-in and bad-token limits do not apply.
- **Rate-limited sign-in message.** `src/lib/login-errors.ts` has `rate_limited`; `src/server/auth/throttle.ts` redirects with that code. Closes the old "Not fixed" item on the login page.
- **Analytics privacy** (new public surface, `src/app/api/collect/[key]/route.ts`): no cookie; referrer host only (`analytics-fields.ts` `cleanReferrer`); campaign values cut to 80 (`UTM_MAX`); no address column in `pageviews` (`src/server/db/schema.ts`); Do Not Track and Global Privacy Control respected by the script (`analytics-script.ts`) and by the collector (`analytics-events.ts` `optedOut`); the returning-visitor id lives in local storage, only while retention is on, and Egg stores an HMAC of it with a key that changes every 90 days (`analytics.ts` `retentionCode`).

## Still open

1. **CSP nonce.** `script-src` still has `'unsafe-inline'`. A nonce breaks the app under `cacheComponents: true`: pages are prerendered, so their start-up scripts exist before any request and cannot carry a per-request nonce. Two ways to fix it: turn `cacheComponents` off, or use Next's experimental SRI mode. Not chosen yet. `next.config.ts` explains it.
2. **Public analytics beacon has no body cap.** `src/app/api/collect/[key]/route.ts` calls `req.text()` and only then keeps the first 5,000 characters. Use `readTextLimited` from `src/server/body-limit.ts`.
3. **Limits are per process, and address limits need `TRUST_PROXY`.** `src/server/rate-limit.ts` and the collector's in-memory windows (`analytics.ts`, `analytics-events.ts`). With `TRUST_PROXY` off, `src/app/api/collect/[key]/route.ts` treats every visitor as `0.0.0.0`, so the collector's one-page-view-a-second limit applies to a project as a whole.
4. **`api/auth/dev` reads a form body with no cap.** `src/app/api/auth/dev/route.ts`. It returns 404 in production, so this is a development-only gap.

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
- API tokens: `egg_` plus 32 random bytes, SHA-256 at rest, looked up by hash (no secret-dependent comparison, so no timing oracle). Expired, revoked and unknown tokens are indistinguishable (`principalFor`). OAuth state uses `safeEqual`.
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
