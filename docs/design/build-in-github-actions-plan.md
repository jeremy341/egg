# Plan: build in GitHub Actions, deploy the finished release to the container

Status (2026-11-13): built on the server side. Egg accepts a finished release from a GitHub Actions workflow with scoped build credentials (`web/src/server/builds/`, migration `0030_github_builds`); uploads have an idle and total time limit and a concurrency cap. Still open from this plan: a workflow generator in the dashboard and a "test connection" button. The text below is the original plan.

## Why

Building on the user's container costs memory, CPU and disk on a 2 GB machine that also runs their app. A framework build (Next.js and similar) can need more than the container can give. GitHub Actions runners have about 7 GB of memory and 2 CPUs, and the build runs there, not on the container. The container then only receives finished files and runs them.

Measured on this machine, for scale: Poorup's install peaks at about 200 MB, so plain Node apps already fit. The gain is for framework builds.

## How it works

1. **The user adds one workflow file** to their repository: `.github/workflows/egg.yml`. Egg generates it for them and shows it in the dashboard, with a copy button. It runs on push to the production branch and on pull requests for previews.
2. **The workflow installs and builds** with the project's commands (the same install and build commands Egg already stores for the project).
3. **The workflow packs the release** (the built output and what the app needs to run) into one archive, computes its SHA-256 checksum, and uploads it to Egg with the project's upload credential, sent in the `Authorization: Bearer` header, through `POST /api/builds/upload`. The archive carries the commit SHA, the branch and the workflow run id.
4. **Egg checks the upload**: the credential belongs to one project, has the `upload` scope and has not expired, the checksum matches, the commit is the one Egg asked for, the size is within the 500 MB limit, and the archive has no paths that escape the release folder (the same path checks the container build already uses).
5. **Egg runs the deploy on the container** exactly as today: it unpacks into a new release folder, runs the production install (`npm ci --omit=dev`, which is light for plain apps), switches the service, health-checks it, and rolls back if the check fails. The container runs no build step.

## Decisions

- **Build-time variables** (for example `NEXT_PUBLIC_*`) are needed inside the GitHub build. Egg stores them. The workflow asks Egg for them with `GET /api/builds/env` (add `?env=preview` for the preview variables), over HTTPS, using the matching credential in the `Authorization` header, and never writes them to a log. The user must allow the credentials to read them for this project; the dashboard says so.
- **Three credentials, not one token.** Each project gets three, made together: `upload` (can only upload a release), `env_preview` (can only read the preview variables) and `env_production` (can only read the production variables). The user stores them as three GitHub secrets. Each is sent only in the `Authorization: Bearer <token>` header, never in the path or the query string, because URLs end up in proxy and server logs. Each is valid for 90 days. Egg stores only their SHA-256, shows them once, and rotates all three at once from the dashboard (`POST /api/projects/[id]/build-credentials`; `DELETE` revokes them; `GET` shows only when they were made and when they expire). A credential of the wrong scope, an unknown, expired or revoked one all get the same 401. A leaked `upload` credential lets someone upload a release for that one project only, and the checksum and commit checks still apply; a leaked preview credential cannot read production variables.
- **No new GitHub permissions.** The workflow uploads to Egg, so Egg doesn't need access to GitHub's build artifacts. The GitHub App keeps its current permissions.
- **Fallback**: the container build stays available. Plain apps can keep it. The project setting "Where builds run" gets a third choice: "On GitHub Actions (recommended for frameworks)".
- **Cost to the user**: GitHub's free plan includes minutes for public repositories; private repositories get a monthly free allowance. The dashboard explains this in one sentence.
- **Egg's host** does no build work in this mode.

## The per-project setting

"Where builds run" has three choices, stored per project:

- **Build on my server.** Egg builds on the user's container under the memory cap. Nothing depends on GitHub. Suits small apps.
- **Build on GitHub.** The build runs in GitHub Actions and the finished release is uploaded to Egg. Suits framework builds.
- **Automatic (recommended).** Plain apps build on the server. Framework builds default to GitHub, and Egg says why in one sentence.

Egg also suggests the switch when it's needed. If a build on the server stops for lack of memory, the message reads: "This build needs more memory than your container can give. Switch this project to building on GitHub?", with a button that changes the setting and deploys again.

Changing the setting never happens silently: the dashboard shows the current choice and a short explanation.

## What is not covered

- Projects that need a server-side build step at runtime (rare) stay on the container build.
- Builds that need secrets Egg cannot store will not work until the user adds them.

## Phases and models

1. **Upload endpoint, scoped credentials, checksum and path checks, and the "prebuilt" pipeline mode.** Sonnet 5.5, high (security-sensitive: an upload from outside the server).
2. **The workflow generator and the dashboard copy.** Sonnet 5.5, high, with `project-frontend`.
3. **The "Where builds run" choice and its explanation.** Sonnet 5.5, high.
4. **Docs and the security page wording.** Sonnet 5.5, high, after the code is final.
5. **A real test (owner):** one Next.js repository built in GitHub Actions, deployed to a Nest container, with a deliberate failed build and a deliberate bad checksum.

## Questions for you

1. Is it fine for projects that use framework builds to depend on GitHub Actions?
2. For build-time variables, should Egg serve them to the workflow with the scoped variable credentials (my recommendation), or should the user copy them into GitHub secrets?
3. Keep the container build as a fallback for plain apps?
