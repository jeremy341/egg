# Broad Hosting and Provider Support Implementation Plan

**Goal:** Make Egg deploy and operate a wide range of long-running Linux applications and scheduled work from GitHub, GitLab, Forgejo, Codeberg, and generic Git sources, including PM2 and Docker workloads.

**Architecture:** Keep the dashboard as a control plane and add explicit provider, build, runtime, and target adapters behind the existing deployment flow. systemd remains Egg's primary service manager for apps and jobs. Users may choose PM2 in a Node app's start command; Dockerfile/Compose are separate deployment modes with their own capability checks, limits, logs, persistent data, and cleanup.

**Tech Stack:** Existing Next.js/TypeScript app, Drizzle schema, SSH deploy scripts, systemd, PM2, Docker Engine/Compose, GitHub Actions build uploads, provider APIs and signed webhooks.

**Spec:** Product request in this conversation; existing code and constraints in `docs/nest-research.md`, `docs/planning/02-decided-feature-scope.md`, `docs/design/feature-inventory.md`, `docs/selfhost/README.md`, and `docs/planning/08-roadmap-status.md`.

## Product promise

Egg should support any application or task that can run as a Linux process or container within the target server's permissions, network access, and resource limits. This includes websites and APIs, bots, workers, scheduled commands, and user-built binaries. The setup flow must state which target capabilities a project needs and give a clear reason when a target cannot run it.

"All kinds" is a broad compatibility goal, not a claim that a small shared container can run privileged workloads or unlimited resource use. Nest provides LXC containers; Docker is documented for Nest, but Egg's Docker deployment must be tested against real Nest containers and their available nesting features before being advertised.

## Selected design

Use **provider adapters and workload profiles** rather than one oversized runtime enum or a provider-specific deployment pipeline.

- A Git provider owns repository discovery, credentials, webhooks, commit/branch/PR metadata, and provider-specific preview capabilities.
- A build adapter produces either a release archive or a container image.
- A workload profile declares `web`, `worker`, or `scheduled` behavior and the process manager/runtime configuration.
- A target adapter runs native processes and jobs as systemd services/timers, and container projects through Docker or Docker Compose. A Node start command may invoke `pm2-runtime` inside Egg's systemd service. Adapters report status, logs, health, resource use, rollback, and cleanup.
- The current SSH/systemd deploy path remains the first supported target adapter. Add a local machine target only after platform-specific process managers and network behavior are designed.

GitHub, GitLab, Forgejo, and Codeberg get first-party provider adapters. Generic Git over HTTPS/SSH is a lower-level option with manual deploy and deploy-hook behavior when a provider API or webhook is unavailable.

## Workload and runtime scope

### Workload profiles

- **Web service:** one or more listeners, configured port(s), health checks, URL/domain mapping, restart, logs, and deployment history.
- **Worker/bot:** no public HTTP port required; process status, restart, logs, resource use, and environment variables remain first-class.
- **Scheduled job:** cron-style trigger, last/next run, exit status, bounded output, pause/resume, and manual run. Reuse the existing systemd timer work where possible.
- **Container stack:** one Dockerfile service first, then Compose services with declared ports, dependencies, volumes, and health checks.

### Language support

Keep Node.js and Python as built-in presets. Add Go, Rust, Ruby, PHP, and Java as requested; also complete Bun support because repository detection already sees Bun lockfiles. Use GitHub Actions artifacts or a target-side toolchain for compiled outputs, with an explicit choice and clear resource estimate. Framework detection remains editable and never silently chooses destructive or expensive build settings.

Presets should cover common build/install/start patterns and versions, but custom commands and Docker images are the escape hatch for uncommon frameworks. Do not claim support for a runtime until install, build, start, restart, logs, health/status, environment values, and cleanup are covered.

### Optional PM2 use

Keep systemd as the default and primary service manager. Allow users to install PM2 as a project dependency and set a start command such as `pm2-runtime ecosystem.config.js`. Document and validate this foreground pattern so Egg and systemd can observe its exit, logs, and restarts. Do not add a PM2 process-manager selector, a detached PM2 daemon, or PM2 support as a requirement for non-Node projects.

### Docker and Compose

1. Dockerfile mode: build or fetch an image, run one named container, bind only configured app ports, pass secrets through the target environment, wait for health, collect logs/status, restart, rollback, and prune old images safely.
2. Compose mode: support a documented subset of Compose, validate services/ports/volumes before deploy, expose selected web services, keep internal services private, persist declared data outside release folders, and show per-service health and logs.
3. Docker remains optional per target. Probe engine/Compose versions, nesting, cgroup limits, disk, and port mapping before enabling the mode. Never mount the Egg control-plane Docker socket into user builds.
4. Add capability and resource warnings for image size, memory, CPU, disk, persistent volumes, and build time. Docker daemon access inside a user's container is a powerful capability and must be clearly scoped.

## Git provider scope

| Provider | Initial integration | Follow-up capabilities |
|---|---|---|
| GitHub | Preserve the existing GitHub App and verified webhooks | Missed-event reconciliation and complete workflow setup UI |
| GitLab | OAuth/project selection, protected credential storage, secret-verified push events | Merge-request previews/comments and status checks |
| Forgejo | Instance URL, OAuth/token, repository selection, secret-verified webhooks | Pull-request previews/comments where instance APIs permit |
| Codeberg | Forgejo-compatible adapter with Codeberg defaults | Verify API/webhook differences against live service |
| Generic Git | HTTPS/SSH clone URL and deploy key; manual deploy and Egg deploy hook | Provider-neutral webhook contract when the host can sign events |

Provider features must be capability-based. Do not show PR previews, comments, or status checks when a provider/instance cannot support them. Keep credentials per provider and repository, request the smallest useful scopes, and document revocation.

## Global constraints

- Validate deployment behavior on a real Nest container; existing docs explicitly say this has not been completed.
- Nest bastion credentials currently grant root inside the user's LXC. Plan privilege reduction with Nest maintainers; Docker mode must not imply isolation between projects that the host does not provide.
- Respect the target's CPU, memory, disk, port, process, and network limits. Fail preflight before modifying a healthy release.
- Keep the current release serving until a candidate passes its health/start check; restore the previous release on failed activation.
- Store application data outside immutable release folders. Make data migration, backups, and rollback limits explicit.
- Preserve local Egg operation and Docker Compose for the control plane; do not confuse control-plane hosting with the target runtime.
- Keep provider tokens, deploy keys, webhook secrets, environment variables, and build credentials separate, encrypted where stored, scoped, revocable, and redacted from logs.
- Keep the current UI language direct: supported runtime, target requirements, build location, public ports, data persistence, and resource cost must be visible before deploy.

## Review focus

1. **Nest LXC cannot run Docker or Compose:** capability checks reject the mode before upload or service changes and explain the missing host feature.
2. **Non-web worker has no port:** deployment succeeds with process-based status; web-only health checks and domain mapping are optional.
3. **Large or failed builds exhaust limited disk/memory:** limits stop the candidate, preserve production, and leave a clear cleanup path.
4. **Provider webhook is duplicated, delayed, or forged:** signature verification, event idempotency, commit authorization, and reconciliation prevent duplicate/unauthorized deployments.
5. **Compose deploy changes persistent data:** release rollback restores application code/configuration but clearly does not reverse database migrations or external writes.

## Delivery phases

The work is several independently reviewable subsystems. This umbrella roadmap should be split into detailed execution plans before implementation begins.

### Phase 0: target validation and contracts

- Run a real Nest smoke deployment for current Node and Python flows, including reconnect, restart, health check, rollback, memory cap, disk cleanup, and domain routing.
- Ask Nest maintainers to confirm Docker-in-LXC expectations, nesting availability, resource/accounting behavior, policy, port exposure, and whether a deploy-specific SSH identity is possible.
- Define the workload, provider, build, and target capability records before adding schema variants; keep systemd as the native-process supervisor.
- Acceptance: written capability matrix for Nest and at least one self-hosted Linux server; current deploy path remains green under that matrix.

### Phase 1: workload model and lifecycle

- Add workload kind (`web`, `worker`, `scheduled`) with backward-compatible defaults for existing projects. systemd remains the supervisor for native workloads.
- Separate process status from HTTP health and domain routing. Let workers deploy without an exposed port.
- Standardize lifecycle events and deployment logs across builders and target adapters: preflight, fetch, build, start, check, activate, rollback, cleanup.
- Acceptance: existing Node/Python/static projects migrate without behavior changes; a worker and scheduled job have meaningful status and logs.

### Phase 2: optional PM2 use and broader native runtimes

- Add documented, verified Node examples for `pm2-runtime` as a custom start command and ecosystem configuration. Keep service installation, boot behavior, process status, and outer restart under systemd; add no PM2 selector.
- Improve Python profiles for `requirements.txt` and `pyproject.toml` workflows; add Bun support.
- Add Go, Rust, Ruby, PHP, and Java build/run profiles, prioritizing reproducible builds through GitHub Actions when target quotas make local compilation impractical.
- Acceptance: representative app per language completes import/detect, build, deploy, restart, logs, failed-deploy rollback, and redeploy from an older commit.

### Phase 3: Dockerfile deployment

- Add Docker target capability probes and a separate single-container release adapter.
- Define image building (target or supported remote builder), registry auth, secrets, explicit ports, health checks, log streaming, restart, rollback, and bounded image pruning.
- Test on real Nest and self-hosted Linux targets, including the exact LXC restrictions and resource accounting.
- Acceptance: disabled with a useful diagnosis when Docker is unavailable; successful deploy and rollback when available; no control-plane socket exposure.

### Phase 4: Compose stacks and persistent data

- Define a supported Compose subset and validation errors before starting containers.
- Keep data volumes stable across code releases; show data backup/restore and the fact that database schema changes are not rolled back with code.
- Add service-level status, logs, restart, port/domain selection, storage usage, and safe stack deletion that preserves data unless the user confirms its removal.
- Acceptance: a web + database example, a worker + web example, and an upgrade/rollback example pass on a target with documented limits.

### Phase 5: provider-neutral source model and integrations

- Refactor project source metadata and webhook intake behind provider adapters without breaking existing GitHub projects.
- Add GitLab, Forgejo, and Codeberg integrations, then generic Git import/deploy keys and manual/deploy-hook deployment.
- Add provider-specific previews, merge/pull-request comments, and commit checks only when supported; add missed-event reconciliation for each webhook provider.
- Acceptance: same authorized commit can be manually deployed and automatically deployed through every supported provider; webhook replay and revocation tests pass.

### Phase 6: local targets and self-hosted operations

- Keep local Egg control-plane install supported through Node and Compose.
- Design a distinct local target mode for Linux first; evaluate macOS launchd, Windows service/task, and WSL separately instead of treating them as systemd hosts.
- Add self-host diagnostics for local database, backups/restore, worker health, TLS, upgrades, and target connectivity.
- Acceptance: dashboard host and app target can be the same machine without confusing their configuration, public exposure, or lifecycle.

### Phase 7: product completion

- Finish team access screens and authorization across UI, API, CLI, MCP, webhooks, and workers.
- Add request/error/latency analytics, project disk use, broader notification channels, and provider-neutral deployment status.
- Document supported runtime/provider/Compose matrices, examples, limits, secrets, data persistence, migration, recovery, and unsupported requirements.
- Acceptance: a new user can pick any supported source, workload, runtime, and target mode from the UI and understand the requirements before authorizing or deploying it.

## Acceptance bar for each runtime/provider/target

- Repository detection is accurate and user-overridable; unsupported or ambiguous repos get a useful manual path.
- Build inputs are pinned/reproducible where lockfiles permit, bounded by time and resources, and separated from the running release.
- Secrets do not appear in URLs, logs, public images, previews, or generated workflow output.
- Service and worker deploys show start state, logs, restart count, health/status, and the deployed commit/image digest.
- Failed deploys keep the previous healthy workload intact; destructive cleanup names the exact project, service, images, volumes, and data it affects.
- Preview and production environments use distinct ports, variables, names, quotas, and cleanup rules.
- Documentation states which capabilities require Nest configuration and which are only available on a self-hosted target.

## Out of scope for this roadmap

- Claiming that every Linux application is compatible regardless of kernel privileges, architecture, external dependencies, or available resources.
- Running untrusted project builds on the Egg control-plane host or mounting its Docker socket into build jobs.
- Becoming a managed database, object-storage, queue, Kubernetes, or global CDN provider. Integrate user-managed services and persist app data safely first.
- Automatically changing Nest infrastructure, firewall, account quota, domains, or certificates without a supported and authorized Nest API.

