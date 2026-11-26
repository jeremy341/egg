# Security audit: execution, files, terminal, SSH, deploy, webhooks, GitHub

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
