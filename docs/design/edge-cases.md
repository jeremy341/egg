# Edge cases: what real users will hit

Read-only pass over `web/src/server` (no application code changed). Each confirmed bug has a failing test in `web/src/server/edge-cases/`, named T:file. Status is bug (confirmed, test fails), works, or n/a.

## Confirmed bugs

| # | Case | Risk | Evidence | Smallest fix |
|---|------|------|----------|--------------|
| 1 | A log insert fails (deployment, project, server or account deleted mid-build, or a busy DB). The timer flush is `void`, so the rejection is unhandled and kills the worker, or the whole site when the worker is embedded. | high | `deploy/logger.ts:35,37,54`. T:deploy-logging | Catch in `flush()`, drop the batch. |
| 2 | Disconnecting a server leaves its open root shells running. | medium | `servers.ts:132` never calls `closeAllForUser(..., {serverId})`. T:lifecycle | Close that server's terminals first. |
| 3 | Deleting a project (also `?remote=1`) during a deploy: the worker re-creates the unit and folders afterwards, and hits bug 1. | medium | `projects.ts:533`, `runtime-info.ts:125`. T:lifecycle | 409 while a deployment is queued, building or deploying. |
| 4 | Cancel after the release switch: the release is live, yet the row is `canceled` and `isCurrent`, so it cannot be rolled back to. The cancel `UPDATE` has no state guard, so it can also flip a `ready` row. | medium | `pipeline.ts:441,495`, `projects.ts:480`. T:pipeline-edge | Check the abort signal before `markCurrent`; add the state list to the cancel `WHERE`. |
| 5 | A preview that fails its health check keeps an enabled `Restart=always` unit; cleanup only handles `ready` previews and the port is reissued. | medium | `pipeline.ts:237-260,505-517`, `projects.ts:325-343`. T:pipeline-edge | On failure run `removePreview` and mark it cleaned up. |
| 6 | Push events are accepted from any installation when the project has no `installationId` (public repo by URL). A same-named repo with the App installed triggers deploys. | medium | `github/webhook.ts:108`. T:github-events | Require an installation the project owner linked. |
| 7 | Repo renamed on GitHub: pushes arrive under the new name, no project matches, auto deploy stops silently. | medium | `github/webhook.ts:81-84,103`. T:github-events | Handle `repository.renamed` (subscribe in the App); update `repoFullName` and `repoUrl`. |
| 8 | Revoking a token leaves the terminals it opened running for up to 60 minutes. | medium | `api-tokens.ts:193`, `terminal.ts:104`. T:lifecycle | Add `closeAllForToken` to revoke. |
| 9 | Changing a project's port leaves its domains on the old port, still "valid". | medium | `projects.ts:211-229` vs `domains.ts:158-162`. T:projects-and-env | Move linked domains to the new port, set `pending`. |
| 10 | Two projects ask for one port at once: both saved (check then insert, no unique index). Deploy-time probing blocks the second. | low | `projects.ts:166-176`, `db/schema.ts:187`. T:projects-and-env | Unique index on `(server_id, port)`; map to 409. |
| 11 | Repo name matched case-sensitively: `alice/app` never matches GitHub's `Alice/App`. | low | `github/webhook.ts:103,180`, `projects.ts:187`. T:github-events | Lowercase on store and compare. |
| 12 | Expired tokens count toward the "25 active" limit. | low | `api-tokens.ts:153`. T:lifecycle | Also require `expiresAt > now`. |
| 13 | An env value with a bare `\r` is written raw; systemd ends the line there, so `PATH=` or `PORT=` can be injected. Owner-only, but it bypasses the reserved list. | low | `deploy/runtime.ts:177`. T:projects-and-env | Escape `\r`. |
| 14 | Build log rows are unbounded (25,000 lines stored). | low | `deploy/logger.ts:30-40`. T:deploy-logging | Cap per deployment, then one "truncated" line. |
| 15 | ANSI escapes are stored and shown raw; a NUL byte truncates the stored line. | low | `deploy/logger.ts:30`, `components/build-logs.tsx`. T:deploy-logging | Strip C0 controls and ANSI in `log`. |
| 16 | A multi-byte character split across pipe chunks becomes U+FFFD. | low | `deploy/build.ts:190`. T:deploy-logging | Use `StringDecoder`. |
| 17 | A Hack Club nickname with stray spaces can never be typed to confirm account deletion. | low | `auth/hackclub.ts:114`, `account.ts:104`. T:lifecycle | Trim the nickname. |

Found, no test (low): the deploy log stream checks auth only on connect and runs up to about 3.75 hours, so it outlives a revoked session (`api/deployments/[id]/stream/route.ts:34`). `build-logs.tsx` keeps every line and dedupes with `some()` per event, which is quadratic on huge logs.

## Checked: works or not applicable

| Case | Risk | Evidence | Status |
|------|------|----------|--------|
| Account deletion with servers, projects, deployments, webhooks, tokens, terminals | high | `account.ts:103-112` closes terminals first; FK cascades in `schema.ts`; a scratch run showed tokens die with the user | works |
| Disconnect: what keeps running | high | `servers.ts:132` removes records only; apps and units stay, by design (`account.ts:99`) | works (bug 2 aside) |
| Two servers, same Nest username | low | Unique per user only (`schema.ts:97`), so another account's `nd-` units look like removable orphans (`inventory.ts:277`). A global unique would let anyone squat a name | works, residual low |
| Same repo imported twice | low | No check (`projects.ts:136`); both deploy on push, fine for monorepos | works |
| Same port, two projects | medium | `projects.ts:166-176`; deploy probe `pipeline.ts:381` | works except bug 10 |
| Token of a deleted user; scopes narrowed; 365-day token after a change | medium | `principalFor` reads the row each request (`api-tokens.ts:278-291`); edit capped (`:245`) | works |
| Re-confirm as a different Hack Club account | high | `api/auth/callback/route.ts:36` compares `hackClubId`, redirects `mismatch`, session untouched | works |
| Session expiry mid deploy or upload | low | Deploys run in the worker; auth is checked once per request | works |
| Session expiry mid terminal | low | 10 minute idle and 60 minute limits (`terminal.ts:25-29`); revoke closes it (`account.ts:48`) | works |
| Repo deleted, App uninstalled, access revoked | medium | Uninstall clears `installationId` (`webhook.ts:215-225`); builds fail with a plain clone error (`build.ts:311`) | works |
| Branch deleted mid build; force push | low | Clean clone failure; a lost commit warns and builds the tip (`build.ts:333`) | works |
| Env name empty, spaces or `=`; value newlines or quotes | medium | `ENV_KEY`, `envInput` (`projects.ts:234-243`); `\n` and `"` escaped (`runtime.ts:174-178`) | works (bug 13 for `\r`) |
| Very large repo | low | 5 minute clone timeout, 500 MB archive cap (`build.ts:47,397`) | works |
| Concurrent deploys; rollback with redeploy | medium | One running job per project (`jobs.ts:25-47`); rollback checks the release exists (`pipeline.ts:545`) | works in one worker; two workers could race, low |
| Domain added twice or to two projects | low | Global unique (`schema.ts:304`, `domains.ts:76`); a simultaneous insert gives 500, not 409 | works |
| Domain whose DNS points elsewhere | low | `verifyDomain` returns `invalid` with the reason (`domains.ts:198-203`) | works |
| Leftover removal during a deploy | medium | Project and preview units count as managed (`inventory.ts:468-477`) | works |
| Unit name collision with an unmanaged service | high | `adoption.ts:60-80`, `remote.ts:50`; see `security-audit-exec.md` | works |
| CSV: huge sets, formula values | medium | 5,000-row cap and `x-export-truncated` (`export-csv-data.ts:34-50`); `=+-@\t\r` prefixed (`export-csv.ts:19-25`) | works |
| Account with no servers; 5-server limit | low | `servers.ts:83`; empty lists | works |
| Timezones: status page, analytics, activity | low | All server days are UTC (`status-page.ts:90`, `analytics.ts:179`, `activity.ts:200`); `build-logs.tsx:25` shows browser time | works |
| Builds longer than 1 hour marked failed by recovery | low | `jobs.ts:15` vs the 900 s default timeout (`config.ts:35`) | n/a at defaults |

## Totals

17 confirmed bugs: 1 high, 8 medium, 8 low. Run `npx vitest run src/server/edge-cases`: 17 fail, each for the reason in its row.
