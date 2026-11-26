# Troubleshooting local and self-hosted Egg

This guide is for the two ways to run Egg yourself: on your own computer (setup A, `pnpm egg start`) and on your own server with Docker Compose (setup B).

Each entry gives the **symptom** you see, the **cause**, an **exact fix command**, and a **caution** with one consequence of getting it wrong. Find your symptom, read the cause, run the command, then restart Egg.

Back to the [self-hosting guide](README.md). For ports, colours, names and build limits, see [customising.md](customising.md).

Before you start, run the doctor from `web/`. It prints one line per check and a `Fix:` line under each failure:

```bash
cd web
pnpm run doctor
```

A cross (`✗`) stops Egg; a warning (`!`) does not. The commands below run from `web/` unless an entry says otherwise. The Docker and `deploy/` commands run from the repository root, next to `compose.yaml`.

## 1. Port conflicts

**Symptom.** `pnpm egg start` stops with `Port 3000 is already in use`, or the doctor prints `✗ Port: Port 3000 is already in use`. A second Egg started with `pnpm start`, or `pnpm fake-nest` on its port 2222, can be the other program. A port below 1024 gives `Not allowed to listen on port N` instead.

**Cause.** Another program already listens on the port in `APP_URL`: a second Egg, a stale `pnpm start`, `fake-nest`, or an unrelated service. The doctor tries to bind that port and reports the conflict before Egg starts. `Not allowed to listen on port N` means the port is below 1024 and needs root, which Egg does not use.

**Fix.** Find the process holding the port and stop it:

```bash
# Linux / macOS
lsof -nP -iTCP:3000 -sTCP:LISTEN
kill <PID>
```

```powershell
# Windows PowerShell
Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess
Stop-Process -Id <PID> -Force
```

Or give Egg a free port by editing `web/.env.local`, setting `APP_URL=http://localhost:4000`, then starting again:

```bash
cd web && pnpm egg start
```

`APP_URL` must match the port you listen on, or sign-in redirects and writes fail.

**Caution.** Killing a process you did not identify can take down an unrelated service, so check the command name from `lsof` or `Get-Process -Id <PID>` before you stop it.

## 2. `pnpm setup` collision

**Symptom.** You ran `pnpm setup`, it printed pnpm's own setup output, and no `web/.env.local` was created. Egg then stops with `.env.local is missing`, `APP_SECRET is not set in .env.local`, or `Invalid environment configuration:` followed by `APP_SECRET: Invalid input: expected string, received undefined`.

**Cause.** `setup` is a built-in pnpm command that configures pnpm's own shell and binary directory. Egg's setup is the package script `setup`, which is only run through `pnpm run setup`. The built-in wins when you omit `run`, so the file with `APP_SECRET`, `LOCAL_MODE_SECRET` and `LOCAL_MODE=1` is never written.

**Fix.** Run the package script and start Egg:

```bash
cd web && pnpm run setup && pnpm egg start
```

`pnpm run setup` never overwrites an existing `.env.local`. If the file is already there but is missing a secret, see entry 5.

**Caution.** Running the wrong command still changes pnpm's global shell configuration (it adds pnpm's bin directory to your PATH), so your shell setup is modified even though Egg is no closer to starting.

## 3. Local mode mixed with Hack Club

**Symptom.** The login page shows both the local form and a **Continue with Hack Club** button. The local owner cannot turn on Terminal or File changes, and the Account address ends in `?reauth=mismatch`. People with a Hack Club account who can open the site get their own accounts.

**Cause.** You set `LOCAL_MODE=1` and also filled in `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET`. With both set, Egg has two kinds of account. A Hack Club account is not the local owner (`local:owner`), so it cannot confirm the local owner's fresh sign-in, and anyone with a Hack Club account can sign up just by opening the site.

**Fix.** Pick one method. For a private single-owner instance, empty both Hack Club values in `web/.env.local` and restart:

```bash
cd web
sed -i 's/^HACKCLUB_CLIENT_ID=.*/HACKCLUB_CLIENT_ID=/; s/^HACKCLUB_CLIENT_SECRET=.*/HACKCLUB_CLIENT_SECRET=/' .env.local
pnpm egg start
```

On macOS use `sed -i ''` instead of `sed -i`. Leave `LOCAL_MODE=1` and `LOCAL_MODE_SECRET` intact. Restart, sign in as Owner, and the switches work again. If you keep Hack Club instead, remove `LOCAL_MODE=1` and use a Hack Club account.

**Caution.** Leaving both configured gives your instance open sign-up to anyone with a Hack Club account who can reach the address.

## 4. Reauth mismatch (`?reauth=mismatch`)

**Symptom.** Turning on **Terminal** or **File changes** for a server, or turning on password sign-in, returns you to Account with `?reauth=mismatch` in the address. The page shows no message and the switch stays off. The same switch may instead say `Confirm with Hack Club first. Turning this on needs a sign-in in the last 5 minutes.`

**Cause.** These changes need a fresh sign-in (within `REAUTH_WINDOW_MS`, five minutes). With both local mode and Hack Club set up, Egg sends the local owner to Hack Club, and Hack Club cannot confirm a `local:owner` account. With neither set up, Egg returns `?reauth=not_configured`. The result is the same whether or not a message is shown.

**Fix.** Remove the sign-in method you are not using, exactly as in entry 3, and restart:

```bash
cd web
sed -i 's/^HACKCLUB_CLIENT_ID=.*/HACKCLUB_CLIENT_ID=/; s/^HACKCLUB_CLIENT_SECRET=.*/HACKCLUB_CLIENT_SECRET=/' .env.local
pnpm egg start
```

Then sign in again as Owner and turn the switch on within five minutes. On a Hack Club-only instance, sign in with the **same** Hack Club account and retry.

**Caution.** Repeatedly retrying the switch while both methods are configured cannot succeed, because a Hack Club sign-in can never confirm the separate local owner account.

## 5. Missing `APP_SECRET` or `LOCAL_MODE_SECRET`

**Symptom.** Egg stops at startup with `Invalid environment configuration:` followed by `APP_SECRET: Invalid input: expected string, received undefined`, `APP_SECRET must be at least 32 characters`, `LOCAL_MODE_SECRET: LOCAL_MODE requires a private LOCAL_MODE_SECRET.`, or `LOCAL_MODE_SECRET must be at least 32 characters`. The doctor prints `✗ Settings file: APP_SECRET is not set in .env.local` or says the secret is too short. The first local sign-in also rejects a recovery key that does not match.

**Cause.** `APP_SECRET` and `LOCAL_MODE_SECRET` are written only by `pnpm run setup`, which never overwrites an existing file. They are missing when the file was created by hand, copied without them, or predates local mode; they are too short when someone trimmed or replaced them. `LOCAL_MODE=1` refuses to start without a `LOCAL_MODE_SECRET` of at least 32 characters.

**Fix.** If `.env.local` is missing, let setup create a fresh one:

```bash
cd web && pnpm run setup && pnpm egg start
```

If the file exists, generate two new values and put them in `web/.env.local` as `APP_SECRET=<value>` and `LOCAL_MODE_SECRET=<value>`:

```bash
openssl rand -base64 32
```

**Caution.** Changing `APP_SECRET` makes every SSH key and environment value already stored in the database unreadable, so back up the old secret and the database together before you replace it.

## 6. Database migration failures

**Symptom.** Egg does not become healthy, and the logs show a migration error such as `table ... already exists`, `duplicate column name`, `SQLITE_BUSY` or `SQLITE_LOCKED`, or `The database did not open with foreign key checks and its busy timeout enabled.` On a server, `sh deploy/upgrade.sh` stops with `Cannot automatically back up the configured DATABASE_URL` or `Cannot identify the app's /data mount` before it upgrades.

**Cause.** Migrations run automatically the first time a new version opens the database. They fail when the app and worker race to run them at the same time, when the database file is read-only or locked, or when a newer database is opened by older code. `upgrade.sh` refuses to continue when it cannot identify and back up a file database under `/data`. Going backwards from a newer database to older code is not supported.

**Fix.** Stop everything, take a backup, then start the app before the worker so only one process runs migrations:

```bash
docker compose stop app worker
sh deploy/backup.sh
docker compose up -d --build
docker compose ps
```

`compose.yaml` already makes the worker wait for a healthy app, so a normal `up` keeps one migration writer. For a local install, stop Egg with Ctrl+C, copy `web/data/egg.db` (plus any `egg.db-wal` and `egg.db-shm` files) somewhere safe, then `pnpm egg start`.

**Caution.** Restoring an old backup over a database that a newer version has already migrated can lose the newer rows, so keep the backup from before the upgrade and do not run older code against a newer database.

## 7. Docker permissions

**Symptom.** The app or worker container exits with `EACCES`, the doctor inside the container reports a folder that `cannot be created` or `is not writable`, or `sh deploy/upgrade.sh` says `Database at ... is not readable by this user`. The app healthcheck never passes.

**Cause.** The containers run as uid 1000 (see `user: "1000:1000"` in `compose.yaml`), but the host folder in `EGG_DATA_DIR` is owned by another user, so Egg cannot write its database or work folder. A Docker named volume in place of a host path makes the same error appear, because `chown` on the host cannot reach it.

**Fix.** Create the host folder and give it to uid 1000, matching `EGG_DATA_DIR` in `.env`, then bring the stack up:

```bash
sudo mkdir -p /srv/egg/data && sudo chown -R 1000:1000 /srv/egg/data
docker compose up -d --build
docker compose exec app touch /data/.writable && docker compose exec app rm /data/.writable
```

The last line is a write check; if it fails, the ownership is still wrong.

**Caution.** If `EGG_DATA_DIR` names a Docker volume rather than a host path, the `chown` has no effect and upgrades or backups that need a host file will refuse to run, so keep it on a host path owned by 1000.

## 8. SSH host key mismatch

**Symptom.** The first **Test connection** shows **Confirm host key**, and deploys say `Confirm host key: open the Connect page, check the fingerprint of this server and confirm it first.` Later, a connection reports `The host key of ... changed` and Egg sends nothing to the server.

**Cause.** A new server's host key has not been pinned yet, or the server presented a different key from the one you confirmed. Egg pins the key you accept and refuses any other one. A real key change usually means the server was rebuilt; an unexpected one can mean the connection is being intercepted.

**Fix.** On the Connect page, press **Test connection**, compare the fingerprint with the server's own key, then press **Confirm host key**:

```bash
# On the deploy target, print the key to compare with the page
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

If the key genuinely changed, press **Disconnect**, add the server again, and confirm the new fingerprint. For `fake-nest`, the fingerprint it prints at startup is the one to confirm.

**Caution.** Confirming a fingerprint you have not checked against the server can hand your SSH key — and root on a Nest container — to whoever is intercepting the connection.

## 9. Webhook delivery failures

**Symptom.** Pushes do not trigger deployments. The GitHub App's recent deliveries list shows a failure: `503 webhook not configured`, `401 bad signature`, `503 maintenance`, `411 length required`, `413 payload too large`, or `429` with `Retry-After`. Egg may log that a signed body was refused as a replay.

**Cause.** `GITHUB_WEBHOOK_SECRET` is empty or differs from the GitHub App's webhook secret; the Webhook URL points at an address GitHub cannot reach (such as `localhost`); Egg is in maintenance mode; the body is oversized; or the same signed body was already recorded, so it is refused as a replay. GitHub does not resend a failed delivery on its own.

**Fix.** Set the webhook secret and URL, restart Egg, then redeliver the failed event from the GitHub App's recent deliveries list:

```bash
# Local install: set GITHUB_WEBHOOK_SECRET in web/.env.local, then
cd web && pnpm egg start
# Server: set GITHUB_WEBHOOK_SECRET in .env, then
docker compose up -d --build
docker compose logs app
```

The Webhook URL must be `<APP_URL>/api/webhooks/github` at an address GitHub can reach. On a computer, use a tunnel limited to that path, or leave pushes out and deploy with the **Deploy** button, a deploy hook or the CLI. Check the App's permissions and events (Push and Pull request) as well.

**Caution.** GitHub does not retry failed deliveries by itself, so a push missed while Egg was down stays missed until you redeliver it from GitHub or deploy it manually.
