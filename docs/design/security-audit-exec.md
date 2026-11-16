# Security audit: execution, files, terminal, SSH, deploy, webhooks, GitHub

## Status after the May–November round

Checked against the code on 2026-11-08. Paths are under `web/`. The original tables below are kept as they were written.

| # | Status | Where |
|---|---|---|
| 1 | Fixed | `src/server/projects.ts` `assertInstallationOwned` (called from `createProject`); `src/server/github/webhook.ts` `installationTrusted` also checks the event's installation against the project |
| 2 | Fixed | `src/server/deploy/build.ts` `resolveInside` compares real paths |
| 3 | Fixed | `src/server/deploy/build.ts` `buildCliEnv` |
| 4 | Fixed, stronger | `src/server/servers.ts` `connectToServer` and `testServer`: a new server's fingerprint is shown and must be confirmed before any command runs; an unpinned server answers 409 `host_key_unconfirmed` (`src/app/api/servers/[id]/test/route.ts` takes `confirmHostKey`; UI in `src/components/connect-flow.tsx`) |
| 5 | Fixed | `src/server/files.ts` file scripts resolve links with `readlink -f` before refusing a release `.env` |
| 6 | Fixed | `src/server/deploy/pipeline.ts` `setState` keeps `canceled` |
| 7 | Partly fixed | Counted body caps: `src/app/api/webhooks/github/route.ts` (25 MB), `src/app/api/hooks/deploy/[token]/route.ts` (4 KB). Replay guard is in memory per process: `src/server/github/webhook.ts` `DELIVERY_TTL_MS`. The database now also refuses duplicate active deploys (migration `drizzle/0013_security_prefs.sql`; `src/server/db/errors.ts` `isUniqueViolation`; handled in `webhook.ts` and `src/server/hooks.ts`, which answers 409 `busy`) |
| 8 | Fixed | `src/server/deploy/build.ts` `assertGitRef`, `assertGitSha`; `webhook.ts` `isSafeBranch` |
| 9 | Fixed, widened | `src/server/deploy/redact.ts` and `src/server/deploy/logger.ts`. Base64 and URL-encoded forms are masked, and values of 2 to 3 characters are masked where they stand alone. One-character values are not masked, on purpose, so `CI=1` stays readable |
| 10 | Fixed | `src/server/ssh/connection.ts` `DEFAULT_MAX_OUTPUT_BYTES` (128 MB) |
| 11 | Fixed | `src/server/terminal.ts` `TERMINAL_LIMITS.maxSessionsPerUser` (5) |
| 12 | Fixed | `src/app/api/projects/[id]/terminal/[sessionId]/input/route.ts` and `.../files/write/route.ts` use `src/server/body-limit.ts` |
| 13 | Fixed | `src/server/files.ts` `FILE_READ_LIMIT` (120 a minute) |
| 14 | Fixed | `src/app/api/projects/[id]/files/download/route.ts` `attachment()` |
| 15 | Fixed | `src/server/files.ts` writes the mode as octal only |
| 16 | Fixed | `src/server/net-guard.ts` treats `3fff::/20` as not public |

Old "Not fixed" list:

- Signed-in JSON routes with no cap: **fixed**, 256 KB in `src/server/body-limit.ts` (`readJsonLimited`, used by `readJson` in `src/server/http.ts`).
- Check-then-act deploy dedupe: **fixed** by the unique indexes `deployments_active_webhook_commit_idx`, `deployments_active_hook_idx` and `jobs_active_deployment_idx` (`drizzle/0013_security_prefs.sql`). The migration first ends older duplicates, keeping the newest. Migration `0042_job_project_lock` adds a second guard for the per-project job lock: `jobs.project_id` and the unique index `jobs_running_project_idx` (one running job per project). `claimNextJob` stamps the project when it claims, and a claim the index refuses leaves the job queued.
- First-use pinning cannot see a man in the middle: **partly fixed**. The fingerprint is now confirmed by the owner, but Egg has no earlier key to compare with, so the check is only as good as the owner's comparison with the one Nest shows.
- `BUILD_RUNNER=local` unsandboxed: **open**, by design (development only). `.env.example` says "local = no isolation".
- Short and encoded secrets not masked: **fixed** except one-character values, see item 9.
- Replay list is per process: **open**.

## Still open

1. `BUILD_RUNNER=local` runs build scripts on the host with no isolation (`src/server/deploy/build.ts`, around line 505). Development only.
2. The replay list (`webhook.ts`), rate limits (`src/server/rate-limit.ts`) and the analytics collector windows are per process.
3. ~~The deploy log stream checks the session once, when it opens, and can run for about 3.75 hours.~~ **Fixed.** `src/app/api/deployments/[id]/stream/route.ts` ends the stream after `MAX_AGE_MS` (15 minutes) and re-checks the session and the project's read access at least every 5 seconds, before it sends more log lines. Tests: `src/server/deployment-stream-bounds.test.ts` ("stops a stream when its session is revoked", "rechecks a session before fetching another page").
4. The build container can reach the internet (needed for package installs).
5. Masking finds the exact value, its base64 (also inside a longer base64 string such as a Basic auth header, for values of 8 characters or more) and its URL-encoded form (upper or lower case hex). A secret printed in any other form is not masked.

Scope: `web/src/server` (files, terminal, ssh, deploy, inventory, webhooks, notify, github) and the matching routes. Every fix has a test.

## Findings

| # | Severity | Finding (evidence) | Status |
|---|---|---|---|
| 1 | High | `createProject` trusted a client `installationId`: anyone could use another user's GitHub installation token to clone its private repos (`projects.ts`, `pipeline.ts`). | Fixed: ownership check, 403 |
| 2 | High | A repo `rootDir` or `outputDir` that is a symlink led the worker to archive and upload any host path (`build.ts` `resolveInside` was lexical). | Fixed: real-path check |
| 3 | High | Project variables were merged into the `docker run` process environment, so `DOCKER_HOST`, `HTTPS_PROXY` or `LD_PRELOAD` changed how the worker's docker command runs (`build.ts`). | Fixed: `buildCliEnv` passes those by value |
| 4 | Medium | Untested servers had no pinned host key, so deploys and file operations went to whatever answered (`servers.ts`). | Fixed: pin on first connection |
| 5 | Medium | The `.env` refusal was by name only. A link in `shared/` to `current/.env` read the secrets (`files.ts`). | Fixed: scripts refuse after resolving links |
| 6 | Medium | A running deploy overwrote `canceled`, so a canceled deploy could go live (`pipeline.ts` `setState`). | Fixed |
| 7 | Medium | The GitHub webhook and deploy hook read an unbounded body first; signed deliveries could be replayed. | Fixed: counted caps, delivery-id guard |
| 8 | Medium | Push branch names and hashes reached `git clone` and `git fetch` unchecked (option injection with a leading `-`). | Fixed: `assertGitRef`, `assertGitSha`, `--` |
| 9 | Medium | The deployment `error` column was unmasked, and multi-line secrets (PEM keys) were never masked (`logger.ts`). | Fixed: `redact.ts` |
| 10 | Medium | `exec` buffered unlimited output from the user-controlled container (`connection.ts`). | Fixed: 128 MB cap |
| 11 | Low | One user could hold all 50 terminals. | Fixed: 5 per user |
| 12 | Low | Terminal input and upload bodies were unbounded without Content-Length. | Fixed: counted reads |
| 13 | Low | File list, read and download (each opens SSH) had no rate limit. | Fixed: 120 per minute |
| 14 | Low | A backslash in a file name broke the Content-Disposition header. | Fixed |
| 15 | Low | `writeFile` put `mode` unquoted into `chmod` (callers pass constants). | Fixed: octal only |
| 16 | Low | `3fff::/20` counted as public in the SSRF guard. | Fixed |

## Checked, no issue

- Shell: file scripts are constants with quoted arguments. Deploy, inventory, adoption and cleanup values go through `shellQuote` or a strict check (slug, UUID, unit name, number). `assertShellDir` guards the terminal start folder.
- Paths: no `..`, absolute, NUL or empty segments. Scripts resolve with `readlink -f` and write only in `shared/`.
- GitHub signature: HMAC over the raw body, constant-time compare.
- Deploy hook: 192-bit token, only its SHA-256 is stored and looked up, so there is nothing to time.
- SSRF: outbound webhooks need https, a domain, port 443, public answers, a pinned address, no redirects, a 5 s timeout. Notify URLs use a host allowlist.
- Terminal: random ids, owner checked on each call, switch read per request, 8 KB input, idle and total limits.
- Archives: the worker only creates them; the container unpacks its own as its own user.

## Not fixed

- Other authenticated JSON routes (`projects`, `env`, `domains`, `account`) call `req.json()` with no cap; use a global limit.
- The deploy dedupe and per-project job lock are check-then-act; two worker processes could race. A unique index would close it.
- First-use pinning cannot see a man in the middle on the first connection.
- `BUILD_RUNNER=local` is unsandboxed (development only).
- Secrets under 4 characters, or base64 or URL encoded, are not masked. The replay list is per process.
