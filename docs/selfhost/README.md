# Run Egg on your own computer or server

This guide has two parts. The first gets Egg running privately on your own computer, with no Hack Club account and nothing sent to anyone else. You sign in with one button, and your data stays in one file on your disk. The second, [Run Egg on your own server](#run-egg-on-your-own-server), uses Docker Compose on a Linux server with a domain and automatic HTTPS.

To change the name, colours, ports or build memory, see [customising.md](customising.md).

## What works where

| System | Support |
| --- | --- |
| Windows | Full. `pnpm fake-nest` needs WSL (see "Trying everything on one machine"). |
| Linux | Full. |
| macOS | The same as Linux. Builds need Docker Desktop, or `BUILD_RUNNER=local`. |

The CI workflow runs the typecheck, lint, tests and the dependency audit on Linux and macOS. The audit fails the Linux run on a high-severity finding. On macOS it only reports it.

## What you need

- **Node.js 22.13 or newer.** The repo pins `pnpm@11.20.0`, and that pnpm needs Node 22.13. (Next.js 16 alone would run on Node 20.9.) Check with `node -v`.
- **pnpm.** Run `corepack enable`, or install it with `npm install -g pnpm`. On Windows, run either in a terminal opened as administrator if it reports a permission error.
- **Git.**
- **Docker**, if you want builds to run in a sandbox. This is the default. You can skip it by setting `BUILD_RUNNER=local` (see "Where builds run").
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

Type `pnpm run setup`, not `pnpm setup`. pnpm has a built-in command called `setup` that does something else. This writes `web/.env.local` with a fresh random `APP_SECRET` and `LOCAL_MODE=1`. It never overwrites a file that already exists. If your file is older and has no `LOCAL_MODE=1` line, add it.

`LOCAL_MODE=1` is the only switch you need for a private, local install. It lets you sign in on this computer without an outside account. Leave `APP_URL=http://localhost:3000` as it is.

You can skip this step. `pnpm egg start` runs setup for you when `.env.local` is missing.

The setup script also writes `DEV_LOGIN=1`. That switch only works with `pnpm dev` and is ignored in a production build. It is harmless to leave, and you can set it to `0`.

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

Press **Sign in on this computer**. You land on the Projects page as the local owner. Press Ctrl+C to stop Egg.

`pnpm egg start --dev` runs the development server instead. It reloads while you edit code and skips the build.

If you prefer separate steps, `pnpm build` and then `pnpm start` do the same without the checks. Open <http://localhost:3000/login>.

Your data is one file, `web/data/egg.db`. It stays on disk when Egg stops. Back it up together with `APP_SECRET` (see "Backups").

The deployment worker runs inside the web process (`RUN_WORKER=1`, which the setup script writes), so one command starts everything. If you set `RUN_WORKER` to anything else, run `pnpm worker` in a second terminal, or deployments stay queued.

## The doctor

```bash
pnpm run doctor
```

This only checks the computer. It starts nothing. Each check prints one line, and a problem has a `Fix:` line under it.

- A cross (`✗`) stops Egg from starting. `pnpm egg start` runs the same checks and stops on a cross. Examples: Node.js too old, `APP_SECRET` missing or too short, the port already in use, a data folder Egg cannot write to.
- A warning (`!`) does not stop anything. A common one is "Docker is not running". Builds need Docker, or `BUILD_RUNNER=local` in `.env.local`. Egg itself starts without it.

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

`LOCAL_MODE=1` adds one button to the sign-in page. It signs you in as a single owner called "Owner", with no external account.

- **It is off by default.** Nothing turns it on except you setting `LOCAL_MODE=1`.
- **It refuses to run on a public address.** If `APP_URL` is not `localhost`, `127.0.0.1` or `[::1]`, Egg stops with an error that names the problem. Anyone who could reach a public address could otherwise sign in as you.
- **It checks each request too.** The server can listen on every network interface even when `APP_URL` says localhost. The sign-in button works only for requests that arrive on a local address, so someone else on your network cannot use it.
- **The explicit override.** If you really do host it elsewhere, behind a VPN or an access proxy you control, also set `LOCAL_MODE_ALLOW_REMOTE=1`. Only do this when something else decides who can reach the site.
- **It skips the Hack Club confirmation.** Turning on the terminal or file changes normally asks you to confirm with Hack Club again. In local mode there is no Hack Club account, so that step is skipped.

You can still set the Hack Club variables later and use both sign-in methods side by side.

## Permission switches are off by default

Each connected server has three switches on its Container page: **Terminal**, **File changes** and **Removing leftovers**. All three start off for every new server, and local mode does not change that. Nothing is pre-enabled for you. The terminal is a root shell on the container, so turn it on only when you need it. Turning a switch on asks you to type the server name.

## Connecting a server

Egg deploys by SSH. A key made just for one server is stored sealed in your database.

1. On the Projects page, choose to connect a server and enter your Nest username, the name you log in with, for example `sam-r`.
2. Egg shows you a public key. Paste it into the SSH Keys page of the Nest dashboard.
3. Press **Test connection**. The first time, Egg reaches the host, reads its host key, hangs up and shows the fingerprint under **Confirm host key**. Nothing is sent to the server until you check the fingerprint against the one Nest shows for your server and press **Confirm host key**. Egg then pins that key, refuses any other one, and checks the container.

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

| `BUILD_RUNNER` | What happens | When to use it |
| --- | --- | --- |
| `docker` (default) | Install and build run in a Docker container with memory, CPU and capability limits. | Anything you did not write yourself. |
| `local` | Install and build run directly on this machine, with no isolation. | You trust the code and Docker is not installed. The worker prints a warning at start. |

Builds happen on the machine running Egg, never on your Nest container. Builds have normal network access, because installing packages needs it.

## Settings, one by one

Every name in the first table is read in `web/src/server/config.ts`. Put them in `web/.env.local`.

| Variable | Default | What it does |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | The address of the site. Used for redirects and the same-origin check on writes. Must match the address in your browser. |
| `APP_SECRET` | none, required | 32 or more characters. Encrypts SSH keys and environment variables. Back it up. Losing it, or changing it, makes every stored key unreadable. |
| `DATABASE_URL` | `file:./data/egg.db` | The database. A path starting with `file:` is relative to `web/`. |
| `LOCAL_MODE` | `0` | `1` or `true` turns on the local sign-in button. See "What local mode does". |
| `LOCAL_MODE_ALLOW_REMOTE` | `0` | `1` lets `LOCAL_MODE` run when `APP_URL` is not local. Does nothing when `LOCAL_MODE` is off. |
| `TRUST_PROXY` | `0` | `1` or `true` makes Egg believe the `X-Forwarded-For` and `X-Real-IP` headers for each visitor's address. Set it to `1` only when every request reaches Egg through a reverse proxy you run, which sets those headers itself. Without it every visitor counts as one address: analytics cannot tell visitors apart by address, and the limits on sign-in attempts and invalid access tokens do not apply. On your own computer, leave it off. |
| `DEV_LOGIN` | `0` | `1` shows a fake sign-in with a name field. Works only with `pnpm dev`. |
| `HACKCLUB_CLIENT_ID`, `HACKCLUB_CLIENT_SECRET` | empty | Hack Club Auth app credentials. Needed only if you want Hack Club sign-in. |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | empty | A GitHub App, for private repositories, the repository picker and deploy on push. Set them together. Public repositories deploy by URL without it. Setup is in [backend-setup.md](../backend-setup.md). |
| `BUILD_RUNNER` | `docker` | `docker` or `local`. See "Where builds run". |
| `BUILD_IMAGE_NODE` | `node:22-bookworm` | Docker image for Node builds. |
| `BUILD_IMAGE_PYTHON` | `python:3.12-bookworm` | Docker image for Python builds. |
| `BUILD_TIMEOUT_SECONDS` | `900` | A build that runs longer than this is stopped. |
| `DEPLOY_WORK_DIR` | `./data/work` | Where sources are cloned and built, relative to `web/`. |
| `UNIT_DIR` | `/etc/systemd/system` | Where service files are written on the container. Change only with `fake-nest`. |
| `NEST_HOST` | `hackclub.app` | The SSH host. Change only with `fake-nest`. |
| `NEST_PORT` | `22` | The SSH port. Change only with `fake-nest`. |

These are read elsewhere in the code, not in `config.ts`:

| Variable | Default | What it does | Read in |
| --- | --- | --- | --- |
| `RUN_WORKER` | unset in the code, `1` from the setup script | `1` runs the deployment queue inside the web process. Anything else means run `pnpm worker` yourself. | `web/src/instrumentation.ts` |
| `WORKER_CONCURRENCY` | `2` | How many deployments run at once. One project never builds twice at the same time. | `web/src/instrumentation.ts`, `web/worker/index.ts` |
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

**Build memory and your apps.** Builds run on the machine that runs Egg, not on your Nest container, so they never use your container’s memory. If Egg shares a machine with your other apps, a build uses that machine’s memory and CPU while it runs, so lower the build memory or run Egg on its own machine. Builds in the Docker sandbox get 2048 MB by default. You change it per server on that server's **Container** page. The allowed range is 512 MB up to the memory the server reports, or up to 8192 MB when it reports none. A build that runs out of memory fails with exit code 137 and says so in its log. The default itself is set in `web/src/lib/build-memory.ts`, see [customising.md](customising.md). `BUILD_RUNNER=local` has no memory limit.

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
| No "Sign in on this computer" button | `LOCAL_MODE` is not `1` or `true`, or Egg was not restarted after the change. | Edit `.env.local` and restart. |
| "Local sign-in only works from this computer" | You opened Egg through a network address, not localhost. | Open <http://localhost:3000>. |
| A build fails at once with a Docker error | Docker is not running or not installed. | Start Docker, or set `BUILD_RUNNER=local`. |
| "Egg did not start. Fix the lines marked with a cross, then run this again." | The doctor found a problem that stops Egg. | Read the `Fix:` line under each `✗`. `pnpm run doctor` shows the same list. |
| "Port 3000 is already in use" | Another program uses the port in `APP_URL`. | Stop it, or change the port in `APP_URL` in `.env.local`. |
| "Docker is not running. Builds need Docker, or BUILD_RUNNER=local" | A warning, not a stop. Egg starts, but a build fails. | Start Docker, or set `BUILD_RUNNER=local` in `.env.local`. |

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
sudo mkdir -p /srv/egg/data/work && sudo chown -R 1000:1000 /srv/egg/data
```

Start it:

```bash
docker compose up -d --build
```

From `web/`, `pnpm run compose:up` does the same. Open your `APP_URL` and sign in with Hack Club (set `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET` in `.env` first). `LOCAL_MODE` does not work on a public address.

### HTTPS and ports

Caddy gets and renews the certificate by itself. It listens on ports 80 and 443, and on 443/udp for HTTP/3. The app is not reachable on any other port, so do not publish the app port yourself.

`TRUST_PROXY=1` is set in the example file because every request comes through Caddy. Never set it if the app can be reached without going through Caddy.

### Builds (read this)

The worker runs project builds in Docker, so it mounts the Docker socket. Anyone who can run code in the worker can control Docker, which is root on the server.

The worker is off in the example file. `COMPOSE_PROFILES=builds` is commented out. Turn it on only if you accept the risk above, by removing the `#` from that line. Without it, deployments stay queued.

When you turn it on, set `DOCKER_GID` to the group that owns the socket:

```bash
stat -c %g /var/run/docker.sock
```

### Backup

```bash
sh deploy/backup.sh
```

`pnpm run backup` from `web/` does the same. It makes a consistent copy while Egg runs, gzips it into `backups/` and keeps the newest 14. Set `BACKUP_KEEP` to change the number. The copy is useless without `APP_SECRET`, so store the two in different places.

### Upgrade

```bash
sh deploy/upgrade.sh
```

It backs up first (a failed backup stops the upgrade), pulls, rebuilds and restarts. Database changes apply when the app starts.

### Security notes for a server

- **Request size.** A signed-in JSON request may be up to 256 KB. A larger one is refused with 413.
- **Rate limits.** One address may make 20 sign-in attempts a minute, and 60 requests a minute with access tokens that are not recognised. These limits count by address, so they only work when `TRUST_PROXY=1` behind a proxy. The example file sets it. They are kept in memory, so a restart clears them.
- **Content policy.** The `script-src` rule still allows inline scripts, so a script injected into a page would not be blocked by it. A per-request nonce would close this, but it is not in place yet. The fix is open. The rules against framing, plug-ins and form hijacking are not affected.
- **The Docker socket.** See "Builds" above.
