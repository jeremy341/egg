# Backend performance and operations

This backend extension keeps Egg's existing Nest/SSH architecture. It does not add dashboard screens or promise measured real-Nest speedups.

## Performance data

- `GET /api/deployments/:id/performance` returns the owner's measured deployment stages, queue time, a recent comparison and a bottleneck hint. Measurements start with new deployments. Source preparation and install/build are combined stages; unavailable memory/CPU/disk peaks are reported as unavailable rather than inferred.
- `GET /api/admin/diagnostics` is restricted to the configured instance administrator. It returns process memory, queue counts and optional aggregate route metrics. Set `EGG_BACKEND_METRICS=1` to collect up to 256 duration samples per route family, query counts and event-loop delay. Metrics are process-local; no SQL, parameters, tokens, project IDs, request bodies or full URLs are retained. Handler durations do not include the entire life of an SSE connection.
- Latest-project reads fetch one deployment per project. Analytics statistics cover the complete requested window, with aggregation in SQLite instead of silently truncating to 20,000 observations.
- Build logs use bounded pull-based streams, replay cursors, periodic authorization checks and a 15-minute connection deadline. Reconnect to continue an active deployment. SSH callers may select a bounded output tail instead of retaining all streamed output.

## Build cache

`buildCacheEnabled` is an owner-only project setting, false by default. It opts eligible default npm lockfile builds into a project/environment/runtime-scoped **download** cache. Installation still runs; Egg does not reuse mutable node_modules or build outputs. Verification failure removes the owned cache and falls back to downloading again. The cache ages out, retains one key per environment, and has a monitored 256 MB budget; polling does not create an instantaneous disk quota.

Private package contents and package-manager metadata may remain in this cache. Egg does not deliberately write credentials or build logs into it, but repositories using credential-bearing package URLs should keep caching disabled. This is not an OS isolation boundary: arbitrary commands running as root in the same Nest account already have that account's filesystem authority. Enable it only when that trust model is appropriate. Remote project cleanup removes marked Egg cache entries while preserving unmanaged files and shared application data.

## Maintenance and retention

Database leases coordinate periodic work across app/worker processes and prevent a completed scheduled run from immediately repeating elsewhere. Monitor project eligibility is selected in one query; service probes are batched, with bounded parallel batches per server. Errors remain observable rather than being treated as a healthy result.

Deployment log messages have a default 4 MiB per-deployment byte budget, in addition to the row/line bounds. `DEPLOY_LOG_RETENTION_DAYS` defaults to 90, accepts 1–3650 days, and `0` disables automatic expiry. Maintenance deletes at most 10,000 expired finished-deployment log rows per run in small batches. Active worker logs are retained. This setting affects stored deployment logs, not the user's own system journal or backups.

## Missed GitHub pushes

- `GET /api/projects/:id/reconcile` checks the current authorized GitHub production-branch SHA against the current deployed SHA.
- `POST` to the same endpoint with `{ "confirm": true, "expectedSha": "<40 hex commit>" }` explicitly queues a missed push. Egg verifies the branch head again, rejects a changed head and deduplicates concurrent requests. It never silently deploys a different commit.
- Session owners or scoped bearer credentials may use this route. Bearer scope requirements are `deployments:read` for inspection and `deployments:write` for recovery, intersected with project authorization. GitHub calls have a deadline and a per-account request limit.

## Project ownership and deployment trust

Projects are single-owner: only the owning account can read or change a project. Every route and bearer token is checked against that owner, and token scopes cannot exceed the owner's authority.

Deploy permission is a powerful trust grant: deployed code can access its environment and the Nest account's execution context. Hiding an environment endpoint does not isolate secrets from someone authorized to deploy code. Logs may also contain sensitive application output despite Egg's redaction.

## Recovery and import

`/api/admin/recovery` exposes stale guard inspection and an explicitly confirmed administrator recovery flow. A stale heartbeat does not prove a worker is dead: recovery requires confirmation of the exact stopped worker, fences the recorded holder and verifies remote Egg build scopes. Uncertainty keeps a blocking guard. Recovery is audited.

Project adoption APIs create an encrypted expiring plan for a supported existing systemd/Git application and a healthy prepared Egg preview. Confirmation requires a fresh owner session and explicit consent. The backend rechecks remote identity/configuration, blocks conflicting work, copies a separate production release, writes production environment without changing the preview, stops only the selected source service, health-checks cutover and attempts rollback on failure. Original source data and service configuration are preserved. Unsupported process managers or unverifiable state are refused. No live migration is performed merely by creating a plan.

Import currently refuses EnvironmentFile-based services and Python virtual-environment projects. It does not move databases or uploaded files; configure their explicit paths before preparing a candidate. An originally enabled service is disabled only after healthy cutover to avoid competing services at boot; rollback restores its enabled state. Uncertain cutovers keep an executing guard and appear in administrator recovery inspection for manual verification, not blind clearing.

## Verification limits

Restart Egg after updating so its migration runner applies migrations 0037–0041 (alongside the existing onboarding migration in this working tree). No live account, Nest service or GitHub installation is changed by these additive database migrations.

Regression and mock-SSH tests exercise failure behavior, cache handling, pagination, authorization and concurrency. Real Nest latency, filesystem capacity and deployment compatibility need a separate disposable-project run. Improvements in query/result counts are not equivalent to a measured production speedup. No backup/SQLite durability protection is disabled to gain throughput.
