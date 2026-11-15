# Public API and agent expansion

Today the API covers projects (read), deployments (read, deploy, redeploy, cancel, rollback), runtime logs, domains (read) and server usage. The dashboard can do much more. This plan adds what an AI agent or script plausibly needs, and keeps the exclusions that protect the container.

## Stays excluded (browser only)
- Terminal and file changes (the shell and writes into the app).
- Removing leftovers on the container.
- Container permission switches.
- Token management, sessions, account deletion.

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
- A typed client in one file, `web/src/lib/sdk/nest-deploy.ts`, with no dependencies. `NestDeploy` takes a token, a base address and an optional `fetch`. Failures are `NestDeployError` with `status`, `code` and `message` (status 0 for network failures and timeouts, and `retryAfterSeconds` on 429). Build logs and the activity log have async iterators that follow `nextAfter` and `nextCursor`. Its tests check every method against the endpoint list.
- Examples in `examples/`: a Node script and a Python script that follow a build log, a static dashboard, a GitHub Actions workflow that deploys through a deploy hook, and MCP config for Claude Desktop, Cursor and Claude Code. They use `ndp_...` placeholders only, and a test fails if anything that looks like a real token is added.
- The Developer page has a "Build with it" section listing them, with the permission each needs, the OpenAPI address and the MCP address.

Scopes: no new scope was needed. The status page reads under `projects:read`, the activity log under `activity:read`, and `get_me` needs none.

Not built yet: outbound webhooks. They make the server send requests to an address the user chose, which needs a decision on SSRF first: allowed schemes and ports, a blocklist for private, loopback and link-local ranges checked after DNS resolution (and again on redirects), no redirects followed, a short timeout and a response size cap, and signed payloads.

Open: a browser page on another origin can only call the API if `/api/v1` answers CORS (a preflight for `Authorization`). Today it does not, so the static dashboard needs a same-origin proxy until a decision is made. A read-only `GET, OPTIONS` allowance with `Access-Control-Allow-Origin: *` is safe for a bearer-only API (no cookies are read), but it also makes it easier to use a stolen token from a web page, so it is left to the owner.
