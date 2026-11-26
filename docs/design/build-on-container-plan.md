# Plan: build on the user's Nest container, not on Egg's host

Status (2026-11-13): built. Builds run on the user's container inside a `systemd-run` scope with a memory and CPU cap (`web/src/server/deploy/container-build.ts`), and the central Docker build was removed (migration `0026_container_only`). The text below is the original plan, kept for the reasoning; "today" in it means before this change. Egg's host now runs the dashboard, the database and the worker, and nothing else.

## Why

Today (`web/src/server/deploy/pipeline.ts`, around line 365) Egg clones the repository and runs install and build in a Docker sandbox on Egg's host. It then uploads the archive to the Nest container (`remote.unpackRelease`), runs production dependency install there (`remoteInstall`), and switches the service with `remote.activateProduction`, followed by a health check and a rollback to the previous release if the check fails.

Problems with that:
- Strangers' build code runs on the machine that holds everyone's data, with the Docker socket mounted in the worker (root on that host).
- Whoever hosts Egg pays for every build's CPU, memory, disk and network.

Building on the user's container means a person's build runs on a server they already control and already run their own code on. Egg's host then stays small.

## What changes

1. **Egg still clones, and uploads source, not a build.** The GitHub token stays on Egg's host and is never sent to the user's container. The archive is the source tree (already produced by `build.ts`), so the upload is smaller and does not depend on the container's toolchain for cloning.
2. **Install and build run on the container, in a new release folder** (`releases/<deployment id>`). The running app is not touched until the build succeeds.
3. **The build runs under a hard memory and CPU cap** (a systemd scope with `MemoryMax`, `CPUQuota`, low `CPUWeight`, and a lower `OOMScoreAdjust` for the app than for the build). If the build runs out of memory, the kernel kills the build, not the app.
4. **Only then** the existing activation step switches the symlink and restarts the service, and the existing health check and rollback run unchanged.
5. **Central builds stay as an opt-in** per project, off by default, with the current warning about the Docker socket.

## The three risks and how each is handled

**Memory on a 2 GB container.**
- Build with a cap (default 1024 MB, set per server on the Container page, max = what the server reports minus the app's own use). The build runs beside the running app and cannot push it out.
- Keep the app running during the build. Stopping the app for every build would cause downtime.
- A build that hits the cap fails with a clear message ("the build needed more memory than the cap of N MB"). The release stays live.
- Per-server build lock: one build at a time per container, so a preview build cannot starve a production build.

**Tooling on the container.**
- Probe the container before the upload: Node version (against the project's `engines` or a minimum of 22.13), the package manager the lockfile needs (npm, pnpm via corepack, yarn), Python 3 with `venv` (on Debian and Ubuntu `python3-venv` is a separate package, a real failure mode), and free disk space (check ≥ 2 GB free before starting).
- If something is missing, stop before the upload with the exact fix ("Install python3-venv on your container: sudo apt install python3-venv"). Nothing on the running app changes.

**Failed builds.**
- The build writes only to a new release folder. A failed build removes its own folder.
- The symlink switch, the service restart and the health check happen only after a successful build. Rollback is unchanged.
- Keep the newest six releases (already the rule, `KEEP_RELEASES`), and check disk before each build. The container's disk is 16 GB, and each release holds its own `node_modules`, so six releases can use a lot of it.

## Other effects to check

- **Timeouts.** Build timeout (15 min today) stays, now on the container. A timed-out build leaves the running app alone.
- **Secrets.** Build-time variables now reach the user's container. That is their server, and the same variables are already in their app's environment, so the exposure does not grow, but the docs must say so.
- **Preview deploys** use the same path, on their own ports, under the same build lock.
- **Central mode** keeps its current behaviour and is labelled "for trusted use only" in the settings.
- **Docs.** The "Where builds run" section and the Container and Limits pages change. The security page's claim that builds never touch the container must be rewritten, since the build now runs on the container, under a cap.

## Test plan

- **Unit tests:** the probe checks (Node, package manager, python3-venv, disk), the memory cap arguments (the exact `systemd-run` arguments), the release folder lifecycle (success, failure, cancel, timeout), the per-server lock, and the failure messages.
- **Integration on fake-nest** (WSL on Windows, with a real systemd only if WSL has it enabled): full deploy, a failed build with the app still serving, a build over the memory cap, rollback after a bad release, a preview deploy beside production.
- **A manual checklist on a real Nest container** before this is announced: deploy a small Node app and a Python app, deploy a build that exceeds the cap, check the running app's response time during a build, and check disk use after six releases.

## Options considered

| Option | Downtime | Risk to other users | Cost to Egg's host | Verdict |
| --- | --- | --- | --- | --- |
| A. Build on the container, beside the running app, capped | None (unless the build is killed) | Low (their own server) | Very low | **Recommended** |
| B. Stop the app while building | Every deploy | Low | Very low | Simple fallback, bad user experience |
| C. Build on Egg's host (today) | None | High (strangers' code on our host) | High | Opt-in only |

## Questions for you

1. **Source upload or a token on the container.** I recommend uploading source from Egg, so the GitHub token never leaves Egg's host. Agreed?
2. **Build beside the app, or stop it.** I recommend beside the app, with the cap. Stopping is the simpler fallback if the cap proves unreliable on real containers.
3. **Central builds.** Keep them as an opt-in, or remove them before launch?
4. **Default build memory** on a 2 GB container: 1024 MB. Is that acceptable?

## Phases and models

1. **Verify on a real container (owner), Sonnet 5.5 medium** for the checklist and the probe commands. Done first, because the cap and the Python package details depend on what a real Nest container actually has.
2. **Pipeline change: container build path, source upload, release folders, build lock, cap. Sonnet 5.5 high.** This is security-sensitive and changes deploy ordering. One agent, one pipeline.
3. **Probes and failure messages. Sonnet 5.5 high**, in the same change as step 2, because the probe results decide whether step 2 starts.
4. **UI on the Container page and the settings copy. Sonnet 5.5 high** with `project-frontend`.
5. **Docs and security page wording. Sonnet 5.5 high** (accuracy against code), after the code is final.

Nothing commits until you have reviewed the change in the browser and on fake-nest.
