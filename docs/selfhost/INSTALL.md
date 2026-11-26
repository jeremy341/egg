# Install Egg on your own machine

Egg runs on a laptop, on a Linux server you own, or under Docker Compose. You do not need a Hack Club account. This guide installs the Egg machine and sets up local sign-in. It stops before you connect a deploy target.

Commands run from `web/` unless a step says otherwise. The Docker steps run from the repository root, next to `compose.yaml`.

## Choose a layout

| Layout | Use it when | Sign-in | Start with |
| --- | --- | --- | --- |
| **Local laptop** | One person, private, on a computer you carry. No Docker. | Local password. No outside account. | `pnpm egg start` |
| **Own Linux server** | You have a Linux box and will run Egg as a user service behind your own reverse proxy. | Local mode behind your own access control, or Hack Club. | `pnpm egg start`, then `pnpm run service:install` |
| **Docker Compose** | You want the app, the worker and Caddy in one stack, with HTTPS obtained for you. | Hack Club, or local mode behind your own access control. | `docker compose up -d --build` |

All three layouts need a deploy target before you can deploy a real app. That target is a Hack Club Nest container or a Linux server you own. Egg clones and packs the source on the Egg machine. The install and build run on the target. See [the self-hosting guide](README.md) for the full list of target requirements.

## Prerequisites

| Check | Exact requirement | Verify with |
| --- | --- | --- |
| Node.js | 22.13.0 or newer. The doctor requires `>=22.13.0`. Next.js 16 alone would run on Node 20.9, but the pinned pnpm does not. | `node -v` |
| pnpm | 11.20.0. The repo pins `pnpm@11.20.0` in `web/package.json`. Corepack enables it. | `pnpm --version` |
| Git | Any current version. The worker runs `git clone` on the Egg machine. The doctor does not check for Git. | `git --version` |
| Free disk on the deploy target | At least 2048 MB. Egg keeps releases for rollback, and refuses a deploy below this. | `df -m ~/.egg` on the target |
| Free disk on the Egg machine | Room for one clone plus a packed source of at most 500 MiB per deployment that runs at once. Under Compose the `egg_work` tmpfs volume is capped at 1 GiB by default. | `df -h`, or `EGG_WORK_SIZE` under Compose |
| Website port | 3000 [default], free on 127.0.0.1. Use a port above 1024. | `pnpm run doctor` |
| Stand-in port | 2222 [default], only if you run `pnpm fake-nest`. | `pnpm fake-nest` prints it at start |
| Server ports | 80 and 443, plus 443/udp for HTTP/3, open at the firewall and your cloud provider. Only Caddy publishes them. | `docker compose ps` after start |
| SSH port | 22 [default] outbound to the deploy target. `NEST_PORT` sets it for servers you add next. | `nc -vz <host> 22` |
| App ports on the target | 1024 to 65535, excluding 20000 to 29999. Egg reserves that band for previews. | Choose the port in project settings |

You do not need Docker for the laptop or Linux-server layout. The Egg machine never installs or builds your app.

**Caution.** pnpm 11.20.0 refuses to run on Node older than 22.13, so `pnpm install` fails before the doctor can help.

## Install

1. **Get the code.** The clone folder is `egg` [default].

   ```bash
   git clone https://github.com/jeremy341/egg.git
   cd egg/web
   ```

2. **Install dependencies.** Use the version pinned in `web/package.json` [pnpm@11.20.0].

   ```bash
   pnpm install
   ```

3. **Create the settings file.**

   ```bash
   pnpm run setup
   ```

   Type `pnpm run setup`, not `pnpm setup`. The script writes `web/.env.local` with a fresh `APP_SECRET` of 32 or more characters, a separate `LOCAL_MODE_SECRET` recovery key, `APP_URL=http://localhost:3000` [default], `DATABASE_URL=file:./data/egg.db` [default], `LOCAL_MODE=1` [default], `DEV_LOGIN=0` [default], `RUN_WORKER=1` [default] and empty Hack Club and GitHub values [default]. It never overwrites an existing file. Keep `.env.local` private.

   **Caution.** `pnpm setup` runs pnpm's own command and leaves `.env.local` missing.

4. **Check the machine.**

   ```bash
   pnpm run doctor
   ```

   The doctor checks Node.js, pnpm, `.env.local` and `APP_SECRET`, the port, the data folder, sign-in, the proxy setting, the operating system and the database setting. A cross (`✗`) stops Egg. A warning (`!`) does not. The command exits 1 on a cross. It does not check Git, the network or the deploy target.

   **Caution.** A warning does not stop the start, so Egg can begin without the tool the warning names.

5. **Start Egg.** Pick the command for your layout.

   ```bash
   # Local laptop and own Linux server
   pnpm egg start

   # Development server: reloads on edits, skips the build
   pnpm egg start --dev

   # Docker Compose, from the repository root
   cp deploy/.env.example .env
   sudo mkdir -p /srv/egg/data && sudo chown -R 1000:1000 /srv/egg/data
   docker compose up -d --build
   ```

   `pnpm egg start` creates `.env.local` if it is missing, runs the doctor, builds once when `.next/BUILD_ID` is missing, starts on the port in `APP_URL` [3000], and opens your browser. A local `APP_URL` binds to 127.0.0.1, so other computers cannot reach it. Press Ctrl+C to stop.

   Under Compose, edit `.env` before you start. Set `APP_URL` to your public `https://` address, set `APP_HOST` to the same name without `https://`, and set `APP_SECRET` to a value from `openssl rand -base64 32`. The data path is `/srv/egg/data` [default] and must match `EGG_DATA_DIR`. Caddy gets the certificate for `APP_HOST`.

   **Caution.** Without `APP_SECRET`, the saved SSH keys and variables in the database cannot be read.

6. **Register the service on a Linux server.** Skip this step for the other layouts.

   ```bash
   pnpm egg start          # run once so a build exists, then Ctrl+C
   pnpm run service:install
   ```

   This writes `~/.config/systemd/user/egg.service` on Linux and prints the enable command [systemctl --user enable --now egg]. Nothing starts until you run that command. `loginctl enable-linger` starts Egg at boot without you signing in. `pnpm run service:remove` stops the service and deletes the file.

7. **Sign in.** Open `http://localhost:3000/login` [default `APP_URL`]. The first form asks for the **Recovery key from private `.env.local`** and a password of 12 to 256 bytes. Paste `LOCAL_MODE_SECRET` and choose a password. You land on Projects as Owner. Later visits ask only for the local password.

   **Caution.** Anyone who reads `LOCAL_MODE_SECRET` can set or reset the local password.

## Review before you continue

Read each line. Fix every cross. Do not continue until every statement holds.

1. `pnpm run doctor` prints no `✗` line. Under Compose, `docker compose ps` shows `app`, `worker` and `caddy` running.
2. `APP_SECRET` has 32 or more characters. `LOCAL_MODE_SECRET` has 32 or more characters when `LOCAL_MODE=1`.
3. `APP_URL` matches the address in your browser [http://localhost:3000]. Its port is the one you started on [3000].
4. `RUN_WORKER=1` runs the queue in the web process [1]. With Compose, the separate `worker` service runs it [default].
5. On a public server, DNS points at the box, `APP_HOST` matches `APP_URL`, and ports 80 and 443 are open. Set `TRUST_PROXY=1` only when every request reaches Egg through Caddy [1 under Compose].
6. You use one sign-in method. With local mode, leave `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET` empty [default].
7. You have stored `.env.local` or `.env` and the database in separate, private places.

Then confirm the deploy target on the Projects page. Install the public key Egg shows on the target. Press **Test connection**, compare the fingerprint with the target's own host key, then press **Confirm host key**.

**Caution.** Setting both local mode and Hack Club gives every person with a Hack Club account who can open the site their own account.

**Caution.** Confirming an unchecked fingerprint can hand your SSH key to whoever is intercepting the connection.

## Flags and environment variables

### Command flags

| Command or flag | Default | What it does |
| --- | --- | --- |
| `pnpm run setup` | — | Write `.env.local` once. Leave an existing file alone. |
| `pnpm egg start` | — | Set up if needed, run the doctor, build if missing, start and open the browser. |
| `pnpm egg start --dev` | off | Run the dev server. Reload on edits and skip the build. |
| `pnpm egg doctor` | — | Print the checks only. Exit 1 on a cross. |
| `pnpm run service:install` | — | Write the start-on-login service and print the enable command. |
| `pnpm run service:remove` | — | Stop the service and delete its file. |
| `pnpm worker` | — | Run the queue on its own when `RUN_WORKER` is not 1. |
| `pnpm fake-nest` | port 2222 | Start the stand-in server for trials. Never use it for real apps. |
| `egg --token <token>` | `EGG_TOKEN` | Authenticate a CLI call. |
| `egg --url <url>` | `EGG_URL` | Set the Egg address for a CLI call. |
| `egg --json`, `egg --show-secrets`, `egg --help` | off | Control CLI output. |

### Environment variables

On/off values must be exactly `0`, `1`, `true` or `false` in lower case. Put these in `web/.env.local` for the laptop and Linux layouts, or in `.env` next to `compose.yaml` for Compose.

| Variable | Default | What it sets |
| --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | Site address. Used for redirects, callbacks, hook URLs and the same-origin check. |
| `APP_SECRET` | generated by setup | 32 or more characters. Encrypts SSH keys and variables. |
| `DATABASE_URL` | `file:./data/egg.db` | The SQLite file. Under Compose it is `file:/data/egg.db`. |
| `LOCAL_MODE` | `0`, `1` from setup | Turn on the single local owner. |
| `LOCAL_MODE_SECRET` | generated by setup | 32 or more characters. The first-sign-in and reset key. |
| `LOCAL_MODE_ALLOW_REMOTE` | `0` | Let local mode run on a public `APP_URL`. Use it only behind your own access control. |
| `HACKCLUB_CLIENT_ID`, `HACKCLUB_CLIENT_SECRET` | empty | Hack Club sign-in. Both must be set. |
| `DEV_LOGIN` | `0` | Development sign-in. Works only with `pnpm dev`. |
| `TRUST_PROXY` | `0`, `1` under Compose | Trust `X-Forwarded-For` and `X-Real-IP` from your own proxy. |
| `APP_HOST` | none | The name Caddy gets a certificate for. Read by Compose. |
| `EGG_DATA_DIR` | none | Host folder for the database and clones. Read by Compose. |
| `RUN_WORKER` | `1` from setup, `0` in the Compose app | Run the queue inside the web process. |
| `DEPLOY_WORK_DIR` | `./data/work`, `/data/work` under Compose | Where sources are cloned and packed. |
| `NEST_HOST` | `hackclub.app` | SSH host for servers you add next. |
| `NEST_PORT` | `22` | SSH port for servers you add next. |
| `UNIT_DIR` | `/etc/systemd/system` | Service units on the target. Change it only for `fake-nest`. |
| `GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | empty | The GitHub App. All five must be set for private repos, push deploys and previews. |
| `GITHUB_APP_SLUG` | empty | Supplies the App install link. |
| `PORT` | `3000` | Port `pnpm start` listens on. Keep `APP_URL` in step. |
| `FAKE_NEST_PORT` | `2222` | Port `pnpm fake-nest` listens on. |
| `WORKER_CONCURRENCY` | `2` | Deployments that run at once. |
| `MONITOR_INTERVAL_MS` | `300000` | Uptime check interval in milliseconds. `0` turns it off. |
| `EGG_SERVICE_MEMORY`, `EGG_SERVICE_CPUS`, `EGG_SERVICE_PIDS` | `1g`, `1.0`, `512` | Ceilings for the app and worker containers. |
| `EGG_CADDY_MEMORY`, `EGG_CADDY_CPUS` | `256m`, `0.5` | Ceilings for Caddy. |
| `EGG_WORK_SIZE` | `size=1g,uid=1000,gid=1000` | Quota on the clone scratch volume. |
| `SECURITY_REPORT_ADMIN_ID` | empty | Exact user id for `/admin` and the private report inbox. |

**Caution.** Setting `TRUST_PROXY=1` without a proxy in front lets a visitor choose their own address.

## What this setup configures

- The settings file with generated secrets and the defaults above.
- The SQLite database at `web/data/egg.db`, or at `/data/egg.db` under Compose.
- Local sign-in with one account, called Owner.
- The web app and the deployment queue. Local runs combine them with `RUN_WORKER=1`; Compose runs a separate `worker` service.
- Loopback binding for a local `APP_URL`: 127.0.0.1.
- A start-on-login service, only when you run `pnpm run service:install`.
- Caddy with automatic HTTPS for `APP_HOST`, only in the Compose layout.

## What this setup does not configure

- A deploy target. Add one on the Projects page and install the public key on the target.
- Host-key confirmation. You press **Test connection** and **Confirm host key** yourself.
- A reverse proxy, certificate or firewall rule for apps on a server you own. Each app listens on `0.0.0.0` on its port.
- DNS records for your apps. The Domains page still follows Nest's rules.
- The GitHub App. Private repositories, push deploys and pull request previews need it.
- Hack Club sign-in, or more than one account without it.
- Email delivery, alert channels or automatic backups on a local install.
- Any build of your app on the Egg machine. Builds run on the deploy target.
- Docker on your computer for the laptop or Linux-server layout.

**Caution.** An app on your own server stays open on plain HTTP until you put a proxy in front and block its port.

## Re-running and upgrading

`pnpm run setup` is safe to re-run. It prints a message and leaves an existing `.env.local` untouched. If an older file lacks `LOCAL_MODE=1` or a `LOCAL_MODE_SECRET`, add them by hand. Generate a key with `openssl rand -base64 32`.

`pnpm egg start` re-runs the doctor each time. It builds again only when `.next/BUILD_ID` is missing. After a port change, update `APP_URL` and run `pnpm run service:install` again so the service file has the new port.

To upgrade a local or Linux install, stop Egg, take a backup, then run:

```bash
git pull
pnpm install
pnpm build
pnpm egg start
```

Copy `web/data/egg.db` and any `egg.db-wal` or `egg.db-shm` files beside it. Copy `.env.local` separately. Migrations run the first time the new version opens the database.

Under Compose, start the app first, then run `sh deploy/upgrade.sh`. It finds the database, backs it up, and then pulls, rebuilds and restarts. `sh deploy/backup.sh` makes a consistent copy while Egg runs, gzips it into `backups/` and keeps the newest 14 [BACKUP_KEEP].

**Caution.** Downgrading a migrated database to older code is not supported, so keep the backup from before the upgrade.

## Uninstall

1. Stop the app. Press Ctrl+C for a local install. Run `docker compose down` from the repository root for Compose.
2. Run `pnpm run service:remove` if you installed the start-on-login service.
3. Save copies of the database and `.env.local` or `.env` if you may return. The next step removes them.
4. Delete the checkout folder. This removes `.env.local`, `web/data/egg.db`, the build and the Compose files.
5. Under Compose, add `-v` to remove the `egg_work`, `caddy_data` and `caddy_config` volumes as well.
6. In Egg, open Settings and use **Clean up and delete account** before you delete the checkout. It removes only services and releases that carry Egg's ownership marker, and it preserves `shared/`.
7. On the deploy target, remove Egg's public key from `authorized_keys` or the Nest SSH Keys page. Review the GitHub App installation on GitHub. Revoke any personal access tokens you made.

**Caution.** `docker compose down -v` deletes the database and Caddy's certificates, so a later start requests new certificates.

**Caution.** Uninstalling Egg does not remove its public key from your deploy targets.

## Related resources

- [Run your own](/docs/selfhost) - The full guide to sign-in, deploy targets, the GitHub App, backups and every setting.
- [Run Egg yourself](/docs/run-yourself) - Pick a setup and a sign-in method before you install.
- [Run Egg locally](/docs/run-locally) - Work on the code: dev server, env file, demo data and tests.
- [Troubleshooting](/docs/troubleshooting) - Fix port, sign-in, build and webhook failures.
- [Build with GitHub Actions](/docs/build-github-actions) - Let GitHub build your app and send Egg a finished release.
