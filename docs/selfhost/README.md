# Run Egg yourself

Egg is a dashboard that deploys your GitHub repositories to a Linux server over SSH. You can run your own copy. You do not need a Hack Club account to do it.

This guide covers three ways to run Egg, how sign-in works in each, how to connect a server to deploy to, how to set up the GitHub App, every setting Egg reads, and what to do when something goes wrong.

Words used in this guide:

- **Egg machine.** The computer that runs Egg: your laptop, or a server you own.
- **Deploy target.** The Linux machine your apps run on. Egg reaches it over SSH. For Hack Club members this is a Nest container. A deploy target can also be a server you own (see "What a deploy target needs").
- **Worker.** The part of Egg that clones your repository, packs the source, uploads it, and runs the build on the deploy target. It runs inside the Egg process unless you start it on its own.
- **Release.** One deployed version of an app, kept in its own folder on the deploy target.
- **Preview.** A release built from a branch other than the production branch, or from a pull request.

To change the name, colours, ports or build memory, see [customising.md](customising.md).

## Pick your setup

| Setup | Who it is for | How you sign in | Start it with |
| --- | --- | --- | --- |
| **A. On this computer** (local mode) | One person, using Egg privately on a laptop or desktop. | A local password. You set it on your first visit, with a recovery key from `.env.local`. No outside account. | `pnpm egg start` |
| **B. On your own server** (Docker Compose and Caddy) | One person, or a small group you trust, who want Egg reachable at a domain with HTTPS. | Hack Club, if you set `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET`. Or local mode for one owner, if you set `LOCAL_MODE_ALLOW_REMOTE=1` and keep the site behind your own access control. | `docker compose up -d --build` |
| **C. A shared instance with sign-in** (several people) | A group where each person has their own account, projects and servers. | Hack Club only. Without Hack Club there is exactly one account (see "More than one person"). | Same as B, with the Hack Club values set |
| **D. A trial with a stand-in server** | You want to see a deploy work with no Nest account and no server. | Any of the above. | `pnpm fake-nest`, next to A |

Where your apps run is a separate choice:

| Deploy target | Status |
| --- | --- |
| A Hack Club Nest container | What Egg was built for. |
| A Linux server you own, over SSH | Written to need only SSH, systemd and a few common tools, but **not tested on other hosts**. Several screens still say Nest and the Domains page only knows Nest's rules. Read "What a deploy target needs" first. |
| `fake-nest` on your own machine | For trying things out. Never for real apps. |

For setup A, the commands in this guide are checked against `web/scripts/` and `web/package.json`. For setup B, they are checked against `compose.yaml` and `deploy/`. The Docker steps were not run end to end for this guide.

## What works where

| System | Support |
| --- | --- |
| Windows | Works. Not part of the automated checks. `pnpm fake-nest` needs WSL (see "Try it with a stand-in server"). |
| Linux | Works. |
| macOS | The same as Linux. |

The CI workflow runs the typecheck, lint, tests and the dependency audit on Linux and macOS. The audit fails the Linux run on a high-severity finding. On macOS it only reports it.

## What you need on the Egg machine

- **Node.js 22.13 or newer.** The repo pins `pnpm@11.20.0`, and that pnpm needs Node 22.13. (Next.js 16 alone would run on Node 20.9.) Check with `node -v`.
- **pnpm.** Run `corepack enable`, or install it with `npm install -g pnpm`. On Windows, run either in a terminal opened as administrator if it reports a permission error.
- **Git.** The worker runs `git clone` on the Egg machine. `pnpm run doctor` does not check for Git, so run `git --version` yourself.
- **A deploy target.** See "Connect a server to deploy to". You can try Egg without one (see "Try it with a stand-in server").

You do not need Docker for setup A. The Egg machine never installs or builds your app; that happens on the deploy target.

| Step | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Get Node.js | Installer from nodejs.org | Installer from nodejs.org | nodejs.org or your distribution's packages. Check `node -v`. |
| Get Git | Git for Windows (git-scm.com) | Run `git --version`; install Git if it is missing | Your package manager |
| Terminal | PowerShell or Git Bash | Terminal | Any terminal |
| Start on login | Scheduled Task | LaunchAgent | systemd user unit |
| `pnpm fake-nest` | Needs a WSL distribution named `Ubuntu` | Works | Works |

## Setup A: on this computer

Every command below runs from the `web/` folder, after the first two.

### 1. Get the code and install

```bash
git clone https://github.com/jeremy341/egg.git
cd egg/web
pnpm install
```

### 2. Create the env file

```bash
pnpm run setup
```

Type `pnpm run setup`, not `pnpm setup`. pnpm has a built-in command called `setup` that does something else. This writes `web/.env.local` with a fresh random `APP_SECRET`, a separate `LOCAL_MODE_SECRET` recovery key, and `LOCAL_MODE=1`. Keep the file private. It never overwrites a file that already exists. If your file is older and has no `LOCAL_MODE=1` line, add it and add a fresh `LOCAL_MODE_SECRET` (for example, `openssl rand -base64 32`).

`LOCAL_MODE=1` turns on sign-in without an outside account. Leave `APP_URL=http://localhost:3000` as it is. The next section explains the sign-in.

You can skip this step. `pnpm egg start` runs setup for you when `.env.local` is missing.

The setup script writes `DEV_LOGIN=0`. You can set it to `1` for a named development account with `pnpm dev`; it is ignored in a production build. When local mode is on, development sign-in also requires the local password.

### 3. Start Egg

```bash
pnpm egg start
```

One command does this, in order:

1. Creates `.env.local` if it is missing.
2. Checks the computer (see "The doctor" below).
3. Builds the app the first time.
4. Starts it on the port in `APP_URL`.
5. Opens your browser.

Press Ctrl+C to stop Egg.

`pnpm egg start --dev` runs the development server instead. It reloads while you edit code and skips the build.

If you prefer separate steps, `pnpm build` and then `pnpm start` do the same without the checks. Open <http://localhost:3000/login>. The page at <http://localhost:3000/> is Egg's public home page, not the dashboard.

On the first sign-in, enter the recovery key and choose a password. After that, enter the password to sign in. The next section has the details.

Your data is in `web/data/egg.db`. It stays on disk when Egg stops. Back it up together with `APP_SECRET` and `.env.local`; the database holds the password hash, and the recovery key in `.env.local` lets you reset the password if you forget it (see "Backups").

The deployment worker runs inside the web process (`RUN_WORKER=1`, which the setup script writes), so one command starts everything. If you set `RUN_WORKER` to anything else, run `pnpm worker` in a second terminal, or deployments stay queued.

### The doctor

```bash
pnpm run doctor
```

This only checks the computer. It starts nothing. Each check prints one line, and a problem has a `Fix:` line under it. It checks Node.js, pnpm, `.env.local` and `APP_SECRET`, the port, the data folder, whether any sign-in is set up, the operating system and the database setting.

- A cross (`✗`) stops Egg from starting. `pnpm egg start` runs the same checks and stops on a cross. Examples: Node.js too old, `APP_SECRET` missing or too short, the port already in use, a data folder Egg cannot write to.
- A warning (`!`) does not stop anything. Egg itself starts without the tool a warning names.

The command exits with 1 when there is a cross, and 0 otherwise. The doctor does not check Git, the network, or the deploy target.

### Start on login (optional)

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

## How sign-in works

Egg has four ways to sign in. Which ones you see depends on the settings.

| Method | Turned on by | Who can use it |
| --- | --- | --- |
| **Hack Club** | `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET`, both set | Anyone with a Hack Club account who can open your site. |
| **Local password** (local mode) | `LOCAL_MODE=1` and `LOCAL_MODE_SECRET` | One account, called "Owner". |
| **Email and password** | The person turns it on in Account | Only an account that already has an email address. See "Password sign-in needs Hack Club". |
| **Development sign-in** | `DEV_LOGIN=1`, outside a production build | You, while developing Egg. |

### What the login page shows

The login page changes with the settings.

| Settings | What you see |
| --- | --- |
| Nothing set up | A disabled **Continue with Hack Club** button and the note "Hack Club sign-in is not set up on this installation yet." |
| Local mode only | The local form. No Hack Club button. |
| Hack Club only | **Continue with Hack Club**, and a line that says Hack Club only confirms who you are. |
| Both | The local form above the **Continue with Hack Club** button. |
| `DEV_LOGIN=1` in `pnpm dev` | A "Development sign-in" form at the bottom, with a name field. It also asks for the local password when local mode is on. |

Every version also has a **Sign in with a password** link. It opens an email and password form. In local mode no account can use that form, because the local owner has no email address (see below).

If Hack Club is not set up and someone opens `/api/auth/login`, Egg sends them back to the login page with the same message.

### Run without Hack Club

This is the whole recipe.

1. Leave `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET` empty, or remove them.
2. Set `LOCAL_MODE=1` and a `LOCAL_MODE_SECRET` of at least 32 characters. `pnpm run setup` writes both.
3. Start Egg and open the login page. Because no password exists yet, the form is the first-time form: **Recovery key from private `.env.local`**, **Choose a password (12 characters minimum)**, **Confirm password**, and the button **Set password and sign in**.
4. Paste the value of `LOCAL_MODE_SECRET` as the recovery key. Choose a password of at least 12 characters and at most 256 bytes.
5. You land on Projects as the owner. Egg stores only a salted scrypt hash of your password. It never stores the password.
6. From then on the form asks for **Local password** and the button reads **Sign in on this computer**.

To change the password, use the local password card on Account. To reset a forgotten one, open **Reset with the recovery key** on the login page. A reset signs out every other session.

A wrong key or password gives "The recovery key is incorrect. Check the private .env.local file." or "The local password is incorrect."

What local mode does and does not do:

- **It is off by default.** Nothing turns it on except you setting `LOCAL_MODE=1`.
- **There is one account.** Its internal name is `local:owner` and it is called "Owner". Every local sign-in is this account.
- **It refuses to run on a public address.** If `APP_URL` is not `localhost`, `127.0.0.1` or `[::1]`, Egg stops with an error that names the problem. Anyone who could reach a public address could otherwise try to sign in as you.
- **The recovery key is private.** Anyone who obtains `LOCAL_MODE_SECRET` can set or reset the password. Keep `.env.local` private and back it up safely.
- **The explicit override.** If you host Egg elsewhere, set `LOCAL_MODE_ALLOW_REMOTE=1` only behind a VPN or access proxy you control. The password protects sign-in, and the network control limits who can reach the form.
- **It limits guessing.** The local sign-in and the email password sign-in count attempts in one shared bucket of 20 a minute when no trusted proxy is set, and per address when `TRUST_PROXY=1`.
- **The normal commands bind to loopback.** `pnpm dev`, `pnpm start`, `pnpm egg start` and the installed service listen on 127.0.0.1 for a local `APP_URL`, so other computers on your network cannot reach them.

### Confirming again ("reauth")

Some changes need a sign-in from the last 5 minutes: turning on **Terminal** or **File changes** for a server, and turning on email and password sign-in. Egg calls this a fresh sign-in. The number comes from `REAUTH_WINDOW_MS` in `web/src/server/auth/session.ts`. Turning a switch off never needs it.

How Egg gets the fresh sign-in depends on the settings:

| Settings | What happens when you turn on Terminal or File changes |
| --- | --- |
| Hack Club set up | Egg sends you to Hack Club to sign in again. It must be the same Hack Club account. |
| Hack Club not set up, `LOCAL_MODE=1` | Egg counts you as freshly signed in and goes straight back. No prompt. |
| Hack Club not set up, `DEV_LOGIN=1` outside production | The same: no prompt. |
| Hack Club not set up, nothing else | Egg returns to Account with `?reauth=not_configured` in the address. The page shows no message, and the switch stays off. |
| **Both** Hack Club and local mode set up | The local owner is sent to Hack Club, and Hack Club cannot confirm the local owner. Egg returns to Account with `?reauth=mismatch`. The page shows no message, and the switch stays off. |

The last row matters. If you run local mode, do not also set the Hack Club values. A person who signs in with Hack Club is a different account from the local owner, with no projects or servers of its own, and the local owner loses the ability to turn on Terminal and File changes. The older advice to use both side by side is not safe.

### Password sign-in needs Hack Club

The **Sign in with a password** card on Account (email and password) is a second way into an account that already exists. It is off until the account turns it on, and then it needs an email address on the account and a recovery key that Egg shows once.

Turning it on needs a fresh sign-in, and the fresh sign-in for this card comes from the same rule as above. In practice:

- The local owner cannot use it. The card is not shown, and the route answers "Not found".
- A development account has no email address, so Egg answers "Your account does not share an email address, so a password cannot be used to sign in."
- An account made by Hack Club has an email address (when the person shares it), and can turn it on within 5 minutes of a Hack Club sign-in. Otherwise Egg answers "Confirm with Hack Club first. Turning on password sign-in needs a sign-in in the last 5 minutes."

So **without Hack Club, email and password sign-in cannot be turned on.** The only password sign-in on an instance without Hack Club is the local owner's. If a Hack Club account turned the password on and you remove Hack Club later, that password keeps working. Egg refuses to turn a password off when it is the account's only way in: "This is the only way you can sign in, so it cannot be turned off."

### More than one person

- Egg has no sign-up form and no invitation to join an instance. A person gets an account by signing in.
- With Hack Club set up, anyone with a Hack Club account who can open your site gets their own account. Nothing in the code limits who. If the site is public, put it behind your own access control, or do not share the address.
- Without Hack Club, a production instance has exactly one account, the local owner. There is no other way to create one. Run one Egg per person, or set up Hack Club Auth.
- Nobody has special rights from being first. The `/admin` dashboard belongs to the account whose id you put in `SECURITY_REPORT_ADMIN_ID` (see "Security notes"). To find an id, sign in and open `/api/me`.
- Servers and projects belong to the account that created them.

### Set up Hack Club Auth (optional)

1. Open <https://auth.hackclub.com/developer/apps> and create an app.
2. Set the redirect URI to `<APP_URL>/api/auth/callback`.
3. Put the client id and secret in `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET`, and restart Egg.

Egg asks for the scopes `openid`, `profile` and `email`. A new app starts as `community_untrusted`, so people see a warning banner while they approve it. See [backend-setup.md](../backend-setup.md). Whether your account may create such an app is a Hack Club rule, not Egg's.

A sign-in lasts 30 days. The handshake with Hack Club must finish within 10 minutes in one browser.

## Permission switches are off by default

Each connected server has three switches on its Container page: **Terminal**, **File changes** and **Removing leftovers**. All three start off for every new server, and local mode does not change that. Nothing is pre-enabled for you. The terminal is a root shell on the container, so turn it on only when you need it. Turning a switch on asks you to type the server name.

## Connect a server to deploy to

Egg deploys by SSH. A key made just for one server is stored sealed in your database. The same three steps apply to every kind of target:

1. On the Projects page, choose to connect a server and enter a username.
2. Egg shows a public key. Add it to the target so that username can log in with it.
3. Press **Test connection**. The first time, Egg reaches the host, reads its host key, hangs up and shows the fingerprint under **Confirm host key**. Nothing is sent to the server until you check the fingerprint and press **Confirm host key**. Egg then pins that key, refuses any other one, and checks the container. The check only reads. It changes nothing.

The key gives Egg the same access as your own login, so treat the machine that runs Egg accordingly.

Each server keeps the host and port it was created with. Egg reads them from `NEST_HOST` and `NEST_PORT` when you add the server, so set those first.

You can connect up to 5 servers per account. The username may use letters, digits, dot, underscore and hyphen, 1 to 32 characters, starting with a letter or digit.

### On Hack Club Nest

1. Enter your Nest username, the name you log in with, for example `sam-r`. Leave `NEST_HOST` and `NEST_PORT` at their defaults (`hackclub.app` and `22`).
2. Paste the public key into the SSH Keys page of the Nest dashboard.
3. Test the connection and confirm the fingerprint against the one Nest shows for your server.

Removing the key in the Nest dashboard ends its access.

### On a server you own

Not tested on other hosts. This is what the code expects.

1. Before you add the server, set `NEST_HOST` to the server's address and `NEST_PORT` to its SSH port in `.env.local`, then restart Egg.
2. Enter the SSH username in the **Nest username** box. Use `root`, or read "What a deploy target needs" first.
3. Egg shows a public key. The screen says to paste it into the Nest dashboard. On your own server, add that key to `~/.ssh/authorized_keys` of that user instead. Egg uses key login only.
4. Press **Test connection**, check the fingerprint against the server's own host key (for example `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the server) and press **Confirm host key**.

Egg labels the server `<username>.hackclub.app` in several places, whatever host you set. That is a display problem only; the connection uses your host.

### What a deploy target needs

Egg talks to the target with plain SSH commands (`bash -s`, and `cat` for uploads). It does not need SFTP. It does not use systemd user services and it does not need `loginctl enable-linger`: it writes system units to `UNIT_DIR`, which is `/etc/systemd/system` by default, and runs `systemctl` without `sudo`.

| The target needs | Why | If it is missing |
| --- | --- | --- |
| SSH login with a key, as the username you entered | Everything | "Nest rejected the key. Check that you pasted the public key on the SSH Keys page of the Nest dashboard, and that the username is exactly your Nest username." |
| `bash`, `tar` | Scripts and unpacking | "tar is not installed." blocks deploys |
| systemd running as the system manager (`systemctl` works) | Each app runs as a service named `egg-<project>.service` | "systemd is not available in this container, so Egg cannot keep your apps running or restart them." blocks deploys |
| Root, or an account that can write to `UNIT_DIR` and run `systemctl` | Writing and restarting service files | A warning: "SSH did not log in as root. Nest normally does; without root, installing the service files may fail." |
| `systemd-run`, cgroup v2 with the memory controller, and the `timeout` command | Builds run under a memory cap that Egg will not skip | The deployment ends with one line that says what to fix, and nothing is uploaded |
| Node.js matching the project's `engines` range, or 22.13 or newer when there is none | Node projects | The same: one line, nothing uploaded |
| npm, or corepack for pnpm and yarn; Python 3 and `venv` for Python projects | Installing dependencies | The same |
| At least 2048 MB of free disk | Releases are kept for rollback | The same |
| `curl` and `sha256sum` | Health checks and upload checks | Warnings only. Without `curl`, the health check falls back to a plain TCP check. |
| A free port for each app | Each app listens on `0.0.0.0` on the port you choose | A port from 1024 to 65535, and not 20000 to 29999 (kept for previews) |

Egg puts everything under `~/.egg` on the target and names its service files `egg-*.service` and its timers `egg-*`. Anything without Egg's marker is never overwritten, stopped or removed.

The health check runs on the target against `127.0.0.1`, over SSH. The Egg machine does not need to reach your app's port.

### What is Nest specific

Nest is a free hosting service for Hack Club members. Egg was built for how Nest works. See [nest-research.md](../nest-research.md).

| Part | Nest specific? |
| --- | --- |
| SSH through the bastion `hackclub.app`, which forwards a key to the user's container as root | Yes. On your own server there is no bastion, and you choose the user. |
| Each container has systemd as PID 1, and the SSH user is root | Egg assumes it. Own servers must match (see above). |
| Public addresses: Nest maps a domain to a port in its own dashboard, and gives each member `<name>.hackclub.app` | Yes. The **Domains** page and the tour tell you to use the Nest dashboard, and its DNS check looks for a CNAME to `<username>.hackclub.app` or a TXT record `domain-verification=<username>`. On your own server, the check will not pass. |
| The "Open the Nest dashboard" link and the "paste your key into the SSH Keys page" text on the Connect page | Yes |
| Reserved names and the `hackclub.app` suffix rules for domains | Yes |
| The public Nest status page at `/nest-status` | Yes. It reports on Nest (whether Egg can reach it, and Hack Club's own status page) and says nothing about your own server. |
| SSH key login, `bash`, `tar`, systemd units, release folders, health checks, the build under a memory cap | No. These should work on any Linux server that meets the table above. Not tested on other hosts. |

An app deployed to your own server listens on a plain `http` port. Egg does not install a web server, a certificate or a firewall rule. Put your own reverse proxy (for example Caddy or nginx) in front, and block the app port from the internet. See `docs/design/self-host-gaps.md` for the full list.

### Try it with a stand-in server

To try deploys without a Nest account or a server, run a stand-in container beside Egg:

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

`fake-nest` accepts the public key of every server saved in your database and runs commands on Linux. On Windows that means WSL: it needs a WSL distribution called `Ubuntu`, or set `TEST_WSL_DISTRO` to the name of yours before you start it. It is a trial tool, never a substitute for a real deploy target.

`pnpm seed:demo` fills the database with sample projects for the `dev` user of the `DEV_LOGIN` form, so you can see the dashboard full. `pnpm seed:demo --reset` removes them.

### Where builds run

Builds run on the deploy target of each project. The Egg machine only clones the repository, packs the source and uploads it over SSH. It does not install or build anything, and it needs no Docker.

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

The Egg machine keeps the clone and the packed source in `DEPLOY_WORK_DIR` until the deployment ends, whether it worked or not. Then Egg deletes that folder. The packed source may be 500 MiB at most.

## Set up the GitHub App

You do not need the GitHub App to start. Without it you can:

- Import a **public** repository by pasting its address (`https://github.com/owner/name`).
- Deploy by pressing **Deploy**, with a deploy hook (`POST /api/hooks/deploy/<token>`), or from the command line (see "Other commands").

You need the App for private repositories, the repository picker, deploying on every push, and pull request previews. Only repositories on `github.com` can be cloned. Another host is refused with "Repositories on HOST are not supported yet. Supported: github.com."

### Create the App

This works without a Hack Club account. Create a GitHub App at <https://github.com/settings/apps/new> with these settings. The field names follow [backend-setup.md](../backend-setup.md); GitHub's form may word them a little differently.

| Setting | Value |
| --- | --- |
| Homepage URL | Your `APP_URL` |
| Callback URL | `<APP_URL>/api/github/callback` |
| Setup URL | `<APP_URL>/api/github/callback`, with "Redirect on update" on |
| Request user authorization (OAuth) during installation | On. This is how Egg learns which installations belong to which person. |
| Webhook URL | `<APP_URL>/api/webhooks/github` |
| Webhook secret | A random string. Save it as `GITHUB_WEBHOOK_SECRET`. |
| Repository permission: Contents | Read-only |
| Repository permission: Metadata | Read-only |
| Repository permission: Pull requests | Read and write. Only the pull request preview comment needs write; without it, previews still build and the comment is skipped. |
| Subscribe to events | Push and Pull request. Installation events arrive without a subscription. Egg also understands a Repository rename event; subscribing to it is optional. |

Then generate a private key and put the values in `.env.local`:

| Variable | Where to find it |
| --- | --- |
| `GITHUB_APP_ID` | The App ID on the App's settings page |
| `GITHUB_APP_SLUG` | The name in the App's public address, `github.com/apps/<slug>`. Without it Egg has no install link. |
| `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET` | The client id, and a client secret you generate |
| `GITHUB_APP_PRIVATE_KEY` | The PEM text of the key. Put it on one line and write each line break as `\n`. |
| `GITHUB_WEBHOOK_SECRET` | The webhook secret above |

Egg treats GitHub as set up only when the App ID, private key, client id, client secret and webhook secret are all non-empty. Set all six, then restart Egg. The **Install the GitHub App** button on the New project page then appears.

The repository also holds `web/scripts/create-github-app.mjs`, which creates the App through GitHub's manifest form and writes the values into `.env.local`. It is not mentioned anywhere else and it was not tested for this guide. Two things to know before you use it: it assumes `APP_URL` is `http://localhost:3100` unless you set `APP_URL` in the environment when you run it, and it leaves the webhook secret empty, so Egg will not count GitHub as set up until you add `GITHUB_WEBHOOK_SECRET` yourself.

### Webhooks need an address GitHub can reach

GitHub sends each push to `<webhook URL>`, so GitHub must be able to open that address. A computer at `http://localhost:3000` cannot receive pushes.

- **On your computer, without a tunnel.** Leave pushes out. Set `GITHUB_WEBHOOK_SECRET` to any random string, because Egg needs it to be non-empty. Deploy with the **Deploy** button, a deploy hook or the command line.
- **On your computer, with a tunnel.** A tunnel is a tool or service that gives your computer a public https address. Egg does not include one and this guide did not test any. Point the App's Webhook URL at `<tunnel address>/api/webhooks/github`. Keep `APP_URL` as `http://localhost:3000`: your own browser follows the callback URL, and local mode refuses an `APP_URL` that is not local. A tunnel normally exposes your whole site, including the login page. Use one that can limit the path to `/api/webhooks/github`, if you can.
- **On a server.** Set the Webhook URL to your public `APP_URL`.

GitHub does not resend a failed delivery by itself. After Egg is back, use the App's recent deliveries list to redeliver.

## Settings, one by one

Every name in the first group is read in `web/src/server/config.ts`. Put them in `web/.env.local` (setup A) or in `.env` next to `compose.yaml` (setup B). A value for an on or off setting must be exactly `0`, `1`, `true` or `false`, in lower case. An empty value is rejected.

### Core

| Variable | Default | What it does | Needed when |
| --- | --- | --- | --- |
| `APP_URL` | `http://localhost:3000` | The address of the site. Used for redirects, the same-origin check on writes, callback URLs and hook URLs. Must match the address in your browser, and must be a full address starting with `http://` or `https://`. | Always. Set it to your public `https://` address on a server. |
| `APP_SECRET` | none | 32 or more characters. Encrypts SSH keys and environment variables. Back it up. Losing it, or changing it, makes every stored key unreadable. | Always. Egg will not start without it. |
| `DATABASE_URL` | `file:./data/egg.db` | The database. A path starting with `file:` is relative to `web/`. | Only to move the file. Under Compose it is `file:/data/egg.db`. |

### Sign-in

| Variable | Default | What it does | Needed when |
| --- | --- | --- | --- |
| `LOCAL_MODE` | `0` | `1` or `true` turns on the local owner sign-in. See "Run without Hack Club". | You want to run without Hack Club. |
| `LOCAL_MODE_SECRET` | none | At least 32 characters. The recovery key that sets or resets the local password. | `LOCAL_MODE` is on. |
| `LOCAL_MODE_ALLOW_REMOTE` | `0` | `1` lets `LOCAL_MODE` run when `APP_URL` is not local. Does nothing when `LOCAL_MODE` is off. | Local mode on a server, behind your own access control. |
| `HACKCLUB_CLIENT_ID`, `HACKCLUB_CLIENT_SECRET` | empty | Hack Club Auth app credentials. Both must be set for the Hack Club button to work. | You want Hack Club sign-in, or more than one account. |
| `DEV_LOGIN` | `0` | `1` shows a fake sign-in with a name field. Works only with `pnpm dev`; ignored in a production build. | Developing Egg only. |
| `SECURITY_REPORT_ADMIN_ID` | empty | The exact database id of the instance administrator. Turns on `/admin` and the private report inbox for that account. | You want an administrator account. |

### Behind a proxy

| Variable | Default | What it does | Needed when |
| --- | --- | --- | --- |
| `TRUST_PROXY` | `0` | `1` or `true` makes Egg believe the `X-Forwarded-For` and `X-Real-IP` headers for each visitor's address. Set it to `1` only when every request reaches Egg through a reverse proxy you run, which sets those headers itself. Without it every visitor counts as one address: analytics cannot tell visitors apart by address, and the limits on sign-in attempts and invalid access tokens do not apply. On your own computer, leave it off. | Egg is behind Caddy or another proxy. The Compose example sets it. |
| `APP_HOST` | none | The host name part of `APP_URL`, without `https://`. Caddy gets the certificate for it. Read by Compose and Caddy, not by Egg. | Setup B. |
| `EGG_DATA_DIR` | none | The folder on the server that holds the database and the cloned source. Read by Compose, not by Egg. | Setup B. |

### GitHub

| Variable | Default | What it does | Needed when |
| --- | --- | --- | --- |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` | empty | A GitHub App, for private repositories, the repository picker and deploy on push. Set them together. Public repositories deploy by URL without it. See "Set up the GitHub App". | Private repositories, push to deploy, previews. |

### Deploy target and storage

| Variable | Default | What it does | Needed when |
| --- | --- | --- | --- |
| `DEPLOY_WORK_DIR` | `./data/work` | Where sources are cloned and packed, relative to `web/`. Each deployment gets a folder here that Egg deletes when the deployment ends. Make sure the disk has room for the clone and the archive (at most 500 MiB) of every deployment that runs at once. | Only to move it. Under Compose it is `/data/work`. |
| `NEST_HOST` | `hackclub.app` | The SSH host that a new server connects to. Each server keeps the value it had when you added it. | A target other than Nest, or `fake-nest`. |
| `NEST_PORT` | `22` | The SSH port that a new server connects to. | A target on another port, or `fake-nest`. |
| `UNIT_DIR` | `/etc/systemd/system` | Where service files are written on the target. | `fake-nest` only. Leave it alone for a real server. |

### Read elsewhere in the code, not in `config.ts`

| Variable | Default | What it does | Read in |
| --- | --- | --- | --- |
| `RUN_WORKER` | unset in the code, `1` from the setup script | `1` runs the deployment queue inside the web process. Anything else means run `pnpm worker` yourself. | `web/src/instrumentation.ts` |
| `WORKER_CONCURRENCY` | `2` | How many deployments run at once. One project never deploys twice at the same time, and one build runs at a time on a container. | `web/src/instrumentation.ts`, `web/worker/index.ts` |
| `MONITOR_INTERVAL_MS` | `300000` | How often the uptime monitor checks, in milliseconds. `0` turns it off. | `web/src/server/jobs.ts` |
| `MONITOR_CONCURRENCY` | `4` | How many servers the monitor checks at once. A whole number from 1 to 16; anything else falls back to 4. | `web/src/server/monitor.ts` |
| `DEPLOY_LOG_RETENTION_DAYS` | `90` | How long deployment logs are kept. A whole number from 1 to 3650. `0` keeps them for ever. Anything else falls back to 90. | `web/src/server/retention.ts` |
| `EGG_BACKEND_METRICS` | off | `1` turns on counters that the administrator can read at `/api/admin/diagnostics`. | `web/src/server/backend-metrics.ts` |
| `PORT` | `3000` | The port `pnpm start` listens on. Set `APP_URL` to match. | Next.js |
| `FAKE_NEST_PORT` | `2222` | The port `pnpm fake-nest` listens on. Set `NEST_PORT` to match. | `web/scripts/fake-nest.ts` |
| `TEST_WSL_DISTRO` | `Ubuntu` | The WSL distribution `pnpm fake-nest` uses on Windows. | `web/scripts/fake-nest.ts` |

## Other commands

All run from the `web/` folder.

| Command | What it does |
| --- | --- |
| `pnpm worker` | Runs the deployment queue on its own, when `RUN_WORKER` is not `1`. |
| `pnpm fake-nest` | The stand-in container. See "Try it with a stand-in server". |
| `pnpm seed:demo` | Fills the database with sample projects for the `dev` user of the `DEV_LOGIN` form. `pnpm seed:demo --reset` removes them. |
| `pnpm test`, `pnpm typecheck`, `pnpm lint` | The tests, the TypeScript check and the linter. |
| `pnpm audit:prod` | Checks the production dependencies for known high-severity problems. |

To use Egg from a terminal or a script, make an access token on the Developer page and see the [command line guide](../developers/cli.md). It runs as `node scripts/egg-cli.mjs` and needs Node 22.18 or newer; the guide says what to do on an older Node.

## Changing the build memory and the Nest username

**Build memory, build CPU and your apps.** The build runs on your deploy target, beside your running app, under a cap. The memory cap is the server's **Build memory (MB)**, 512 MB by default, and never more than the container's memory minus 512 MB. A project with a build step gets at least 1024 MB while it builds, when the container has room for it. The CPU cap is **Build CPU limit (cores)**, 2 by default. You change both per server on that server's **Container** page. Memory can be 512 MB up to the memory the server reports, or up to 8192 MB when it reports none. CPU can be 0.5 cores up to the cores the server reports (2 when it reports none), in steps of 0.25. Servers that still had the old 1024 MB default saved were lowered to 512 MB. A build that goes over its memory cap is stopped with "The build needed more memory than the cap of N MB." and the log says so. A build that wants more CPU than its limit only runs slower. The default memory is set in `web/src/lib/build-memory.ts`, see [customising.md](customising.md).

**The username.** This is not an environment variable. You enter it when you connect a server, and it is saved with that server. To change it, disconnect the server and connect it again with the new name, then add the new public key on the target.

## Backups

Everything Egg stores is in one SQLite file, by default `web/data/egg.db`. That includes users, servers, sealed SSH keys, projects, deployments and logs.

1. Stop Egg. Copying a database while it is being written can give you a broken copy.
2. Copy `web/data/egg.db` to somewhere safe. If files named `egg.db-wal` or `egg.db-shm` sit next to it, copy those too.
3. Copy `web/.env.local` separately. The SSH keys in the database can only be opened with the `APP_SECRET` inside it, so the two belong together. Do not store them in the same place if the backup leaves your machine.

To restore, stop Egg, put the file back at the same path and start Egg again.

If you changed `DATABASE_URL`, back up that path instead. On a server, `sh deploy/backup.sh` makes the copy while Egg runs (see below).

## Updating

```bash
# stop Egg first, and take a backup (see above)
git pull
pnpm install
pnpm build
pnpm start
```

Database changes are applied automatically the first time the new version opens the database. Going backwards, from a newer database to older code, is not supported, so keep the backup from before the update. On a server, use `sh deploy/upgrade.sh` (see below).

## Setup B: on your own server

This part runs Egg with Docker Compose on a Linux server. Caddy sits in front of it and gets HTTPS for you. The steps were checked against `compose.yaml`, `deploy/` and `deploy/.env.example`. They were not run end to end for this guide.

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

Then choose how people sign in (see the next section). Do not put a comment after a value on the same line in `.env`.

Create the data folder and give it to the container user (uid 1000). The path must match `EGG_DATA_DIR` in `.env`:

```bash
sudo mkdir -p /srv/egg/data && sudo chown -R 1000:1000 /srv/egg/data
```

Start it:

```bash
docker compose up -d --build
```

From `web/`, `pnpm run compose:up` does the same. For a trial on one machine, `deploy/Caddyfile` says that `APP_HOST=localhost` makes Caddy use its own local certificate. That was not tested for this guide.

### Sign-in on a server

Pick one.

**Hack Club.** Set `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET` in `.env`, with the redirect URI `<APP_URL>/api/auth/callback`. Anyone with a Hack Club account who can open the site can sign in and gets their own account.

**Local mode, for one owner without Hack Club.** Add these to `.env`:

```
LOCAL_MODE=1
LOCAL_MODE_SECRET=<at least 32 random characters, for example from openssl rand -base64 32>
LOCAL_MODE_ALLOW_REMOTE=1
```

`LOCAL_MODE` does not start on a public address without `LOCAL_MODE_ALLOW_REMOTE=1`. With it, the sign-in form is open to anyone who can reach the site. What stops a stranger is the recovery key for the first sign-in, and the password after that. Add your own access control as well (a VPN, or an access proxy), and leave `HACKCLUB_CLIENT_ID` empty. Mixing it with Hack Club causes the problem in "Confirming again". Not tested for this guide.

### HTTPS and ports

Caddy gets and renews the certificate by itself. It listens on ports 80 and 443, and on 443/udp for HTTP/3. The app is not reachable on any other port, so do not publish the app port yourself.

`TRUST_PROXY=1` is set in the example file because every request comes through Caddy. Never set it if the app can be reached without going through Caddy.

Under Compose the web app uses the session cookie with the `Secure` flag (`NODE_ENV=production`). Use the `https://` address. A plain `http://` address other than localhost is not expected to keep you signed in. Not tested.

### Builds

Nothing is built on this server. The `worker` service clones each repository, packs the source and sends it to the project's deploy target, where the install and build run under a cap. No service in `compose.yaml` needs the Docker socket or extra privileges. The worker starts with the rest. Without it, deployments stay queued.

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

## Building on GitHub Actions

A project can build on GitHub and send Egg the finished release. Egg makes the workflow file from the project settings, and the GitHub build card in the project settings shows the steps (`web/src/server/builds/workflow.ts` and `web/src/components/github-build-card.tsx`). The workflow reads four credentials. Egg shows each value once, when you make the build credentials.

| Credential | Where on GitHub |
| --- | --- |
| `EGG_UPLOAD_PRODUCTION_TOKEN` and `EGG_ENV_PRODUCTION_TOKEN` | Secrets of a GitHub Environment named `egg-production`, limited to the production branch. Optional: Required reviewers. |
| `EGG_UPLOAD_PREVIEW_TOKEN` and `EGG_ENV_PREVIEW_TOKEN` | Repository secrets |

Do not save the production values as repository secrets: a workflow edited on any branch could read them. **Test connection** in Egg cannot see GitHub secrets or environment settings, so check these by hand. Anyone who can edit workflows can run code with the preview credentials and whatever else the repository allows, so treat workflow editors as trusted operators. Roles in Egg do not isolate Nest accounts from them. The Egg address must be reachable from GitHub's runners, which means a public `APP_URL`.

## Drain and clean up Egg-managed deployments

Settings and Account offer **Clean up and delete account**. Project Settings offers the same operation for one project. Type the displayed name and review the final confirmation to schedule it. No cleanup is scheduled merely by opening the page.

New deployments and remote sessions for the affected resources are paused immediately. Egg waits at least five minutes, then waits for active deployment jobs and tracked SSH sessions to settle. The app process runs this durable queue even when its build worker is disabled. An app restart resumes requests that have not started remote work. A drain can be canceled before its first execution; after remote removal begins it cannot be undone.

The delay is not a load-balancer traffic drain: stopping the application causes downtime, and Egg cannot guarantee that application requests complete. Canceling a scheduled cleanup also does not restart queued deployments it already canceled.

Cleanup checks explicit Egg ownership markers before touching service units or project folders. It stops each verified service and checks that it is inactive before removing units and deployed releases. It preserves `shared/`, your GitHub repositories and anything whose ownership it cannot verify. If a server is unreachable, a service cannot stop, or ownership is uncertain, the project/account records and stored credentials remain available for repair and retry. The status panel shows each target and its error. Repair a failed connection on Connect, then retry; another five-minute drain applies.

An interrupted executor is **not** reclaimed automatically. If the page says its worker did not confirm completion, first stop the old app/worker and verify that its remote cleanup commands and terminal sessions have stopped on the affected server. Only then check the verified-idle confirmation and retry. This manual check is necessary because a disconnected SSH channel cannot prove detached remote processes have stopped.

Importing an app that already runs measures the preview release before it copies it. It refuses if the release is over 2048 MB, or if the copy would leave under 2048 MB free (the same minimum as the deploy check). Then nothing is changed. A copy that fails part way is removed again (`web/src/server/adoption-import.ts`).

Before account deletion finishes, save the manual-removal links shown in its confirmation: remove Egg's public key on the deploy target (on Nest, in the Nest dashboard) and review the GitHub App installation on GitHub. Those permissions can be shared with other projects or people, and this integration cannot safely revoke them automatically. Database backups can retain old records until the operator expires them.

## Security notes

### Before you open Egg beyond localhost

- **Use HTTPS.** Sessions use a cookie that is `HttpOnly`, `SameSite=Lax`, and `Secure` in a production build.
- **Do not publish the app port.** Only Caddy (or your own proxy) should be reachable. The Compose file publishes 80 and 443 only.
- **Set `TRUST_PROXY=1` only behind a proxy you run.** Wrong either way breaks address limits: off, every visitor shares one address; on without a proxy, anyone can choose their own.
- **Anyone with a Hack Club account can sign in** once Hack Club is set up. There is no allow list. A signed-in person can connect their own servers, and your Egg machine then clones and packs their repositories. Put the site behind your own access control if that is not what you want.
- **`LOCAL_MODE_ALLOW_REMOTE=1` puts the sign-in form on the network.** The recovery key and a password of at least 12 characters protect it. Add a VPN or access proxy.
- **A tunnel exposes your whole site**, not only the webhook.
- **The database holds sealed SSH keys.** Each one gives Egg root, or whatever the username can do, on a deploy target. `APP_SECRET` unseals them. Keep the database and `APP_SECRET` apart in backups.
- **Terminal, File changes and Removing leftovers start off** for every server. Leave them off until you need them.
- **Apps on a server you own** listen on `0.0.0.0` on their port. Block those ports in the firewall unless you want the app open on plain `http`.

### Private vulnerability inbox

Set `SECURITY_REPORT_ADMIN_ID` to the exact Egg database user id of the administrator, then restart the app. The id is returned by `/api/me` while signed in and is also available in the local `users` table. Names and email addresses do not grant access. With this setting empty, the public form refuses submissions and the inbox denies access. The administrator opens `/security/reports`; public visitors submit from `/security#report`.

Reports may be anonymous or include a name and reply address. Egg does not attach the signed-in account or store an IP address with the report. The in-memory limiter uses a hashed trusted client address when available, otherwise a shared client bucket; reverse proxies and hosting logs may independently record request metadata. Anonymous reports have no reply channel. Submitted text and image metadata can still identify a reporter.

Report text, supplied identity, and evidence are sealed with `APP_SECRET` in the database. The inbox accepts up to three PNG/JPEG images of 1 MB and 16 million pixels each; other proof belongs in a Markdown code block. HTML and remote images are not rendered. The inbox holds at most 200 reports and 100 MB of encrypted payloads, and stops accepting reports when full. Submissions have process-local client/global rate limits; operators should also apply request limits at their trusted proxy. The admin may mark reports new, reviewing, or resolved, and permanently delete reports and evidence. Reports stay until deleted; backups have their own retention. Do not open untrusted evidence or execute proof code on a sensitive machine.

### Instance administration and maintenance

The same exact `SECURITY_REPORT_ADMIN_ID` grants access to `/admin`, which adds an Administration sidebar link to that account. The administrator retains the ordinary project/account tools and can view aggregate account, project, server, queue, cleanup and report counts. The dashboard does not expose other users' SSH keys, environment values, files or terminal output. Changing the configured ID requires an operator restart; names and email addresses are never administrator credentials.

Maintenance can start immediately or use optional start/end times. It is saved in the database and survives app restarts. While active, ordinary browser/API/MCP mutations are refused with `503 maintenance`, and new ordinary deployment jobs stay queued. The configured administrator can keep working. Signed-in people see a notice that refreshes at least every 30 seconds. Sign-in/sign-out, security reports, cancellation, session/token revocation, and recovery of an already-requested cleanup remain available; new cleanup requests are paused. GitHub linking is also paused for ordinary users.

Maintenance is an operational read-only boundary, not a process freeze: requests and deployments already underway may finish, scheduled cleanup and monitoring continue, incoming analytics/report collection remains available, and applications already deployed on the deploy target keep running. It cannot stop SSH access outside Egg or protect the host during infrastructure changes. Wait for existing jobs and take a verified backup before upgrading. If the settings database cannot be read, mutation requests fail rather than bypassing the maintenance check.

GitHub App webhook events are refused with `503 maintenance` before replay state is recorded, for all repositories including the administrator's. This pauses pushes, pull-request preview creation/removal, repository renames and installation updates. [GitHub does not automatically redeliver failed deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries). After the window, use the App's recent webhook deliveries to redeliver failures; a missed push can alternatively be deployed from Egg. Preview cleanup and integration metadata may remain stale until their events are redelivered. Egg does not persist or automatically replay paused payloads.

### Request size limits

Caddy (`deploy/Caddyfile`) refuses an oversized body before the app sees it, and the app holds the same limits itself. If you put a different proxy in front, set the same limits there.

| Path | Largest body |
| --- | --- |
| Every path not listed below | 1 MiB |
| `/api/builds/upload` (a release sent from GitHub Actions) | 500 MiB |
| `/api/projects/<id>/files/write` (file uploads) | 50 MiB |
| `/api/webhooks/github` | 5 MiB |
| `/api/security-reports` | 5 MiB |

Stock Caddy cannot limit request rates. Use your firewall or provider to rate-limit the two public paths, the webhook and the security reports.

### Variables and static sites: rotate old values

Runtime variables are stored outside the release folder, in `<project>/env/<release id>.env` on the deploy target (file mode 600, folder mode 700). `<project>/current.env` follows the live release. Saving a value changes nothing until the next deploy, and a rollback restores the variables that release was deployed with.

The built-in static server (used for static sites, with Python 3 or Node.js) answers only GET and HEAD, lists no folders, refuses any path with a part that starts with a dot, refuses paths that climb out of the folder and links that point outside it, and answers 400 to a malformed address.

**Rotate secrets used before this change.** Before variables moved out of the release folder, a public static deployment could serve its `.env` file, so a value saved for a public static project could be downloaded from `/.env`. If you ran one, treat those values as exposed: rotate them at their source, then deploy again.

### Limits and request handling

- **Request size.** A signed-in JSON request may be up to 256 KB. A larger one is refused with 413.
- **GitHub webhook intake.** The webhook is public, so it is the one route anyone can send bytes to. Egg refuses a delivery without a `Content-Length` (411), one over 5 MB (413), or one whose `X-Hub-Signature-256` is missing or malformed (401), all before reading the body. At most four deliveries are read at once; more get `503` with `Retry-After`, and GitHub's redelivery can retry them. Caddy's stock build has no rate limiting or connection caps. If you want them, set a request rate limit on `/api/webhooks/github` at your firewall or cloud load balancer. Egg does not need it for memory safety.
- **Rate limits.** One address may make 20 sign-in attempts a minute, and 60 requests a minute with access tokens that are not recognised. These limits count by address, so they only work when `TRUST_PROXY=1` behind a proxy. The example file sets it. They are kept in memory, so a restart clears them. The local sign-in and the email password sign-in use one shared bucket of 20 a minute when no address is known.
- **Content policy.** The `script-src` rule still allows inline scripts, so a script injected into a page would not be blocked by it. A per-request nonce would close this, but it is not in place yet. The fix is open. The rules against framing, plug-ins and form hijacking are not affected.

## If something is wrong

### Start-up and settings

| You see | Why | Fix |
| --- | --- | --- |
| "Invalid environment configuration:" followed by `APP_SECRET: Invalid input: expected string, received undefined` | `APP_SECRET` is not set. | Run `pnpm run setup`, or set a secret of 32 or more characters. |
| `APP_SECRET: APP_SECRET must be at least 32 characters` | The secret is empty or too short. | Use a longer one. |
| `LOCAL_MODE: Invalid option: expected one of "0"\|"1"\|"true"\|"false"` | The value is empty, upper case (`TRUE`), or a word like `yes`. This applies to every on or off setting. | Use `0`, `1`, `true` or `false`. |
| `LOCAL_MODE_SECRET: LOCAL_MODE requires a private LOCAL_MODE_SECRET.` | `LOCAL_MODE=1` with no recovery key. | Add a random `LOCAL_MODE_SECRET` of at least 32 characters. `pnpm run setup` will not touch an existing file. |
| `LOCAL_MODE_SECRET: LOCAL_MODE_SECRET must be at least 32 characters` | The key is too short. | Use a longer one. |
| `LOCAL_MODE: LOCAL_MODE signs anyone in as the owner, so APP_URL must be localhost or 127.0.0.1.` | `LOCAL_MODE=1` but `APP_URL` is not a local address. | Set `APP_URL=http://localhost:3000`, or read the override above. |
| `APP_URL: Invalid URL` | `APP_URL` has no `http://` or `https://`. | Write the full address. |
| `NEST_PORT: Invalid input: expected number, received NaN` | `NEST_PORT` is not a number. | Use a whole number. |
| "Egg did not start. Fix the lines marked with a cross, then run this again." | The doctor found a problem that stops Egg. | Read the `Fix:` line under each `✗`. `pnpm run doctor` shows the same list. |
| `Port 3000 is already in use` | Another program uses the port in `APP_URL`. | Stop it, or change the port in `APP_URL` in `.env.local`. |
| `Not allowed to listen on port N` | The port is below 1024. | Use a port above 1024 in `APP_URL`. |
| `<folder> cannot be created` or `<folder> is not writable` | Egg cannot write the data folder. | Change `DATABASE_URL`, or fix the folder's permissions. |
| `<version> is too old (needs >=22.13.0)` | Node.js is too old. | Install a newer Node.js. |
| `.env.local is missing` | No settings file. | Run `pnpm run setup`. |
| "pnpm was not found on the PATH" (a warning) | pnpm is not installed. | Run `corepack enable`, or install pnpm. |
| `No way to sign in is set up` (a warning) | No `LOCAL_MODE=1` and no Hack Club keys. The doctor counts `DEV_LOGIN` only with `--dev`. | Add `LOCAL_MODE=1` to `.env.local`, or set the Hack Club keys. |
| Deployments stay Queued | No worker is running. | Set `RUN_WORKER=1` and restart, or run `pnpm worker`. With Compose, run `docker compose ps` and `docker compose logs worker`. |
| A deployment stays Building/Deploying and its job lease is old | The worker stopped renewing its lease. Egg leaves the job blocking because a remote SSH command may continue after its worker disconnects. | Follow **Recovering a stale deployment** below. |

### Sign-in

| You see | Why | Fix |
| --- | --- | --- |
| "Hack Club sign-in is not set up on this installation yet." | The Hack Club keys are not set. | Set them, or use local mode. |
| No local form at all, only the disabled Hack Club button | `LOCAL_MODE` is not `1` or `true`, or Egg was not restarted after the change. | Edit `.env.local` and restart. |
| The form asks for a recovery key and a new password, not for a password | No local password has been set yet, or you opened **Reset with the recovery key**. | Paste `LOCAL_MODE_SECRET` and choose a password. |
| "The recovery key is incorrect. Check the private .env.local file." | The key you pasted is not `LOCAL_MODE_SECRET`. | Copy the value from `.env.local`. |
| "The local password is incorrect." | Wrong password. | Use **Reset with the recovery key**. |
| "Use a password at least 12 characters long and no more than 256 bytes." / "The new passwords do not match." | The form checks. | Fix the entries. |
| "The local password changed in another request. Try again or sign in." | Two changes raced. | Try again. |
| "That password or recovery key is not right." | Wrong email, password or key. Egg gives the same answer for an unknown email. | Check them, or reset with the recovery key. |
| "Too many sign-in attempts. Wait a minute and try again." | More than 20 attempts a minute. | Wait. |
| "You did not approve the sign-in...", "The sign-in took too long or came from another browser...", "That sign-in link was not valid...", "Hack Club could not sign you in..." | Hack Club steps. | Try again in one browser. |
| "Confirm with Hack Club first. Turning this on needs a sign-in in the last 5 minutes." | Turning on Terminal or File changes needs a fresh sign-in. | Sign in again, then retry. With no Hack Club and no local mode, it cannot be done (see "Confirming again"). |
| "Your account does not share an email address, so a password cannot be used to sign in." | The account has no email. | Email and password sign-in is not available for it. |
| "This is the only way you can sign in, so it cannot be turned off." | The password is the account's only sign-in. | Keep it, or set up another method first. |

### Servers and repositories

| You see | Why | Fix |
| --- | --- | --- |
| "Confirm host key" when you press Test connection, and deploys say "Confirm host key: open the Connect page, check the fingerprint of this server and confirm it first." | The first connection to a server waits for you to confirm its fingerprint. | Open the Connect page, press Test connection, then Confirm host key. |
| "The host key of ... changed" | The server presented a different key from the one you confirmed. Egg sent nothing. | If you expected it, press Disconnect, add the server again and confirm the new fingerprint. |
| "Nest rejected the key. Check that you pasted the public key..." | The target does not accept the key. | Add the public key (Nest: SSH Keys page; your own server: `authorized_keys`), and check the username. |
| "Timed out connecting to Nest. Your container may be stopped or starting; try again in a minute." | No answer in 20 seconds. | Check the host, port and firewall. |
| "Could not reach the Nest SSH host (...)" | Connection refused, host not found or reset. | Check `NEST_HOST` and `NEST_PORT` as they were when you added the server. |
| "systemd is not available in this container, so Egg cannot keep your apps running or restart them." | The target has no running systemd. | Egg cannot deploy there. |
| "SSH did not log in as root. Nest normally does; without root, installing the service files may fail." | A non-root user. | Use root, or make sure that user can write to `UNIT_DIR` and run `systemctl`. Not tested. |
| "Repositories on HOST are not supported yet. Supported: github.com." | Only GitHub is supported. | Use a `github.com` repository. |
| "Only plain https repository URLs are supported." | The address has a username, a password or is not https. | Use `https://github.com/owner/name`. |
| "The GitHub App is not configured." | One of the five required GitHub values is empty. | Set all six and restart. |
| The webhook answers 503 `webhook not configured` | `GITHUB_WEBHOOK_SECRET` is empty. | Set it. |
| The webhook answers 401 `bad signature` | The secret in GitHub and in Egg differ. | Make them the same. |

### Recovering a stale deployment

An expired lease is not proof that commands on the deploy target stopped. Egg therefore does not automatically free a stale running job. It remains the project's queue guard until an operator has confirmed the worker and its remote work have stopped.

Stop every Egg worker first. For Compose, stop the app as well because it may run the worker when `RUN_WORKER=1`:

```bash
docker compose stop app worker
docker compose ps
```

Also stop any separately run `pnpm worker` process and workers on other hosts. On the affected server, inspect processes for the Egg SSH command and any child command it launched (such as archive extraction or dependency installation). Do not continue while any could still be changing the project's files or service. If you cannot confirm that, leave the job running and investigate first. Never edit the database while a worker may still own the job.

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

## What does not work yet without Hack Club or Nest

The list of gaps, ranked, with the file and line for each, is in [docs/design/self-host-gaps.md](../design/self-host-gaps.md).
