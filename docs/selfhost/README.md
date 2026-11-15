# Run Egg on your own computer or server

This guide has two parts. The first gets Egg running privately on your own computer, with no Hack Club account and nothing sent to anyone else. You sign in with one button, and your data stays in one file on your disk. The second, [Run Egg on your own server](#run-egg-on-your-own-server), uses Docker Compose on a Linux server with a domain and automatic HTTPS.

To change the name, colours, ports or build memory, see [customising.md](customising.md).

## What works where

| System | Support |
| --- | --- |
| Windows | Full. `pnpm fake-nest` needs WSL (see "Trying everything on one machine"). |
| Linux | Full. |
| macOS | The same as Linux. |

The CI workflow runs the typecheck, lint, tests and the dependency audit on Linux and macOS. The audit fails the Linux run on a high-severity finding. On macOS it only reports it.

## What you need

- **Node.js 22.13 or newer.** The repo pins `pnpm@11.20.0`, and that pnpm needs Node 22.13. (Next.js 16 alone would run on Node 20.9.) Check with `node -v`.
- **pnpm.** Run `corepack enable`, or install it with `npm install -g pnpm`. On Windows, run either in a terminal opened as administrator if it reports a permission error.
- **Git.**
- **A server to deploy to.** Egg deploys to a Hack Club Nest container over SSH. You can also try it with a stand-in server on this machine (see "Connecting a server").

## 1. Get the code and install

```bash
git clone https://github.com/jeremy341/egg.git
cd egg/web
pnpm install
```

Every command below runs from the `web/` folder.

## 2. Create the env file

```bash
pnpm run setup
```

Type `pnpm run setup`, not `pnpm setup`. pnpm has a built-in command called `setup` that does something else. This writes `web/.env.local` with a fresh random `APP_SECRET`, a separate `LOCAL_MODE_SECRET` recovery key, and `LOCAL_MODE=1`. Keep the file private. It never overwrites a file that already exists. If your file is older and has no `LOCAL_MODE=1` line, add it and add a fresh `LOCAL_MODE_SECRET` (for example, `openssl rand -base64 32`).

`LOCAL_MODE=1` enables local sign-in without an outside account. On the first sign-in after this update, enter the `LOCAL_MODE_SECRET` recovery key and choose a password with at least 12 characters. Egg stores only a salted scrypt hash in the database; it does not store your password in `.env.local`. Later sign-ins use the password. Leave `APP_URL=http://localhost:3000` as it is.

You can skip this step. `pnpm egg start` runs setup for you when `.env.local` is missing.

The setup script writes `DEV_LOGIN=0`. You can explicitly set it to `1` for a named development account with `pnpm dev`; it is ignored in a production build. When local mode is on, development sign-in also requires the local password.

## 3. Start Egg

```bash
pnpm egg start
```

One command does this, in order:

1. Creates `.env.local` if it is missing.
2. Checks the computer (see "The doctor" below).
3. Builds the app the first time.
4. Starts it on the port in `APP_URL`.
5. Opens your browser.

On the first sign-in, enter the recovery key and choose a password. After that, enter the password to sign in. Press Ctrl+C to stop Egg.

`pnpm egg start --dev` runs the development server instead. It reloads while you edit code and skips the build.

If you prefer separate steps, `pnpm build` and then `pnpm start` do the same without the checks. Open <http://localhost:3000/login>.

Your data is in `web/data/egg.db`. It stays on disk when Egg stops. Back it up together with `APP_SECRET` and `.env.local`; the database holds the password hash, and the recovery key in `.env.local` lets you reset the password if you forget it (see "Backups").

The deployment worker runs inside the web process (`RUN_WORKER=1`, which the setup script writes), so one command starts everything. If you set `RUN_WORKER` to anything else, run `pnpm worker` in a second terminal, or deployments stay queued.

## The doctor

```bash
pnpm run doctor
```

This only checks the computer. It starts nothing. Each check prints one line, and a problem has a `Fix:` line under it.

- A cross (`✗`) stops Egg from starting. `pnpm egg start` runs the same checks and stops on a cross. Examples: Node.js too old, `APP_SECRET` missing or too short, the port already in use, a data folder Egg cannot write to.
- A warning (`!`) does not stop anything. Egg itself starts without the tool a warning names.

The command exits with 1 when there is a cross, and 0 otherwise.

## Start on login (optional)

```bash
pnpm run service:install
```

This writes one file for your system and prints the command that turns it on. Nothing starts until you run that command. Run `pnpm egg start` once first, so a build exists, then stop it with Ctrl+C.

| System | File it writes | Turn it on |
| --- | --- | --- |
| macOS | LaunchAgent `~/Library/LaunchAgents/app.egg.web.plist`. The log is `~/Library/Logs/egg.log`. | `launchctl bootstrap gui/$(id -u) <the file>` |
| Linux | systemd user unit `~/.config/systemd/user/egg.service`. | `systemctl --user enable --now egg` |
| Windows | A PowerShell script at `%LOCALAPPDATA%\Egg\egg-task.ps1`. Running it registers a Scheduled Task named Egg that runs `pnpm start` when you sign in. The log is `%LOCALAPPDATA%\Egg\egg.log`. | `powershell -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\Egg\egg-task.ps1"` |

On Linux, `loginctl enable-linger` starts Egg at boot without you signing in. The service listens on the port in `APP_URL`.

To undo it, run `pnpm run service:remove`. It stops the service and deletes the file.

## What local mode does

`LOCAL_MODE=1` adds sign-in for one local owner called "Owner". The first sign-in uses the private recovery key from `.env.local` to set a user-chosen password. Normal sign-ins use that password. Change it from Account; reset it from the login page with the recovery key. The normal `pnpm dev`, `pnpm start`, `pnpm egg start`, and installed service commands bind local installs to loopback.

- **It is off by default.** Nothing turns it on except you setting `LOCAL_MODE=1`.
- **It refuses to run on a public address.** If `APP_URL` is not `localhost`, `127.0.0.1` or `[::1]`, Egg stops with an error that names the problem. Anyone who could reach a public address could otherwise sign in as you.
- **The recovery key is private.** Anyone who obtains it can reset the local password, so keep `.env.local` private and back it up safely.
- **The explicit override.** If you host it elsewhere, set `LOCAL_MODE_ALLOW_REMOTE=1` only behind a VPN or access proxy you control. The password protects sign-in, and the network control limits attempts to reach the service.
- **It skips the Hack Club confirmation.** Turning on the terminal or file changes normally asks you to confirm with Hack Club again. In local mode there is no Hack Club account, so that step is skipped.

You can still set the Hack Club variables later and use both sign-in methods side by side.

## Permission switches are off by default

Each connected server has three switches on its Container page: **Terminal**, **File changes** and **Removing leftovers**. All three start off for every new server, and local mode does not change that. Nothing is pre-enabled for you. The terminal is a root shell on the container, so turn it on only when you need it. Turning a switch on asks you to type the server name.

## Connecting a server

Egg deploys by SSH. A key made just for one server is stored sealed in your database.

1. On the Projects page, choose to connect a server and enter your Nest username, the name you log in with, for example `sam-r`.
2. Egg shows you a public key. Paste it into the SSH Keys page of the Nest dashboard.
3. Press **Test connection**. The first time, Egg reaches the host, reads its host key, hangs up and shows the fingerprint under **Confirm host key**. Nothing is sent to the server until you check the fingerprint against the one Nest shows for your server and press **Confirm host key**. Egg then pins that key, refuses any other one, and checks the container. The check only reads. It changes nothing on the container.

The key gives Egg the same access as your own login, so treat the machine that runs Egg accordingly. Removing the key in the Nest dashboard ends its access.

### Trying everything on one machine

To try deploys without a Nest account, run a stand-in container beside Egg:

```bash
pnpm fake-nest      # in a second terminal
```

It prints a `UNIT_DIR=` line and the fingerprint of its host key. Add these three lines to `.env.local`:

```
NEST_HOST=127.0.0.1
NEST_PORT=2222
UNIT_DIR=<the path fake-nest prints>
```

Restart Egg, then add the server. Set the three values first: each server keeps the host and port it was created with. At **Confirm host key**, the fingerprint on the page should match the `Host key` line that `fake-nest` printed.

`fake-nest` accepts the public key of every server saved in your database and runs commands on Linux. On Windows that means WSL: it needs a WSL distribution called `Ubuntu`, or set `TEST_WSL_DISTRO` to the name of yours before you start it. It is a trial tool, never a substitute for a real Nest container.

### Where builds run

Builds run on the Nest container of each project. The machine that runs Egg, your computer or your server, only clones the repository, packs the source and uploads it over SSH. It does not install or build anything, and it needs no Docker.

Before it uploads anything, Egg looks at the container. It needs:

- Node.js that matches the project's `engines` range, or 22.13 or newer when there is no range.
- The package manager the lockfile needs: npm, or pnpm or yarn through corepack.
- Python 3 and `venv`, for a Python project.
- `systemd-run` and `timeout`.
- At least 2048 MB of free disk.

If one is missing, the deployment ends with one line that says what to fix, and nothing is uploaded.

The build then runs in a new release folder under a cap, while the running app keeps serving:

- **Memory.** The server's **Build memory (MB)**, 512 MB by default, which covers installs and plain apps. A project with a build step gets at least 1024 MB while it builds, when the container has room for it (its memory minus 512 MB is at least 1024 MB). A build never gets more than the container's memory minus 512 MB, which stays free for the app. If that leaves under 256 MB, the build does not start. There is no swap.
- **CPU.** The server's **Build CPU limit (cores)**, 2 by default. The build runs at a low priority, so the app gets the CPU first when it is busy.
- **Time.** 15 minutes. The clone has its own fixed limit of 5 minutes and fails with "The build timed out."
- **One at a time.** One build runs at a time on a container. Another waits for up to 30 minutes.

A build that fails, runs out of memory, times out or is canceled deletes its new folder. The running release is not touched. An out-of-memory build fails with "The build needed more memory than the cap of N MB. Your app is still running." The second sentence is added only when a release was already serving.

The machine that runs Egg keeps the clone and the packed source in `DEPLOY_WORK_DIR` until the deployment ends, whether it worked or not. Then Egg deletes that folder. The packed source may be 500 MiB at most.

## Settings, one by one

Every name in the first table is read in `web/src/server/config.ts`. Put them in `web/.env.local`.

| Variable | Default | What it does |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | The address of the site. Used for redirects and the same-origin check on writes. Must match the address in your browser. |
| `APP_SECRET` | none, required | 32 or more characters. Encrypts SSH keys and environment variables. Back it up. Losing it, or changing it, makes every stored key unreadable. |
| `DATABASE_URL` | `file:./data/egg.db` | The database. A path starting with `file:` is relative to `web/`. |
| `LOCAL_MODE` | `0` | `1` or `true` turns on the local sign-in button. See "What local mode does". |
| `LOCAL_MODE_SECRET` | none | Required with `LOCAL_MODE=1`. A private random recovery key from setup, used to set or reset the local password. |
| `LOCAL_MODE_ALLOW_REMOTE` | `0` | `1` lets `LOCAL_MODE` run when `APP_URL` is not local. Does nothing when `LOCAL_MODE` is off. |
| `TRUST_PROXY` | `0` | `1` or `true` makes Egg believe the `X-Forwarded-For` and `X-Real-IP` headers for each visitor's address. Set it to `1` only when every request reaches Egg through a reverse proxy you run, which sets those headers itself. Without it every visitor counts as one address: analytics cannot tell visitors apart by address, and the limits on sign-in attempts and invalid access tokens do not apply. On your own computer, leave it off. |
| `DEV_LOGIN` | `0` | `1` shows a fake sign-in with a name field. Works only with `pnpm dev`. |
| `HACKCLUB_CLIENT_ID`, `HACKCLUB_CLIENT_SECRET` | empty | Hack Club Auth app credentials. Needed only if you want Hack Club sign-in. |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | empty | A GitHub App, for private repositories, the repository picker and deploy on push. Set them together. Public repositories deploy by URL without it. Setup is in [backend-setup.md](../backend-setup.md). |
| `DEPLOY_WORK_DIR` | `./data/work` | Where sources are cloned and built, relative to `web/`. Each deployment gets a folder here that Egg deletes when the deployment ends. Make sure the disk has room for the clone, the build and the archive (at most 500 MiB) of every deployment that runs at once. |
| `UNIT_DIR` | `/etc/systemd/system` | Where service files are written on the container. Change only with `fake-nest`. |
| `NEST_HOST` | `hackclub.app` | The SSH host. Change only with `fake-nest`. |
| `NEST_PORT` | `22` | The SSH port. Change only with `fake-nest`. |

These are read elsewhere in the code, not in `config.ts`:

| Variable | Default | What it does | Read in |
| --- | --- | --- | --- |
| `RUN_WORKER` | unset in the code, `1` from the setup script | `1` runs the deployment queue inside the web process. Anything else means run `pnpm worker` yourself. | `web/src/instrumentation.ts` |
| `WORKER_CONCURRENCY` | `2` | How many deployments run at once. One project never deploys twice at the same time, and one build runs at a time on a container. | `web/src/instrumentation.ts`, `web/worker/index.ts` |
| `MONITOR_INTERVAL_MS` | `300000` | How often the uptime monitor checks, in milliseconds. `0` turns it off. | `web/src/server/jobs.ts` |
| `PORT` | `3000` | The port `pnpm start` listens on. Set `APP_URL` to match. | Next.js |
| `FAKE_NEST_PORT` | `2222` | The port `pnpm fake-nest` listens on. Set `NEST_PORT` to match. | `web/scripts/fake-nest.ts` |

## Other commands

All run from the `web/` folder.

| Command | What it does |
| --- | --- |
| `pnpm worker` | Runs the deployment queue on its own, when `RUN_WORKER` is not `1`. |
| `pnpm fake-nest` | The stand-in Nest container. See "Trying everything on one machine". |
| `pnpm seed:demo` | Fills the database with sample projects for the `dev` user of the `DEV_LOGIN` form. `pnpm seed:demo --reset` removes them. |
| `pnpm test`, `pnpm typecheck`, `pnpm lint` | The tests, the TypeScript check and the linter. |
| `pnpm audit:prod` | Checks the production dependencies for known high-severity problems. |

To use Egg from a terminal or a script, make an access token on the Developer page and see the [command line guide](../developers/cli.md). It runs as `node scripts/egg-cli.mjs` and needs Node 22.18 or newer; the guide says what to do on an older Node.

## Changing the build memory and the Nest username

**Build memory, build CPU and your apps.** The build runs on your Nest container, beside your running app, under a cap. The memory cap is the server's **Build memory (MB)**, 512 MB by default, and never more than the container's memory minus 512 MB. A project with a build step gets at least 1024 MB while it builds, when the container has room for it. The CPU cap is **Build CPU limit (cores)**, 2 by default. You change both per server on that server's **Container** page. Memory can be 512 MB up to the memory the server reports, or up to 8192 MB when it reports none. CPU can be 0.5 cores up to the cores the server reports (2 when it reports none), in steps of 0.25. Servers that still had the old 1024 MB default saved were lowered to 512 MB. A build that goes over its memory cap is stopped with "The build needed more memory than the cap of N MB." and the log says so. A build that wants more CPU than its limit only runs slower. The default memory is set in `web/src/lib/build-memory.ts`, see [customising.md](customising.md).

**Nest username.** This is not an environment variable. You enter it when you connect a server, and it is saved with that server. To change it, disconnect the server and connect it again with the new name, then paste the new public key into the Nest dashboard.

## Backups

Everything Egg stores is in one SQLite file, by default `web/data/egg.db`. That includes users, servers, sealed SSH keys, projects, deployments and logs.

1. Stop Egg. Copying a database while it is being written can give you a broken copy.
2. Copy `web/data/egg.db` to somewhere safe. If files named `egg.db-wal` or `egg.db-shm` sit next to it, copy those too.
3. Copy `web/.env.local` separately. The SSH keys in the database can only be opened with the `APP_SECRET` inside it, so the two belong together. Do not store them in the same place if the backup leaves your machine.

To restore, stop Egg, put the file back at the same path and start Egg again.

If you changed `DATABASE_URL`, back up that path instead.

## Updating

```bash
# stop Egg first, and take a backup (see above)
git pull
pnpm install
pnpm build
pnpm start
```

Database changes are applied automatically the first time the new version opens the database. Going backwards, from a newer database to older code, is not supported, so keep the backup from before the update.

## If something is wrong

| You see | Why | Fix |
| --- | --- | --- |
| "Invalid environment configuration" with `LOCAL_MODE` in it | `LOCAL_MODE=1` but `APP_URL` is not a local address. | Set `APP_URL=http://localhost:3000`, or read the override above. |
| "Invalid environment configuration" with `APP_SECRET` in it | The secret is missing or shorter than 32 characters. | Run `pnpm run setup`, or set a longer one. |
| "Confirm host key" when you press Test connection, and deploys say "Confirm host key: open the Connect page, check the fingerprint of this server and confirm it first." | The first connection to a server waits for you to confirm its fingerprint. | Open the Connect page, press Test connection, then Confirm host key. |
| "The host key of ... changed" | The server presented a different key from the one you confirmed. Egg sent nothing. | If you expected it, press Disconnect, add the server again and confirm the new fingerprint. |
| Deployments stay Queued | No worker is running. | Set `RUN_WORKER=1` and restart, or run `pnpm worker`. |
| A deployment stays Building/Deploying and its job lease is old | The worker stopped renewing its lease. Egg leaves the job blocking because a remote SSH command may continue after its worker disconnects. | Follow **Recovering a stale deployment** below. |
| No "Sign in on this computer" button | `LOCAL_MODE` is not `1` or `true`, or Egg was not restarted after the change. | Edit `.env.local` and restart. |
| "Local sign-in only works from this computer" | You opened Egg through a network address, not localhost. | Open <http://localhost:3000>. |
| "Egg did not start. Fix the lines marked with a cross, then run this again." | The doctor found a problem that stops Egg. | Read the `Fix:` line under each `✗`. `pnpm run doctor` shows the same list. |
| "Port 3000 is already in use" | Another program uses the port in `APP_URL`. | Stop it, or change the port in `APP_URL` in `.env.local`. |

### Recovering a stale deployment

An expired lease is not proof that commands on the Nest server stopped. Egg therefore does not automatically free a stale running job. It remains the project's queue guard until an operator has confirmed the worker and its remote work have stopped.

Stop every Egg worker first. For Compose, stop the app as well because it may run the worker when `RUN_WORKER=1`:

```bash
docker compose stop app worker
docker compose ps
```

Also stop any separately run `pnpm worker` process and workers on other hosts. On the affected Nest server, inspect processes for the Egg SSH command and any child command it launched (such as archive extraction or dependency installation). Do not continue while any could still be changing the project's files or service. If you cannot confirm that, leave the job running and investigate first. Never edit the database while a worker may still own the job.

Back up the database, then list running jobs and their deployment IDs. With the default Compose path:

```bash
sqlite3 "$EGG_DATA_DIR/egg.db" "SELECT id, deployment_id, locked_by, datetime(locked_at / 1000, 'unixepoch') FROM jobs WHERE state = 'running';"
```

If `DATABASE_URL` points elsewhere, use that database file. For the confirmed stale job, replace the two IDs below and apply the updates in one transaction. A canceled deployment stays canceled; other active deployment states are marked as failed so the user can retry.

```bash
sqlite3 "$EGG_DATA_DIR/egg.db" <<'SQL'
BEGIN IMMEDIATE;
UPDATE jobs
SET state = 'failed', locked_by = NULL, locked_at = NULL,
    error = 'Manually recovered after remote work was confirmed stopped'
WHERE id = 'JOB_ID' AND state = 'running';
UPDATE deployments
SET state = 'error',
    error = 'The worker stopped during this job. It was manually recovered after remote work was confirmed stopped.',
    finished_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 'DEPLOYMENT_ID'
  AND state IN ('queued', 'building', 'deploying')
  AND EXISTS (
    SELECT 1 FROM jobs
    WHERE id = 'JOB_ID' AND deployment_id = 'DEPLOYMENT_ID'
      AND state = 'failed'
      AND error = 'Manually recovered after remote work was confirmed stopped'
  );
COMMIT;
SQL
```

Restart Egg after the transaction. If the deployment had already been canceled, its canceled state is retained and only the confirmed stopped job is released.

## Run Egg on your own server

This part runs Egg with Docker Compose on a Linux server. Caddy sits in front of it and gets HTTPS for you.

### What you need

- A Linux server with Docker and Docker Compose.
- A domain whose DNS record points at the server.
- Ports 80 and 443 open in the firewall and at your cloud provider.

### Steps

Run these in the repository root, next to `compose.yaml`.

```bash
git clone https://github.com/jeremy341/egg.git
cd egg
cp deploy/.env.example .env
```

Edit `.env` and set three values:

- `APP_URL`, the public address, starting with `https://`.
- `APP_HOST`, the same name without `https://`. Caddy gets the certificate for it.
- `APP_SECRET`. Make one with `openssl rand -base64 32`, and back it up. Without it the saved keys and variables cannot be read.

Create the data folder and give it to the container user (uid 1000). The path must match `EGG_DATA_DIR` in `.env`:

```bash
sudo mkdir -p /srv/egg/data && sudo chown -R 1000:1000 /srv/egg/data
```

Start it:

```bash
docker compose up -d --build
```

From `web/`, `pnpm run compose:up` does the same. Open your `APP_URL` and sign in with Hack Club (set `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET` in `.env` first). `LOCAL_MODE` does not work on a public address.

### HTTPS and ports

Caddy gets and renews the certificate by itself. It listens on ports 80 and 443, and on 443/udp for HTTP/3. The app is not reachable on any other port, so do not publish the app port yourself.

`TRUST_PROXY=1` is set in the example file because every request comes through Caddy. Never set it if the app can be reached without going through Caddy.

### Builds

Nothing is built on this server. The `worker` service clones each repository, packs the source and sends it to the project's Nest container, where the install and build run under a cap. No service in `compose.yaml` needs the Docker socket or extra privileges. The worker starts with the rest. Without it, deployments stay queued.

### Backup

```bash
sh deploy/backup.sh
```

`pnpm run backup` from `web/` does the same. It makes a consistent copy while Egg runs, gzips it into `backups/` and keeps the newest 14. Set `BACKUP_KEEP` to change the number. For a custom database path, set `EGG_DB` to the actual host file; non-file databases need their own backup process. The copy is useless without `APP_SECRET`, so store the two in different places.

### Upgrade

```bash
sh deploy/upgrade.sh
```

It inspects the running app to find its database and backs it up before pulling, rebuilding and restarting. Start the app first: the upgrade stops if it cannot verify and back up a file database mounted under `/data`. Database changes apply when the app starts.

### Drain and clean up Egg-managed deployments

Settings and Account offer **Clean up and delete account**. Project Settings offers the same operation for one project. Type the displayed name and review the final confirmation to schedule it. No cleanup is scheduled merely by opening the page.

New deployments and remote sessions for the affected resources are paused immediately. Egg waits at least five minutes, then waits for active deployment jobs and tracked SSH sessions to settle. The app process runs this durable queue even when its build worker is disabled. An app restart resumes requests that have not started remote work. A drain can be canceled before its first execution; after remote removal begins it cannot be undone.

The delay is not a load-balancer traffic drain: stopping the application causes downtime, and Egg cannot guarantee that application requests complete. Canceling a scheduled cleanup also does not restart queued deployments it already canceled.

Cleanup checks explicit Egg ownership markers before touching service units or project folders. It stops each verified service and checks that it is inactive before removing units and deployed releases. It preserves `shared/`, your GitHub repositories and anything whose ownership it cannot verify. If a server is unreachable, a service cannot stop, or ownership is uncertain, the project/account records and stored credentials remain available for repair and retry. The status panel shows each target and its error. Repair a failed connection on Connect, then retry; another five-minute drain applies.

An interrupted executor is **not** reclaimed automatically. If the page says its worker did not confirm completion, first stop the old app/worker and verify that its remote cleanup commands and terminal sessions have stopped on the affected Nest server. Only then check the verified-idle confirmation and retry. This manual check is necessary because a disconnected SSH channel cannot prove detached remote processes have stopped.

Before account deletion finishes, save the manual-removal links shown in its confirmation: remove Egg's public key in the Nest dashboard and review the GitHub App installation on GitHub. Those permissions can be shared with other projects or people, and this integration cannot safely revoke them automatically. Database backups can retain old records until the operator expires them.

### Security notes for a server

#### Private vulnerability inbox

Set `SECURITY_REPORT_ADMIN_ID` to the exact Egg database user id of the administrator, then restart the app. The id is returned by `/api/me` while signed in and is also available in the local `users` table. Names and email addresses do not grant access. With this setting empty, the public form refuses submissions and the inbox denies access. The administrator opens `/security/reports`; public visitors submit from `/security#report`.

Reports may be anonymous or include a name and reply address. Egg does not attach the signed-in account or store an IP address with the report. The in-memory limiter uses a hashed trusted client address when available, otherwise a shared client bucket; reverse proxies and hosting logs may independently record request metadata. Anonymous reports have no reply channel. Submitted text and image metadata can still identify a reporter.

Report text, supplied identity, and evidence are sealed with `APP_SECRET` in the database. The inbox accepts up to three PNG/JPEG images of 1 MB and 16 million pixels each; other proof belongs in a Markdown code block. HTML and remote images are not rendered. The inbox holds at most 200 reports and 100 MB of encrypted payloads, and stops accepting reports when full. Submissions have process-local client/global rate limits; operators should also apply request limits at their trusted proxy. The admin may mark reports new, reviewing, or resolved, and permanently delete reports and evidence. Reports stay until deleted; backups have their own retention. Do not open untrusted evidence or execute proof code on a sensitive machine.

#### Instance administration and maintenance

The same exact `SECURITY_REPORT_ADMIN_ID` grants access to `/admin`, which adds an Administration sidebar link to that account. The administrator retains the ordinary project/account tools and can view aggregate account, project, server, queue, cleanup and report counts. The dashboard does not expose other users' SSH keys, environment values, files or terminal output. Changing the configured ID requires an operator restart; names and email addresses are never administrator credentials.

Maintenance can start immediately or use optional start/end times. It is saved in the database and survives app restarts. While active, ordinary browser/API/MCP mutations are refused with `503 maintenance`, and new ordinary deployment jobs stay queued. The configured administrator can keep working. Signed-in people see a notice that refreshes at least every 30 seconds. Sign-in/sign-out, security reports, cancellation, session/token revocation, and recovery of an already-requested cleanup remain available; new cleanup requests are paused. GitHub linking is also paused for ordinary users.

Maintenance is an operational read-only boundary, not a process freeze: requests and deployments already underway may finish, scheduled cleanup and monitoring continue, incoming analytics/report collection remains available, and applications already deployed on Nest keep running. It cannot stop SSH access outside Egg or protect the host during infrastructure changes. Wait for existing jobs and take a verified backup before upgrading. If the settings database cannot be read, mutation requests fail rather than bypassing the maintenance check.

GitHub App webhook events are refused with `503 maintenance` before replay state is recorded, for all repositories including the administrator's. This pauses pushes, pull-request preview creation/removal, repository renames and installation updates. [GitHub does not automatically redeliver failed deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries). After the window, use the App's recent webhook deliveries to redeliver failures; a missed push can alternatively be deployed from Egg. Preview cleanup and integration metadata may remain stale until their events are redelivered. Egg does not persist or automatically replay paused payloads.

- **Request size.** A signed-in JSON request may be up to 256 KB. A larger one is refused with 413.
- **GitHub webhook intake.** The webhook is public, so it is the one route anyone can send bytes to. Egg refuses a delivery without a `Content-Length` (411), one over 5 MB (413), or one whose `X-Hub-Signature-256` is missing or malformed (401), all before reading the body. At most four deliveries are read at once; more get `503` with `Retry-After`, and GitHub's redelivery can retry them. Caddy's stock build has no rate limiting or connection caps. If you want them, set a request rate limit on `/api/webhooks/github` at your firewall or cloud load balancer. Egg does not need it for memory safety.
- **Rate limits.** One address may make 20 sign-in attempts a minute, and 60 requests a minute with access tokens that are not recognised. These limits count by address, so they only work when `TRUST_PROXY=1` behind a proxy. The example file sets it. They are kept in memory, so a restart clears them.
- **Content policy.** The `script-src` rule still allows inline scripts, so a script injected into a page would not be blocked by it. A per-request nonce would close this, but it is not in place yet. The fix is open. The rules against framing, plug-ins and form hijacking are not affected.
