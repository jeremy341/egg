# Bot hosting: make Slack/Discord bots (and any background app) a first-class, friendly path

**Goal:** A student connects a Discord or Slack bot repository and has it running on their Nest container in minutes: pick "bot", add the token, deploy — no port, no domain, no server knowledge. The dashboard then proves it is alive (status, logs, restart alerts) and makes webhook bots and scheduled commands just as easy.

**Relation to existing plans:** This is the product slice of `2026-11-15-broad-hosting-and-provider-support.md` (workload profiles: web / worker / scheduled). That plan builds the platform adapters; this plan finishes the end-to-end bot experience on top of it and sequences the work by user value.

**State of the tree (as planned 2026-11-19):** the Nov 15 work is partially merged into the working tree. Already present:

- `projects.workloadKind` (`"web" | "worker"`) and `deploymentMode` (`"native" | "dockerfile" | "compose"`) with migration `drizzle/0044` and the schema enums (`src/server/db/schema.ts:135`).
- The new-project flow has a workload picker (`src/components/hosting-options.tsx`), hides the port field for workers, and refuses static runtimes for workers (`src/components/new-project-flow.tsx:377-403`).
- `createProject`/`updateProject` validate the web/worker port rules (`src/server/projects.ts:196-198, 296-301`), and with the `drizzle/0049` migration plus the settings seam finished this session, Docker-mode container settings (Dockerfile/Compose file paths, service, image port) are stored and presented.
- The deploy pipeline already treats workers as first-class: it skips the port wait and checks "the worker stays active" instead (`src/server/deploy/pipeline.ts:637-680`), on systemd units with `Restart=always`.
- The worker monitors systemd state (`monitor.ts`), so down-alerts, the status surface and uptime checking already apply to bots.
- Scheduled jobs exist end to end at the API/systemd-timer level (`scheduled_jobs` table, `lib/cron-schedule`, worker runner, `api/projects/[id]/jobs/*` routes with run-now and logs).
- Environment variables are write-only and per target (`all/production/preview`), build and runtime logs have level filters, and alerts send to Discord or Slack.

So "host a bot" already works in the current tree. What is missing is exactly what was asked for: it must be **easy and user friendly** — the flow should know what a bot is, ask for the right secret, and prove it is alive.

## Selected design: "bot" stays a worker, with guided setup

Keep `workloadKind: "worker"` as the only bot type (no new platform kind), and spend the effort on the setup experience, the secrets hand-off, and webhook exposure. Rationale: both models are already deployable, observable, and alerting; duplicating them for a "bot" kind doubles every adapter contract for no runtime difference.

### M1 — Verify the current path on a real Nest container (blocking base)

Everything below assumes a worker deploys and restarts on a real container. The existing docs say Docker-versus-Nest and several runtime behaviors are untested there.

- E2E: new project as worker, Node and Python, disconnect mid-run, crash the process (exit and OOM), watch `Restart=always` recover it, check logs, alerts, and uptime state.
- Record findings in `docs/selfhost/README.md` (probe results, restart behavior, logs under restart loops).
- Fix only what this test exposes; do not add features first.

### M2 — The bot path in the new-project flow (the friendliness core)

- **Workload picker copy:** the worker option reads "A bot or background app (Discord bot, Slack app, queue worker). No public URL needed; Egg keeps it running and stays quiet about ports."
- **Framework detection:** `repo-detect` already reads repositories; when dependencies include `discord.js`, `discord.py`, `telegraf`, `slack-bolt`, or `python-telegram-bot`, default the workload to worker and show one line: "This looks like a Discord bot — we set it up as a background app." Detection is a default, never a lock: the picker stays editable, mirroring how runtime detection is editable today.
- **Guided secrets step:** after creation (or at first deploy), the project shows a "Before it starts" card: for a detected framework, list the token names it will look for (`DISCORD_TOKEN`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `TELEGRAM_BOT_TOKEN`) as ready-to-add environment rows. Always just a suggestion list — Egg never asks for a token anywhere except env vars, and never creates the variable itself.
- **First-deploy confidence:** the deploy success screen for a worker says what "working" means for it: process active, uptime checks green, where logs are, and how a crash alert will arrive.
- **Docs pages:** one page per stack a student actually uses ("Deploy a Discord bot (discord.js)", "Deploy a Discord bot (discord.py)", "Deploy a Slack app (Bolt, Socket Mode)") following the existing docs structure, and a "Keep a bot alive" page (crash loops, restarts, memory alerts, why timers need the scheduled-jobs feature instead of sleep). Keep the `PRODUCT.md` voice: short sentences, what it does first, then what it needs.
- **Template links:** link starter repositories from the docs (and offer them in the flow as a "start from a template" link that prefills the repo URL). Egg hosts no templates itself.

### M3 — Webhook bots: give a worker a URL

Some bots must receive HTTP (Slack Request URL, interactive components, health pings). Today the only answer is "make it a web project", which changes its monitoring semantics and forces a phony listener.

- Allow a worker to hold `listenPort`. The schema and its partial unique index already permit `listen_port IS NOT NULL` on workers (`projects_server_listen_port_idx`); the port rules at `src/server/projects.ts:196-198` are the only refusal.
- Rules: a worker with `listenPort` has that port reachable publicly and can attach domains like a web project, but keeps its active-check health model (no health-path requirement). A worker without one stays portless. UI: an optional "Expose a URL" field with the same explanation.
- Ingress: the deploy pipeline maps the port with the code paths web projects use; no new ingress code.
- This is the only milestone that touches the deploy path, so it lands after M1's E2E proof and behind the same real-container verification.

### M4 — Scheduled jobs in the dashboard

The scheduled-jobs engine and API exist; the dashboard has no surface for them.

- A "Scheduled jobs" card in project settings: list (cron, in-words schedule, last run state), create/edit (validated by `parseSchedule`), pause/resume, "run now", last run log link. Reuse `JobView`/`JobStatus` and show the states the API returns (`running/failed/ok/never/missing`).
- Copy states schedules run in UTC, in words, via `describeSchedule`.
- Cap and confirm destructive editing consistent with the existing jobs caps (`MAX_JOBS_PER_PROJECT`).

### M5 — Bot-operator polish (alerts and diagnostics)

- Alert copy for workers: "The process stopped answering" instead of web-flavored wording where it appears (`monitor.ts`, notify templates).
- A restart-count line on the project (systemd `NRestarts` is already probed) so a crash-looping bot is visible without opening logs.
- Honesty for exotic runtimes: anything installable/startable as a process works; binaries and unusual toolchains go through the broad plan's Docker track.

## Out of scope here

- Docker/Compose deployment wiring (`docker-target.ts` is ready and the storage seam now exists; the deploy-path integration stays in the broad plan's Docker track, capability-gated against real Nest containers).
- New git providers, PR previews, cron outside systemd timers.
- Any feature that asks for a bot token anywhere except the existing env-var flow.

## Review focus

1. Real-container E2E before advertising anything (M1) — no "it should work" copy.
2. Every new prompt for secrets goes through env vars only; values stay write-only and masked in logs (existing guarantee — do not regress it in the guided-secrets UI).
3. Worker-with-URL (M3) must not weaken the web project's port uniqueness or the ingress limits; reuse `assertPortFree` and the existing unique index rather than new tables.
4. Detection only defaults — a student must never fight an auto-choice that does not say it was made.
5. Test additions mirror the house pattern: `new-project-flow` fixture tests for the picker and secrets copy, `projects` tests for the worker `listenPort` rule change, `scheduled-jobs` tests for the new UI contract.
