# Self-hosting gaps for people who are not in Hack Club

Findings only. Nothing here is implemented. Written 2026-11-14 from the code in the working tree. Each item has the evidence (file and line) and a rough size: small (hours), medium (days), large (a week or more). Paths are relative to `web/src` unless they start with `deploy/` or `compose.yaml`.

"Not tested" means the code reads as if it would work but nobody has run it on that host.

## Ranked list

### 1. Only one account without Hack Club (medium to large)

Without Hack Club, a production instance has exactly one account, the local owner. There is no sign-up, no invitation to join an instance, and no other provider.

- The only code that creates a user is `upsertUser` (`server/auth/session.ts:17`), called from the Hack Club callback (`app/api/auth/callback/route.ts:57`), the development sign-in (`app/api/auth/dev/route.ts:35`, disabled in production), and the local sign-in with the fixed id `local:owner` (`app/api/auth/local/route.ts:18`, `:72`, `:85`).
- There is no other provider. `server/auth/hackclub.ts:4` hard-codes `https://auth.hackclub.com`.
- Projects are single-owner. Project collaboration (members, invitations and roles) was removed on 2026-11-22, so there are no member/invitation routes any more.

Effect: a family, class or team cannot share one instance unless every member has a Hack Club account, and Egg has no project-level sharing. Workaround: one Egg per person, or Hack Club Auth.

### 2. Email and password sign-in cannot be turned on without Hack Club (medium)

- Turning it on needs a fresh Hack Club sign-in: `app/api/account/password/route.ts:56-62` (`requireFreshSignIn`), used at `:82` and `:89`.
- The local owner is refused outright (`:74`), and a development account has no email (`:48`, `:81`).
- So the only people who can use it already signed in with Hack Club. A person cannot create an email and password account on their own instance.

### 3. "Confirm again" breaks if Hack Club and local mode are both on (small)

- `app/api/auth/reauth/route.ts:25-33`: when Hack Club is set up, the local owner is sent to Hack Club. The callback accepts only the same Hack Club account (`app/api/auth/callback/route.ts:49`) and otherwise redirects to `/account?reauth=mismatch`.
- Nothing reads `reauth` on the account page, so there is no message. The Terminal and File changes switches stay off and the owner is not told why.
- The older guidance to run both sign-in methods side by side is therefore wrong for the owner. The guide now says not to mix them. Fix: skip or replace the confirmation for `local:` users when both are on, and show the `reauth` result.
- The same silence applies to `?reauth=not_configured` when nothing is set up (`reauth/route.ts:32`).

### 4. The deploy target is assumed to be a Nest container (large)

Written as plain SSH, so a Linux server may work, but the assumptions are Nest's and nothing was tested elsewhere.

- Root and system units: units go to `/etc/systemd/system` and `systemctl` runs without `sudo` (`server/config.ts:64`, `server/deploy/layout.ts:7`, `server/deploy/remote.ts`). A non-root SSH user only gets a warning, "SSH did not log in as root. Nest normally does; without root, installing the service files may fail." (`server/ssh/probe.ts:111`).
- systemd must be the running system manager; otherwise deploys are blocked (`server/ssh/probe.ts:99-105`). A plain container, or a host without cgroup v2 and the memory controller, cannot build (`server/deploy/container-probe.ts:130-146`).
- One host and port setting for all new servers (`NEST_HOST`, `NEST_PORT`, `server/config.ts:66-67`, used at `server/servers.ts:119`, `:138`). Per-server host is stored, but the form has no host field: you must change the environment before adding each server.
- The connect form is labeled "Nest username" and the key instructions say to paste it into the Nest dashboard (`components/connect-flow.tsx:223-231`, `:333`). On another host the key has to go to `authorized_keys` by hand.
- The server is labeled `<username>.hackclub.app` regardless of host (`components/connect-flow.tsx:141`, `:242`; `components/new-project-flow.tsx:326`; `server/cleanup.ts:124`, `:168`; `server/terminal.ts:627`). Only `server/inventory.ts:397` checks the host first.
- The ports for previews (20000 to 29999) and the "Map your domain to this port in the Nest dashboard" message (`server/deploy/pipeline.ts:652`) are written for Nest's proxy.

### 5. No public address or TLS for deployed apps on a plain server (large)

On Nest, a domain is mapped to a port in the Nest dashboard. Egg has no equivalent on its own.

- Egg does not install a reverse proxy, request a certificate or open a firewall port for an app. Each app listens on `0.0.0.0` on its port (`server/deploy/remote.ts:146`), so on a public VPS it is open on plain http until the owner adds a proxy and blocks the port.
- The Domains page is Nest's rules: it checks DNS for a CNAME to `<username>.hackclub.app` or a TXT `domain-verification=<username>` (`server/domains.ts:42-49`, `:245-290`), refuses names under `hackclub.app` except the owner's (`server/domain-policy.ts:141-142`), and so cannot show a custom domain as active for a non-Nest server. The onboarding tour step also sends the person to the Nest dashboard (`lib/onboarding.ts:167`).
- A provider-neutral "address" step (proxy config for Caddy or nginx, plus an A record check) would be new work.

### 6. The GitHub App needs a public URL for pushes, and has no guided setup (medium)

- GitHub must open `<APP_URL>/api/webhooks/github` to deliver pushes (`app/api/webhooks/github/route.ts`). On `localhost` there are no push deploys, no pull request previews and no repository rename updates. A tunnel is the workaround; Egg has none built in, and a tunnel exposes the whole site.
- GitHub is treated as set up only when all of the App ID, private key, client id, client secret and webhook secret are non-empty (`server/config.ts:129-138`). The webhook secret is useless on localhost but still required.
- `scripts/create-github-app.mjs` makes the App from a manifest but is undocumented elsewhere, reads `APP_URL` from `web/.env.local` (setup writes `http://localhost:3000`), falling back to `http://localhost:3100` only when neither is set, leaves the webhook secret empty (no `hook_attributes`, line 28 comment) and writes `GITHUB_WEBHOOK_SECRET=` blank (`:114`). Following it unchanged leaves GitHub "not configured".
- Only `github.com` repositories can be cloned (`server/deploy/build.ts:66-83`). No GitLab, Gitea or other git hosts, and no git over SSH.
- The callback and setup URLs are followed by the person's own browser, so they work on localhost. Only the webhook needs a public address.

### 7. Hack Club account needed for the safe-switch confirmation (small)

Related to 3: with Hack Club absent and local mode off, Terminal and File changes can never be turned on (`app/api/auth/reauth/route.ts:32`). It works only through local mode or the development sign-in outside production.

### 8. Single operator model for administration (small to medium)

- The administrator is one account id in `SECURITY_REPORT_ADMIN_ID` (`server/admin-identity.ts:3`). With local mode the id is the database id of the owner, which the person has to look up at `/api/me`.
- The same variable also controls the private vulnerability inbox, which is aimed at Egg's own public instance and not at a private copy.

### 9. Static dependencies on Hack Club services in the interface (small)

- The public Nest status page and banner (`server/nest-status.ts`, `server/nest-official.ts:10-11`) read `status.hackclub.app`, which says nothing about another server.
- Reserved names and suffix rules are copied from `hackclub/nest` (`server/domain-policy.ts:2`).
- With nothing set up, the login page shows a disabled "Continue with Hack Club" button (`app/(auth)/login/page.tsx:186-193`), so a stranger sees Hack Club as the only option until they read the note under it.

### 10. Worker and database on one machine (large, only for scale)

- SQLite in one file, one process (`server/config.ts:34`). Fine for one person. A second Egg machine cannot share the database. Not a gap for the stated goal, listed for completeness.
- A stale worker lease needs a manual database edit to recover (`docs/selfhost/README.md`, "Recovering a stale deployment"). That is deliberate (a remote SSH command may still run) but unfriendly for a first-time self-hoster.

## What is not a gap

- No Docker is needed on the Egg machine; builds run on the target (`compose.yaml` comment, `deploy/Dockerfile`).
- Backups and upgrades are scripted (`deploy/backup.sh`, `deploy/upgrade.sh`).
- Local mode, the doctor, start on login and `fake-nest` work without any outside account (`scripts/`).

## Suggested order

1. Items 2 and 3 first: they are small and remove the only confusing dead ends for a local owner.
2. Item 1, with a plain "create a user" path for an instance owner so more than one person can sign in.
3. Item 6: a documented, tested path for the GitHub App, and a way to run without a webhook secret on localhost.
4. Items 4 and 5 together, as a "plain Linux server" target: a host field, a key-install message that is not Nest's, and an address step that writes a proxy snippet.
