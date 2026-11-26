# Public API and agent expansion

This plan was written when the API covered projects (read), deployments (read, deploy, redeploy, cancel, rollback), runtime logs, domains (read) and server usage. **Revised 2026-11-22:** the "Added" and "Developer toolkit" sections below were built, and some of the exclusions were later reversed. The current endpoint and scope list is in `docs/design/feature-inventory.md` under "The REST API and the OpenAPI document".

## Original exclusions (browser only)

Historical, as written:

- Terminal and file changes (the shell and writes into the app) — **later added** with the `terminal:use` and `files:write` scopes, 7-day token limit and the matching container switches.
- Removing leftovers on the container — still excluded.
- Container permission switches — still excluded.
- Token management, sessions, account deletion — still excluded.

## Added

Each area gets its own scope. Read and write are separate, and anything that can reveal a secret never returns its value.

| Area | Endpoints | Scope |
| --- | --- | --- |
| Projects | `POST /projects` (create), `PATCH /projects/{id}` (settings: branch, commands, port, health path, auto-deploy), `DELETE /projects/{id}` | `projects:write` |
| Build output | `GET /deployments/{id}` (detail), `GET /deployments/{id}/logs` (build log lines) | `deployments:read` |
| Environment variables | `GET /projects/{id}/env` (names and targets only), `PUT /projects/{id}/env/{key}` (set; value write-only), `DELETE /projects/{id}/env/{key}` | `env:write` to change, `env:read` to list names |
| Domains | `POST /domains` (add, with the port and project), `POST /domains/{id}/verify` (DNS and app check), `DELETE /domains/{id}` | `domains:write` |
| Deploy hook | `POST /projects/{id}/hook/rotate` returns the new URL once; `DELETE` revokes | `deployments:write` |
| Notifications | `GET /projects/{id}/notify` (channel kind and events, never the URL), `POST /projects/{id}/notify/test` | `notifications:read` |
| Alerts | `GET /projects/{id}/alerts` (thresholds, channels, mute state, recent events) | `alerts:read` |
| Status page | `GET /projects/{id}/status-page` (published or not, the public URL) | `projects:read` |
| Analytics | `GET /projects/{id}/analytics?days=1..90` (totals, daily, top pages, top referrers) | `analytics:read` |
| Resources | `GET /servers/{id}/usage/history?hours=1..168` (server series), `GET /projects/{id}/resources` (per-project memory and CPU) | `resources:read` |
| Container | `GET /servers` (connected servers with status), `GET /servers/{id}/inventory` (read-only: projects, leftovers, listening ports) | `container:read` |
| Activity | `GET /activity?kind=&range=&limit=&cursor=` (the same filters and readable labels as the page; secrets hidden) | `activity:read` |

## Rules

- A token can read and change only what its scopes name, and only for its own user's projects, domains and servers (404 otherwise).
- Writes that change the running app (deploy, rollback, env changes, settings) are audited with the token id, the same way deploy triggers already are.
- Secret values (env values, hook URLs, notification URLs, token secrets) are never returned after they are set.
- The rate limits follow the existing buckets: reads 120 a minute, changes 30 a minute, a separate small bucket for anything that opens an SSH session.
- The OpenAPI document and the MCP tool list are generated from the same endpoint list, so they stay in step.
- Each new scope is shown on the Developer page with a plain label, and existing tokens keep their current scopes.

## Delivery

1. Server: new service functions in `api-v1.ts` (or split by area), routes, scopes in `api-tokens.ts`, audit labels for any new action names.
2. Generated docs: OpenAPI and MCP tools from the same list.
3. Tests: each endpoint's scope gate, ownership 404, secret values never returned, and that a token without a scope gets 403.
4. Developer page: the scope picker lists the new scopes.

## Developer toolkit (round three)

Goal: people can build their own dashboards, scripts and agents without reading the source.

- `GET /api/v1/me` (tool `get_me`). The first call. It needs no scope, so `Endpoint.scope` is `Scope | null` and `null` means any valid token. It returns the owner's display name only (never the email), the token's name, scopes and expiry, and the server and project counts. No ids, nothing secret. OpenAPI shows `security: [{ bearerAuth: [] }]` for it and MCP says "Needs no scope."
- A typed client in one file, `web/src/lib/sdk/egg.ts`, with no dependencies. `Egg` takes a token, a base address and an optional `fetch`. Failures are `EggError` with `status`, `code` and `message` (status 0 for network failures and timeouts, and `retryAfterSeconds` on 429). Build logs and the activity log have async iterators that follow `nextAfter` and `nextCursor`. Its tests check every method against the endpoint list.
- Examples in `examples/`: a Node script and a Python script that follow a build log, a static dashboard, a GitHub Actions workflow that deploys through a deploy hook, and MCP config for Claude Desktop, Cursor and Claude Code. They use `egg_...` placeholders only, and a test fails if anything that looks like a real token is added.
- The Developer page has a "Build with it" section listing them, with the permission each needs, the OpenAPI address and the MCP address.

Scopes: no new scope was needed. The status page reads under `projects:read`, the activity log under `activity:read`, and `get_me` needs none.

~~Not built yet: outbound webhooks.~~ **Built (checked 2026-11-22).** They are account-level hooks, not project-level: `components/webhooks-card.tsx`, `server/webhooks.ts` and `server/webhook-sign.ts`. Each request is signed with `X-Egg-Signature: t=<unix>,v1=<hex HMAC-SHA256>`; the secret is shown once, sealed at rest and rotatable. The SSRF decision described here was implemented: https only, public-address check after DNS resolution, redirects refused, 5 s timeout, per-delivery status. Events: `deployment.started`, `deployment.succeeded`, `deployment.failed`, `webhook.test`. See `docs/design/feature-inventory.md`, "Signed outbound webhooks (Account page)".

~~Open: a browser page on another origin can only call the API if `/api/v1` answers CORS.~~ **Built (checked 2026-11-22):** `web/src/proxy.ts` sets `Access-Control-Allow-Origin: *`, allows `GET, POST, PATCH, PUT, DELETE, OPTIONS` and the `Authorization, Content-Type` headers, exposes `Retry-After`, and answers `OPTIONS` with 204 for `/api/v1/*`. Credentials are not allowed, so a wildcard origin does not read cookies. The decision to allow it was made; the static dashboard no longer needs a same-origin proxy.
