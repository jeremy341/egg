# Backend setup

How to run Egg for real: what to register, what to configure, and how the pieces fit.

## Quick start (local, no accounts needed)

```bash
cd web
pnpm install
pnpm run setup    # writes .env.local with a fresh APP_SECRET and LOCAL_MODE_SECRET
pnpm dev          # http://localhost:3000, with the deployment worker built in
```

Open the app and use the **Development sign-in** form. It only appears when `DEV_LOGIN=1` and the build is not a production build. Setup leaves `DEV_LOGIN=0`; enable it explicitly for development. With `LOCAL_MODE=1`, it also requires your local password.

To try deploys without a Nest account, run a stand-in container:

```bash
pnpm fake-nest    # in a second terminal
```

Then add these to `.env.local` (the script prints the exact `UNIT_DIR`):

```
NEST_HOST=127.0.0.1
NEST_PORT=2222
UNIT_DIR=<printed by pnpm fake-nest>
```

`fake-nest` accepts the public key of every server saved in your local database and runs the commands on Linux (WSL on Windows). It is a development tool, never a substitute for a real Nest container.

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `APP_SECRET` | yes | 32+ characters. Encrypts SSH private keys and environment variables. **Back it up.** Losing it makes every stored key unreadable, and changing it does the same. |
| `APP_URL` | yes | Public URL of the site, used for OAuth redirects. |
| `DATABASE_URL` | no | SQLite file, default `file:./data/egg.db`. |
| `HACKCLUB_CLIENT_ID`, `HACKCLUB_CLIENT_SECRET` | for login | From a Hack Club Auth app. |
| `DEV_LOGIN` | no | `1` allows the fake sign-in outside production builds. |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | for private repos and push-to-deploy | From a GitHub App. The private key may use `\n` escapes. |
| `RUN_WORKER` | no | `1` runs the deployment queue inside the web process. `0` means run `pnpm worker` yourself, for example on another machine. |
| `WORKER_CONCURRENCY` | no | Parallel deployments, default 2. One project never builds twice at once. |
| `NEST_HOST`, `NEST_PORT` | no | Defaults `hackclub.app` and `22`. Only change for testing. |
| `UNIT_DIR` | no | Where systemd units are written on the container. Default `/etc/systemd/system`. |

## Shared project environment values

The owner-only `GET`, `POST`, and `DELETE /api/projects/:id/shared-env` endpoints manage encrypted values in the existing environment vault. Pass `environment=all`, `production`, or `preview` to list or delete values; POST accepts `{ "environment": "production", "key": "API_TOKEN", "value": "..." }`. Listing returns decrypted values, so keep responses private. Values are authenticated with the project, key, and environment as encryption context and are used by deployments for that same environment.

Builds stop after 15 minutes. That cap is a constant in the code, not a setting.

## Hack Club Auth

1. Open <https://auth.hackclub.com/developer/apps> and create an app.
2. Redirect URI: `<APP_URL>/api/auth/callback`.
3. Put the client id and secret in `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET`.

New apps start as `community_untrusted`, so users see a warning banner during consent. After the app is finished, ask Nora to promote it to `community_trusted`. The app asks for `openid`, `profile` and `email` only. It never receives anything that grants access to a Nest container.

Unverified: the token endpoint is called with a form-encoded body, and PKCE parameters are sent. The Hack Club docs show JSON-style examples and do not mention PKCE. If login fails at the token step, check this first.

## GitHub App

Needed for private repositories, the repository picker, and deploying on every push. Public repositories can be deployed without it by pasting a URL.

Create an app at <https://github.com/settings/apps/new>:

- **Homepage URL:** your `APP_URL`.
- **Callback URL:** `<APP_URL>/api/github/callback`.
- **Setup URL:** `<APP_URL>/api/github/callback`, with "Redirect on update" on.
- **Request user authorization (OAuth) during installation:** on. This is how Egg learns which installations belong to which user.
- **Webhook URL:** `<APP_URL>/api/webhooks/github`, with a random secret saved as `GITHUB_WEBHOOK_SECRET`.
- **Repository permissions:** Contents: read-only. Metadata: read-only. Pull requests: read and write (only needed for the preview comment; without it, previews still build and the comment is skipped).
- **Subscribe to events:** Push and Pull request. (Installation events arrive without a subscription.)

Generate a private key and put the PEM in `GITHUB_APP_PRIVATE_KEY`. Copy the App ID, slug, client id and client secret into the matching variables.

A pushed branch that matches a project's production branch deploys to production. Any other branch builds a preview on its own port; only the newest two previews are kept.

A pull request from the same repository links to its preview and gets one comment from the App, updated as the build finishes. Closing the pull request cancels a build in progress and removes its previews from the server. Pull requests from forks are never built, since that would run a stranger's code with the project's environment variables. Existing installations must accept the new permission and the App must be set to subscribe to Pull request events.

## What runs where

```
browser ──> Next.js app ──> SQLite          (users, servers, projects, logs, jobs)
                │
                └─ queue ──> worker ──> git clone ──> build sandbox (Docker)
                                  │
                                  └──────── SSH ──> Nest container: unpack, systemd, health check
```

- The **worker** builds on the machine it runs on, never on Nest, so builds do not use your container's 2 GB of RAM.
- A **release** is a folder `~/.egg/<project>/releases/<id>` on the container. `current` is a symlink to the live one. A deploy unpacks, installs production dependencies, writes the service file, points `current` at the new release, restarts, and waits for the port to answer. If it does not, the symlink is switched back and the old release is restarted.
- **Rollback** switches `current` back to an earlier release that is still on disk. The newest five production releases are kept.
- **Previews** run as `egg-<project>-pv-<id>.service` on ports 20000 to 29999. Nest maps domains to ports on its own dashboard with no API, so mapping a preview to a domain is manual.
- Everything Egg puts on a container lives under `~/.egg` and in `egg-*.service` units. Removing those removes it.

## Security notes

- **Where builds run.** Never on Egg's host. Install and build run on the user's own Nest container inside a `systemd-run` scope with a memory cap (512 MB for a new server, changeable on the Container page, and never reaching into the 512 MB kept for the running app) and a CPU cap. A project can instead build in GitHub Actions and send Egg the finished release.
- **Network from builds.** Builds have normal outbound network access, because installing dependencies needs it. They run on the user's container, so what a build can reach is what that container can reach.
- **SSH keys.** One ed25519 key per server. Stored sealed with AES-256-GCM, bound to the server's id. The host key is pinned on first connection, and a change aborts the connection before anything is sent.
- **Root.** SSH into Nest lands in a root shell in the user's own container, so this key is effectively root there. The Connect page says so before the user adds it. Removing the key in the Nest dashboard revokes access.
- **Sessions.** Random tokens in an httpOnly, SameSite=Lax cookie. Only a hash is stored. Writes also check the `Origin` header. Turning on password sign-in needs a Hack Club sign-in from the last 5 minutes, so an old session cannot add a sign-in method that outlives it.
- **Webhooks.** Accepted only with a valid HMAC signature over the raw body. A request without `Content-Length`, over 5 MiB, or without a well-formed signature header is refused before the body is read. At most 4 bodies are read at once, each must keep arriving (15 s idle) and finish in 30 s. Caddy holds the same 5 MiB cap. Rate limiting is left to the operator's firewall or load balancer, because stock Caddy has none.
- **Security reports.** The private inbox takes 12 reports an hour and 60 a day in total, counted in the database so a restart does not reset it. One network may use a tenth of the remaining space per day; for that Egg keeps a keyed digest of the address for one day, never the address. From 80% full the hourly budget drops to 2 and the administrator is warned.
- **Build uploads.** A build sent from GitHub Actions is dropped after 60 s without data or 15 minutes in total, and its partial file is deleted. Egg receives at most 4 at once, 2 per project.
- **Scheduled jobs.** A job is a systemd timer and a oneshot service written next to the app's service (`egg-<slug>-job-<id>.timer` and `.service`), both marked as ours. The command runs in `current` with the app's `.env`, at lower priority, for at most 30 minutes, and never more often than every 5 minutes. The schedule is five cron fields in UTC, expanded to explicit numbers before it reaches the unit file. Adding one needs a first deployment, since there is nothing to run it in before that.
- **Deploy hooks.** `POST /api/hooks/deploy/:token` starts a deployment for scripts and CI. The token is shown once; only its SHA-256 is stored, so a copy of the database cannot be turned into working URLs. Creating a new one replaces the old one. A call is refused with 409 while a deployment for that project is still queued or running, and an optional `{ "branch" }` body is validated like a branch name. Unknown tokens answer exactly like missing ones.
- **Notifications.** The project's Discord or Slack webhook URL is sealed at rest and never returned by the API. Because the server posts to it, only `https` URLs on `discord.com`, `discordapp.com` (including `ptb.` and `canary.`) and `hooks.slack.com` with those services' own path shapes are accepted: no ports, credentials or query strings. Redirects are refused and the request times out after 5 seconds, so it cannot be used to reach internal addresses. A failing webhook is logged and never affects the deployment.
- **Repositories.** Only `https://github.com/...` URLs can be cloned.
- **Logs.** Environment variable values and tokens are masked before log lines are stored.

## HTTP API

All routes except auth and the webhook need a signed-in session. Errors are `{ "error": { "code", "message" } }`.

| Method and path | Purpose |
| --- | --- |
| `GET /api/me` | Current user |
| `GET /api/servers`, `POST /api/servers` | List, or create a server (returns the public key to paste) |
| `GET /api/servers/:id`, `DELETE` | One server, or disconnect |
| `POST /api/servers/:id/test` | Connect, pin the host key, probe the container |
| `POST /api/servers/:id/rotate-key` | New key |
| `GET /api/servers/:id/usage` | Live CPU, memory and disk |
| `GET /api/projects`, `POST` | List, or create |
| `GET /api/projects/:id`, `PATCH`, `DELETE ?remote=1&data=1` | Read, update, delete (optionally also from the server) |
| `POST /api/projects/:id/deploy` | Queue a deployment `{ branch? }` |
| `POST /api/projects/:id/hook`, `DELETE` | Create (or replace) the deploy hook, which returns its URL once, or revoke it |
| `PUT /api/projects/:id/notify` `{ url, on }`, `DELETE`, `POST .../notify/test` | Set, clear or test the Discord or Slack notification |
| `GET /api/projects/:id/env`, `POST`, `DELETE /api/projects/:id/env/:envId` | Environment variables (names only are returned) |
| `GET /api/projects/:id/runtime-logs?lines=` | Service output from journald |
| `GET /api/projects/:id/status` | Live state of the production service: running or crashed, uptime, memory, restarts, and one real request to the health path |
| `GET /api/projects/:id/jobs` (`?status=1` adds live state), `POST` | List the project's scheduled jobs, or add one `{ name, schedule, command, enabled? }`; at most 5 per project |
| `PATCH /api/projects/:id/jobs/:jobId`, `DELETE` | Change a job (including pause and resume with `{ enabled }`) or remove it from the container |
| `POST /api/projects/:id/jobs/:jobId/run` | Start the job once now, in the background |
| `GET /api/projects/:id/jobs/:jobId/logs` | The job's recent output from the journal |
| `GET /api/deployments?project=` | Deployments |
| `GET /api/deployments/:id`, `/logs?after=`, `/stream` | One deployment, its log, a live server-sent event stream |
| `POST /api/deployments/:id/redeploy`, `/rollback`, `/cancel` | Actions |
| `GET /api/domains`, `POST`, `DELETE /:id`, `POST /:id/verify` | Domain records and DNS check |
| `GET /api/github/installations`, `/repos?installation=` | GitHub state |
| `POST /api/webhooks/github` | GitHub webhook |
| `POST /api/hooks/deploy/:token` | Deploy hook (public, the token is the credential) `{ branch? }` |

## Tests

```bash
pnpm test
```

The suite includes a mock Nest container: an in-process SSH server that runs commands on real Linux. On Windows it uses the first WSL distro, because Git Bash cannot create real symlinks, which the release switch needs. Set `TEST_WSL_DISTRO` if yours is not called `Ubuntu`.

## Not verified against a real Nest container

These are assumptions that held in the mock and still need one run against `hackclub.app`:

- The bastion forwards plain exec channels (uploads use `cat`, not SFTP).
- The container runs systemd as PID 1 and SSH lands as root.
- Writing units to `/etc/systemd/system` and `systemctl restart` work for that user.
- Docker-based builds have not been run end to end on a machine with Docker. The build step is covered by running it with no build command.
