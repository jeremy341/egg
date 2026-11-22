# Rate limits and DDoS protection (plan, not built)

Status: plan written on 2026-11-14 from a read of `web/src/server/rate-limit.ts`, `deploy/Caddyfile` and the existing audits. Items marked **verify** were not checked against the code.

**Update, 2026-11-16 (checked against the code): Layer 3 is built, and part of Layer 4.** Layers 1 and 2 are not.

**Revision, 2026-11-22:** Layer 3 is unchanged. Layer 4 counters exist in `web/src/server/backend-metrics.ts`, but no alert and no admin screen showing the 429/request-volume spike was found, so the "unverified" note below still stands. A CI workflow now exists (`.github/workflows/ci.yml`) and validates `deploy/Caddyfile` with Caddy 2; the older claim in `docs/design/security-audit-deps.md` that no CI workflow existed was wrong and has been corrected there. Layers 1 and 2 remain owner decisions.

- Every request the proxy sees is limited per client address (`ingress`, 600 a minute), the public JSON routes `/api/stats`, `/api/public/*` and `/api/status/*` have a stricter limit on top (`ingressJson`, 60 a minute), and a request whose address is unknown shares one high ceiling (`ingressGlobal`). See `RATE_LIMITS` in `web/src/server/rate-limit-core.ts` and `web/src/proxy.ts`.
- The four routes the proxy matcher skips apply their own address limit: build upload, file write and the security-report intake call `enforceIngress`, and the GitHub webhook calls `admitRequest` with its own `ingressWebhook` bucket (600 a minute). So gap 1 is closed.
- An address that gets 300 refusals in 5 minutes is banned for 15 minutes (`INGRESS_BAN`). Gap 6 is closed.
- `recordIngress` in `web/src/server/backend-metrics.ts` counts refused and total requests. Whether the admin diagnostics screen shows them, and whether an alert exists, is still **unverified**.
- Tests: `proxy-ingress.test.ts`, `rate-limit-ingress.test.ts`, `ingress-limits.test.ts`, `ingress-handlers.test.ts`.
- The address limits only work with `TRUST_PROXY=1` behind a proxy you run. The Compose example (`deploy/.env.example`) sets it. Without it, only the shared ceiling applies.

Still open: Layer 1 (a CDN; needs the owner's decision), Layer 2 (stock Caddy cannot rate-limit; timeouts not verified), limits that survive a restart or are shared between processes (gap 2), and the alert. The list under "Gaps" below is the original, kept for history.

## The honest limit first

An application cannot stop a real distributed denial of service on its own. If enough traffic reaches the machine, the machine or its network link fills up before any code runs. Real protection has to sit in front of the app (a CDN or a provider's network filter) and use the app's own limits as a second layer. The plan has both layers.

## What exists today

- A sliding-window limiter in `web/src/server/rate-limit.ts`. It is per process (kept in memory), so it resets on restart and is not shared if more than one app process runs. Buckets today: sign-in (20 per minute), bad tokens (60 per minute), terminal input, file writes, orphan removal, build uploads (20 per hour), build variable reads (30 per hour), GitHub connection tests (10 per minute), the public deployments feed (60 per minute).
- Client address is taken from forwarded headers only when `TRUST_PROXY` is on (default off), using the right-most `X-Forwarded-For` entry.
- Body limits at the edge and in the app (see `deploy/Caddyfile`, `web/src/ingress-limits.test.ts`): 1 MiB default, larger only for four named routes.
- The stock Caddy image in `deploy/Caddyfile` cannot rate-limit or cap concurrent connections per path (the file says so).

## Gaps

1. **No limit on ordinary public pages and APIs.** Public routes such as the homepage, `/stats`, `/api/stats`, the status pages, `/api/security-reports` and `/api/webhooks/github` have caps on body size but not on request rate (the security report and feed routes aside). **Verify** which public routes have no limiter.
2. **Limits are per process and in memory.** A restart clears them. A second worker or instance does not share them.
3. **No connection limits and no slow-request protection** (Slowloris) at the proxy: timeouts and header limits are Caddy defaults. **Verify** the exact timeouts.
4. **No filter in front.** There is no CDN or network filter, so a flood reaches the server and its bandwidth.
5. **Expensive routes are unprotected by cost.** Anything that touches SSH, the database with a large query, or GitHub on each request needs a limit and a cache, not only a body cap. The public deployments feed already has a 60 second cache and a limit.
6. **No automatic blocking of repeat offenders.** Abusive addresses are limited per request but not banned for a period.
7. **Observability.** No dashboard or alert for a spike in 429s or in request volume, so an attack would be noticed by the site being down. `backend-metrics.ts` exists in the working tree. **Verify** what it counts.

## Layers, in the order to build them

### Layer 1: in front of the app (the one that matters for a real flood)

- Put the public site behind a CDN with DDoS protection (Cloudflare's free plan is the obvious candidate; the owner must decide and own the account). Cache the static homepage and `/api/stats` there so most visitors never reach the app. Terminate TLS there, hide the origin address, and set the origin firewall to accept only the CDN's address ranges.
- With a CDN in front, `TRUST_PROXY` must be set and the client address read from the CDN's header only. The existing per-process limiter then sees real client addresses. This needs a documented setting and a test.
- This is a provider decision and a DNS change, not code. The docs agent's self-hosting guide should get a short "putting a CDN in front" section after this is decided.

### Layer 2: Caddy

- Build Caddy with the rate-limit module (an `xcaddy` build in `deploy/Dockerfile` or a separate caddy image) so `/api/*`, sign-in and the public pages get per-address request-rate limits and a cap on concurrent connections per address. **Verify** the module name and its current syntax before writing the config; do not write it from memory.
- Tighten timeouts (read header, read body, idle) so slow connections free up.
- Keep the body-size blocks that exist.

### Layer 3: in the app

- A request-rate limiter for **every** public route, keyed by client address, with generous limits for normal use and a clear 429 with `Retry-After`. Cover the homepage feed, `/stats`, status pages, the security-report intake, the webhook (signature first, cheap refusal before any parsing, existing caps stay), sign-in and the password route.
- Cache what is public and expensive: status pages and `/api/stats` get short cache lifetimes and ETags (already listed in `next-round-plan.md`, section 1).
- A temporary ban: after repeated 429s or repeated failed sign-ins from one address, refuse that address for a set period, with the period and thresholds as named constants in code.
- Optional later: store counters in the database or a small shared store so limits survive a restart and work across processes. Only needed if more than one app process runs.
- Concurrency gates on the expensive paths (SSH-backed routes, builds) so a burst queues instead of exhausting memory. The webhook already has one.
- Tests for each new bucket: allowed, refused, window reset, the address is read correctly with and without `TRUST_PROXY`, and a forged header does not bypass the limit.

### Layer 4: watch it

- Count 429s and total requests per minute in the existing metrics module and show them on the admin diagnostics screen (`/api/admin/diagnostics` exists in the working tree; **verify** what it shows).
- An alert to the administrator when 429s or request volume cross a threshold, using the notification path that already exists for the security inbox.

## What this will not do

- It will not keep the site up under a large volumetric attack without Layer 1.
- It will not replace the origin hardening: a server that accepts traffic from anywhere can still be hit directly if its address leaks.
- It does not cover attacks on the Nest containers of users; those are limited by Nest.

## Decisions needed from the owner

1. Which CDN or provider, and who holds the account.
2. Where the public Egg runs (a VPS, a Nest container, a home machine). This changes what network protection is available.
3. Whether a custom Caddy build is acceptable to maintain.
4. Acceptable limits: how many requests per minute from one address before a 429.

## Suggested order

1. Layer 3 in the app (no outside dependency, fastest to ship): the limiter on every public route, caching, the ban, the tests.
2. Layer 4 counters and the alert.
3. Layer 1, once the owner has decided the provider.
4. Layer 2, once Layer 1 is in place and the remaining gap is clear.

## Not verified when this was written

- Which public routes currently have no limiter.
- Caddy's timeouts in the shipped config and the current rate-limit module syntax.
- Where the public instance is hosted today.
