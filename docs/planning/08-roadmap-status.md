# Roadmap status

Written 2026-11-13, after a read-only review of the working tree proposed a roadmap in four priority levels. This file records what was done from it, what was already there, and what is left, so the next round starts from the code and not from the review.

Priority levels as the review used them: **P0** protect running apps and data, **P1** needed for a dependable first release, **P2** valuable after that, **P3** later or optional.

## Done on 2026-11-13

| Item | Level | What changed |
| --- | --- | --- |
| Delete during an active deployment | P0 | A remote delete reserves the project first and is refused with 409 before the container is touched. See decision 36. |
| Stolen session could add a password | P0 (audit) | Turning on password sign-in needs a Hack Club sign-in from the last 5 minutes. Decision 31. |
| Webhook memory use before the signature check | P0 (audit) | Cheap refusals first, 5 MiB cap, 4 bodies at once, idle and total time limits. Decision 32. |
| Next.js advisories | P0 (audit) | 16.4.4 to 16.4.5. Decision 35. |
| Security inbox could be filled | P0 (audit) | Database-backed limits, reserve from 80% full, administrator warning. Decision 33. |
| Stalled build uploads | P0 (audit) | Idle and total time limits, concurrency caps. Decision 34. |
| Destructive actions say what they affect | P0 | The Delete Project card lists what is deleted and what is kept, and updates with the checkbox. |
| Misleading "Adopt an existing checkout" | P1 | Renamed and reworded. Decision 37 said Egg does not import a running copy; that is now superseded by the import API (see below). |
| Scheduled jobs | P3 in the review, built because it was already under way | Cron-style jobs as systemd timers, with add, edit, pause, run now, output and remove. Decisions 27 to 30. |
| Planning documents out of date | P2 | Status lines corrected for themes, container builds, GitHub Actions builds and the status page. |

## Already in the code before this round

### Backend regression fixes (2026-11-13)

- Worker polling is serialized, and shutdown waits for an outstanding claim and its work.
- PR closure keeps canceled previews canceled across activation, waits for running jobs before removing their files, and retries unfinished removals from the monitor without canceling a reopened PR's new build.
- Direct remote removals propagate stop and deletion failures; cleanup records are only marked complete after successful commands.
- Session creation only records fresh Hack Club authentication when the successful Hack Club callback explicitly supplies that provenance. Password sign-in does not satisfy that confirmation; local installations retain their explicit local reauthentication flow.

These repairs have focused regression coverage; real Nest validation remains separate.

The review listed these as things to build or verify. They exist; whether each is complete is a separate question.

- **Deployment preflight.** `web/src/server/deploy/container-probe.ts` checks the needed tools, free disk space and whether a memory cap can be enforced, before anything is uploaded.
- **Health before promotion, and automatic revert.** The pipeline keeps the old release until the new one answers, and switches back if it does not.
- **Themes.** A larger built-in set and a custom theme editor.
- **Conflict checks for existing apps.** `web/src/server/adoption.ts` refuses to overwrite a service, port, process or folder Egg did not create.
- **Scoped API tokens, session list, audit log, alerts, uptime monitoring, status pages.**
- **Recoverable cleanup.** Project and account cleanup drain work, show progress, and can be retried.

## Status of the review's "not done" list

Checked against the code on 2026-11-22. The original items are kept below in order, but several are no longer open. "API" means the server logic and route exist; where no dashboard screen calls them, that is stated rather than assuming the whole feature is finished.

| Review item (level) | Status now | Evidence and remaining limit |
| --- | --- | --- |
| 1. Import a running app (P1) | **API built 2026-11-15.** Guided UI not found. | `web/src/server/adoption-import.ts` plans a copy, runs the new release beside the original on another port, switches only after a health check and an explicit confirmation, and puts the original back if cutover fails. Routes: `POST /api/projects/[id]/adoption` and `POST /api/projects/[id]/adoption/[planId]/confirm`; tests in `adoption-import.test.ts`. No page or component in this checkout calls those routes, so the dashboard flow remains unverified. This supersedes decision 37. The review's risky cases are handled by explicit refusals rather than a design document: no Git repository, a dirty checkout, PM2, Docker, environment files, a non-systemd unit and workers are rejected with 409; only a clean systemd Git checkout with a matching commit and a ready preview on another port is accepted. The file copy itself uses `server/import-copy.ts`, which enforces a byte budget and rejects escaping symlinks. Workers and data-heavy checkouts are therefore still outside the import's scope. |
| 2. Deployment timeline and clearer failures (P1) | **Built 2026-11-15.** | `web/src/components/deployment-timeline.tsx` and `web/src/lib/deploy-timeline.ts` show Queued, Preparing, Building, Starting, Health check, Live, with a one-sentence actionable failure line derived from the log. |
| 3. Missed GitHub events (P1) | **Server and API built 2026-11-15. Dashboard button not found.** | `web/src/server/github/reconcile.ts` compares the branch head with the last deployed SHA; `GET /api/projects/[id]/reconcile` inspects drift and `POST` deploys it only with an explicit `confirm: true` and the expected SHA. The admin maintenance notice still tells operators to redeliver from GitHub or deploy by hand; no screen here calls the reconcile route. |
| 4. Environment variable clarity (P1) | **Built 2026-11-15.** | `web/src/components/env-help.tsx` states what "Both", "Production" and "Preview" mean, that a per-environment value wins over "Both", that saving does not change the running app until a redeploy, and that a rollback restores that release's values. |
| 5. GitHub Actions setup in the dashboard (P1) | **Built 2026-11-18.** | `web/src/components/github-setup-steps.tsx`, `github-build-card.tsx` and `web/src/server/builds/connection-check.ts` provide the workflow generator, the four secrets and a "Test connection" check with named results. |
| 6. Project sharing with roles (P1) | **Removed 2026-11-22.** | Built 2026-11-16 with invitations and Viewer/Developer/Owner roles, then removed to keep the product focused. Projects are single-owner; `server/project-roles.ts` is now just the shared owner-only authorization predicate. A forward migration drops the `project_members` and `project_invitations` tables. |
| 7. Less SSH authority (P1, depends on Nest) | **Still open.** | The stored key is still root on the container. No Nest-supported deploy API or restricted deploy user was found in this checkout. |
| 8. Operator screen for stuck work (P1) | **API built 2026-11-15. Screen not found.** | `web/src/server/operator-recovery.ts` and `/api/admin/recovery` inspect guards left by dead workers; `cleanup-card.tsx` offers a confirmed retry-after-drain for cleanup jobs. No dashboard screen calls the recovery endpoint, so an operator still needs the API. |
| 9. Diagnostics bundle, backup restore check, self-hosting readiness checks (P2) | **Partly built.** | `pnpm doctor` (`web/scripts/doctor.mjs`) and `pnpm backup` (`deploy/backup.sh`) exist. No restore verification was found in `backup.sh`, and the admin diagnostics view was not checked in this pass, so these stay open. |
| 10. Templates, staging environments, deployment comparison (P3) | **Comparison built 2026-11-05. Templates and staging still open.** | `web/src/components/deployment-compare.tsx` gives the "Compare" action on exactly two selected deployments (Branch, Commit SHA, Commit message, Environment, State, Duration, Created, Live release). No template or staging-environment implementation was found. |

## Known limits of what was done

- None of the changes was run against a real Nest container. The container behaviour is covered by tests against a mock SSH server with stand-in `systemctl` and `journalctl`.
- The webhook cap of 5 MiB was not checked against real large GitHub deliveries. A push that large is refused with 413 and has to be deployed by hand.
- The Caddy `request_body` block was not run through Caddy.
- The security inbox keeps a keyed digest of the sender's network address for one day. The privacy page says so; an instance that already showed the old notice to reporters should be aware of the change.
