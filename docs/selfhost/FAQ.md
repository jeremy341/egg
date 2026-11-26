# Self-hosting FAQ

Short answers to the questions people ask before running Egg themselves. The [self-hosting guide](README.md) is the full reference; each answer below ends with the pages that go deeper. Egg is independent of Hack Club and Nest, and a copy you run is your own instance.

To change the name, colours, ports or build limits of that copy, see [customising.md](customising.md).

## Is Egg single-user?

Without Hack Club, yes. A production instance has exactly one account: the local owner, `local:owner`, shown as "Owner". There is no sign-up form and no invitation; the only other ways to create a user are Hack Club sign-in and development sign-in, which is ignored in a production build. If several people want their own projects and servers, run one Egg per person or set up Hack Club Auth.

With Hack Club set up, anyone with a Hack Club account who can open your site gets their own account. Servers and projects belong to the account that created them, and project sharing (members, invitations and roles) was removed, so there is no team view inside a project. Nobody gets special rights by being first: the `/admin` dashboard belongs only to the account id in `SECURITY_REPORT_ADMIN_ID`.

This is the boundary with [Orchard](https://orchard.infra.hackclub.com). Orchard is a cluster-managed platform for projects and teams; Egg is a deployment and operations API for one owner's projects on their own server. Cluster features such as managed PostgreSQL, pods, sandboxes and templates are outside Egg's target and are marked not applicable in the [Orchard comparison](../design/orchard-comparison.md) and [feature comparison](../feature-comparison.md).

Related: [More than one person](README.md#more-than-one-person) · [Self-hosting gaps, items 1 and 8](../design/self-host-gaps.md) · [Orchard comparison](../design/orchard-comparison.md)

## Can I use my own domain?

Yes, for an app on Nest you already own. Nest maps domains to ports in its own dashboard and has no API for it, so Egg shows you what to enter and then checks the DNS. A domain counts as valid when it has a CNAME to `<username>.hackclub.app` or a TXT record `domain-verification=<username>`; Egg also makes an HTTPS request to the domain to check the certificate and the app's response.

On a server you own, that check cannot pass: its rules are Nest's, including reserved `hackclub.app` names. Put your own reverse proxy (Caddy or nginx) in front, get your own certificate and block the app's plain port from the internet. Each project can still require credentials for its valid custom domains with **Access protection**: off, a shared password, HTTP Basic, or Egg sign-in.

The Egg dashboard itself can also live at your domain. In the Compose setup, Caddy gets and renews the certificate for `APP_HOST`, and `APP_URL` starts with `https://`. Only ports 80 and 443 are published; do not publish the app port yourself.

Related: [What is Nest specific](README.md#what-is-nest-specific) · [Protecting deployed project addresses](README.md#protecting-deployed-project-addresses) · [HTTPS and ports](README.md#https-and-ports) · [Self-hosting gaps, item 5](../design/self-host-gaps.md)

## Why no OAuth locally?

Local mode exists so you can run Egg without an outside account. `pnpm run setup` writes `LOCAL_MODE=1` and a private `LOCAL_MODE_SECRET`; on your first visit you paste that recovery key and choose a password. Every local sign-in is the same owner, and Egg stores only a salted hash of the password. `APP_URL` must stay at `localhost`, `127.0.0.1` or `[::1]` unless you deliberately opt in with `LOCAL_MODE_ALLOW_REMOTE=1` behind your own access control.

Hack Club sign-in is optional, not missing. It needs an app registered at [Hack Club Auth](https://auth.hackclub.com/developer/apps) with client id and secret and a redirect URI of `<APP_URL>/api/auth/callback`. Do not set those values alongside local mode: anyone with a Hack Club account who can reach the site then gets an account, and the local owner cannot complete the fresh sign-in needed to turn on Terminal or File changes. The login page and the guide both warn about that mix.

Email and password sign-in cannot be turned on locally either. It needs an account that already has an email address and a fresh Hack Club sign-in; the local owner has neither, and the card is not shown. Development sign-in is another way in, but only under `pnpm dev` outside a production build. None of this affects deployments: sign-in decides who can use your Egg, not how apps reach your server.

Related: [How sign-in works](README.md#how-sign-in-works) · [Run without Hack Club](README.md#run-without-hack-club) · [Password sign-in needs Hack Club](README.md#password-sign-in-needs-hack-club) · [Backend setup](../backend-setup.md)

## How do backups work?

Everything Egg stores is in one SQLite file, `web/data/egg.db` by default: users, servers, sealed SSH keys, projects, deployments and logs. For a local install, stop Egg, copy that file and any `egg.db-wal` or `egg.db-shm` beside it, and keep `.env.local` in a separate place. The database holds encrypted keys that only `APP_SECRET` in that env file can open, so a copy of the database on its own cannot be restored into a working instance.

To restore, stop Egg, put the file back at the same path, and start with the matching `.env.local`. There is no restore script. If you changed `DATABASE_URL`, back up that path instead. Keep `LOCAL_MODE_SECRET` and the GitHub App private key with your env backup as well; they are not in the database.

On a server, `sh deploy/backup.sh` (or `pnpm run backup` from `web/`) makes a consistent copy while Egg runs, gzips it into `backups/` and keeps the newest 14; `BACKUP_KEEP` changes the count, and `EGG_DB` points at a custom host path. `sh deploy/upgrade.sh` backs up before it pulls and rebuilds. Neither flow copies deployed releases or the `shared/` folders on your deploy targets, so persistent data your apps write there needs its own backups.

Related: [Backups](README.md#backups) · [Setup B: Backup](README.md#backup) · [Updating](README.md#updating) · [Backend setup](../backend-setup.md)

## What needs Docker?

Nothing for a local install. The Egg machine runs Node.js 22.13 or newer, pnpm and Git; it clones your repository, packs the source and uploads it. Installs and builds run on the deploy target under a memory cap with `systemd-run`, or in GitHub Actions when the project is set up that way. There is no Docker build sandbox on the Egg machine.

Docker is only how setup B hosts Egg itself: Docker Compose runs the web app, the worker and Caddy on a Linux server, and Caddy provides HTTPS. No service in `compose.yaml` needs the Docker socket or extra privileges, and nothing is built inside that Compose stack. The worker still sends each project's source to its deploy target.

A project can opt into a Dockerfile or Docker Compose deployment mode. Those modes are capability-gated and need a working Docker engine on the **deploy target**, not on the Egg machine; the default native mode uses systemd and needs no Docker anywhere. A plain Linux target still has to meet the SSH, systemd, cgroup and free-disk requirements in the guide; the Docker modes do not remove those checks.

Related: [What you need on the Egg machine](README.md#what-you-need-on-the-egg-machine) · [Where builds run](README.md#where-builds-run) · [Setup B: on your own server](README.md#setup-b-on-your-own-server) · [Docker target foundation](../developers/docker-target-foundation.md)

## Can I run on Windows?

Yes, for a local install. Windows works, but it is not part of the automated checks; CI runs the typecheck, lint, tests and dependency audit on Linux and macOS. Install Node.js from nodejs.org, enable pnpm with `corepack enable` (in an administrator terminal if access is denied) and install Git for Windows. PowerShell or Git Bash both work, and `pnpm egg start` runs the doctor, builds once and opens the browser.

Start on login is available too. `pnpm run service:install` writes a PowerShell script and prints the command that registers a Scheduled Task named Egg; the log lands in `%LOCALAPPDATA%\Egg\egg.log`. To change a port for one command, set `$env:PORT = "4000"` before `pnpm start`, and rerun the service install so the task uses the new port. See [customising.md](customising.md) for every port Egg uses.

The stand-in server is the exception: `pnpm fake-nest` needs a WSL distribution named `Ubuntu`, or `TEST_WSL_DISTRO` set to the name of yours. It is only a trial tool. The Compose setup in the guide is for a Linux server, and a deploy target must be Linux with systemd; Windows is not a deploy target.

Related: [What works where](README.md#what-works-where) · [Start on login](README.md#start-on-login-optional) · [Try it with a stand-in server](README.md#try-it-with-a-stand-in-server) · [Ports](customising.md#ports)

## How do I upgrade?

Locally, stop Egg, take a backup, then run `git pull`, `pnpm install`, `pnpm build` and `pnpm start` from `web/`. Database changes are applied automatically the first time the new version opens the database. There is no downgrade path: migrations are not reversed, so keep the backup you made before the update.

On a server, run `sh deploy/upgrade.sh`. Start the app first: the script inspects the running app to find its database, verifies a file database under `/data`, backs it up, then pulls, rebuilds and restarts. If it cannot verify and back up that file, it stops rather than upgrading blind.

For a busy instance, you can hold traffic with a maintenance window while you upgrade. Wait for jobs already underway, take a verified backup, and remember that GitHub webhook deliveries are refused during maintenance and GitHub does not redeliver failed deliveries automatically. After the window, redeliver them from the App's recent deliveries or trigger the deploy from Egg.

Related: [Updating](README.md#updating) · [Backups](README.md#backups) · [Setup B: Upgrade](README.md#upgrade) · [Instance administration and maintenance](README.md#instance-administration-and-maintenance)

## What data leaves my server?

A copy you run has no central Egg service to report to. There is no telemetry or tracking of your Egg use; the database, deployment work and the optional page analytics for sites you deploy all stay on systems you chose. Page analytics are off until you enable them for a project, respect Do Not Track and Global Privacy Control, set no cookie, and are stored in your database, not sent to a third party.

Outbound requests happen only for features you use. Egg talks to GitHub for sign-in, repository information, cloning and push webhooks; to Hack Club Auth if you set it up; and over SSH to the deploy target you connected, carrying source, environment variables and service commands. Discord, Slack or a custom webhook receives deployment notices only if you configured it. The Domains page checks DNS and your own domain over HTTPS, the Nest status page reads Hack Club's status page, and builds on the target may download dependencies from package registries.

What stays local includes the SSH private keys and environment variable values, sealed in the database with `APP_SECRET`, and the build logs, which mask known secrets. Local mode has no outside account at all. Your hosting provider, reverse proxy, container runtime and backup storage can still keep their own logs; those are outside Egg's control, so read their policies along with the [privacy page](<../../web/src/app/(marketing)/privacy/page.tsx>) and [security page](<../../web/src/app/(marketing)/security/page.tsx>).

Related: [Where data goes](<../../web/src/app/(marketing)/privacy/page.tsx>) · [Network from builds](../backend-setup.md) · [What is logged and what is not](<../../web/src/app/(marketing)/security/page.tsx>) · [Security notes](README.md#security-notes)
