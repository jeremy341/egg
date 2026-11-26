# Docker target adapter foundation

Docker is a real, capability-gated deployment mode, not just an internal contract. A project can use `dockerfile` or `compose` mode instead of the default `native` mode. This module defines the target contract and the Compose validator; it never opens a Docker socket itself. All engine access happens on the deploy target over SSH, against that target's local daemon.

## How the mode is exposed

The capability probe (`web/src/server/capabilities.ts`) runs a script on the target over SSH. It reads the local Docker daemon, `docker compose version`, systemd, node, python, the daemon's cgroup version and storage root, the free space there (minimum `DOCKER_DISK_FLOOR_MB`, 1024 MB) and the presence of `docker-proxy` for loopback port publishing. From those facts:

- `dockerfile` mode needs a reachable engine, cgroup v2, enough disk and verified port mapping.
- `compose` mode needs all of that plus the Compose CLI.
- `native` mode needs systemd and `tar`.

Anything unknown, malformed or false hides the mode. The result is returned by `GET /api/servers/:id/capabilities` and drives the hosting-mode choices in the new-project UI. `checkDockerCapabilities()` checks the same facts again before each deploy (engine, nesting, cgroup limits, disk, port mapping, plus Compose for Compose mode); a `null` or `false` capability refuses the deploy rather than guessing. The probe never connects to a remote daemon selected by an environment variable.

## Target contract

An implementation must run its checks and operations on the intended target. `deployDockerRelease()` preflights, prepares a candidate, checks it, then activates it; a failed prepare or check discards the candidate. prepare and check must leave the active release and its data untouched. Activation requires an atomic routing switch or a verified restoration of the previous route. If the activation outcome is uncertain, reconcile the target before further cleanup; the orchestration intentionally does not discard it. Candidate cleanup must be project- and release-scoped and must preserve persistent data. Rollback of application code cannot undo database migrations or external writes. A target implementation must additionally provide bounded build and health timeouts, authenticated secret delivery without logs, status/log collection, image retention, port allocation and safe rollback; those live in the integration, not in this contract module.

## Compose validation

Compose resolves the user's YAML on the target with `docker compose config`, so no YAML parser runs on the control plane. Egg validates the resolved object and executes a canonical representation of the validated values, never the original YAML. The validator refuses fields outside a narrow allowlist and calls out the dangerous ones explicitly. At most one service is the main service; other services are auxiliaries.

### Service fields integrators must reject

The forbidden service fields are:

`container_name`, `depends_on`, `links`, `external_links`, `binds`, `tmpfs`, `privileged`, `cap_add`, `devices`, `device_cgroup_rules`, `network_mode`, `pid`, `ipc`, `userns_mode`, `security_opt`, `extends`, `profiles`, `volumes_from`, `mac_address`, `sysctls`, `ulimits`, `shm_size`, `cgroup`, `cgroup_parent`, `runtime`, `group_add`.

Any field not on the allowlist is rejected too. The allowed service fields are: `image`, `ports`, `volumes`, `environment`, `networks`, `restart`, `command`, `entrypoint`, `user`, `working_dir`, `extra_hosts`, `dns`, `dns_search`, `healthcheck`, `labels`, `logging`, `deploy`, `init`, `stop_grace_period`, `stdin_open`, `tty`, `platform`, `pull_policy`, `read_only`, `expose`. A `build` key is always refused: Compose services must use prebuilt images.

### Other validator rules

- Top-level keys are limited to `services`, `volumes`, `networks` and `name` (source-form files may also use `name`; `networks` is only meaningful in the resolved form).
- `image` must match an image reference that Docker itself could have resolved, including an optional registry port and tag or sha256 digest.
- The main service must not publish ports; Egg maps the project's listen port to it. Auxiliary services may publish only explicit `127.0.0.1` host ports with valid port numbers.
- The main service must not set its own restart policy (only `no` is accepted); Egg manages it.
- Volumes must be declared named volumes. Bind mounts, paths and `.` parts in a mount source are refused, as are names that are not declared in the top-level `volumes` block. Declared volumes may set only `name` (which must be the project-prefixed name) and `driver: local`; `external` is refused.
- Networks must be declared at the top level. Services may join only declared networks; declared networks may set only `name` (project-prefixed) and `driver: bridge`; `external` is refused.
- `environment` must be a map.
- Canonical output containing YAML tags (`!include`, `!!python/...`), anchors, aliases or merge keys is refused, because each can change what a later tool sees without changing the JSON Egg validated. Interpolation and Compose extensions are not accepted.

Named volumes need stable project-scoped names outside release folders; deletion must preserve data by default. These rules do not yet cover dependencies, health checks as a scheduling contract, or full Compose semantics.

Before trusting this mode on a new target, test the actual transport, candidate isolation and routing, crashes and ambiguous activation recovery, permissions, limits, cleanup and rollback on real Nest and self-hosted Linux targets. Docker daemon access grants powerful target privileges and does not imply isolation between projects.
