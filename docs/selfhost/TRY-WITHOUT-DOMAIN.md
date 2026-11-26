# Try Egg without a domain

You can try Egg at an address that looks like a domain without buying a domain or adding a DNS record. [nip.io](https://nip.io/) and [sslip.io](https://sslip.io/) are wildcard DNS services: a name such as `127.0.0.1.nip.io` resolves to the IP written in its label. They host nothing and issue no certificates. Egg still runs on your own computer, and you still sign in with the local password from the private `.env.local`.

This is a way to see the dashboard, a public webhook address and a deploy before you commit to a domain. It is not a production setup: the address is plain `http`, and the host name is one anyone can construct.

The commands below are checked against `web/package.json`, `web/scripts/` and the settings read by `web/src/server/config.ts`. The wildcard DNS services themselves, router port forwarding and GitHub's current form rules were not exercised, so confirm the host name and GitHub's acceptance of an `http` callback on the day you try it.

Back to the [self-hosting guide](README.md). For ports, colours and build limits, see [customising.md](customising.md).

## What works and what does not

| Works at a `nip.io` / `sslip.io` address | Note |
| --- | --- |
| Signing in as the local owner | Needs `LOCAL_MODE_ALLOW_REMOTE=1`; see step 2. |
| Projects, public repositories by URL, the Deploy button, deploy hooks and the CLI | All local to your machine. |
| A stand-in server with `pnpm fake-nest` | No Nest account needed. On Windows it needs WSL; see [the self-hosting guide](README.md#try-it-with-a-stand-in-server). |
| A public address for the GitHub webhook, if you use the public-IP form | Requires a port forward to your computer. Pushes, PR previews and repository rename events then work. |

| Does not work | Why |
| --- | --- |
| HTTPS with a trusted certificate | These services provide DNS only. Locally you serve `http://`, so there is no padlock and no certificate to renew. |
| Staying signed in from a production build | The session cookie is `Secure` when `NODE_ENV=production` (`web/src/server/auth/session.ts`), and browsers refuse a `Secure` cookie sent over plain `http` on a name that is not literally `localhost`. Use `pnpm egg start --dev` for the trial, or move to HTTPS. |
| A status page on its own domain | `statusUrl()` builds the page address as `<APP_URL>/status/<key>` (`web/src/server/status-page.ts`). There is no separate host setting for a status page; `APP_HOST` is read by Compose and Caddy, not by Egg. The address follows `APP_URL`, so it is an `http` `nip.io` link until you change `APP_URL`. |
| Custom domains for deployed apps | The Domains page checks for a CNAME to `<username>.hackclub.app` or a TXT record `domain-verification=<username>`. With no DNS records a domain stays **Waiting for DNS**, and on a server that is not Nest those checks cannot pass at all. Egg installs no proxy or certificate for deployed apps (see [self-host-gaps.md](../design/self-host-gaps.md)). |
| Push deploys from a loopback address | GitHub resolves `127.0.0.1.nip.io` on GitHub's own machines, not on yours. Use the public-IP form or leave pushes out. |
| A private sign-in form | `LOCAL_MODE_ALLOW_REMOTE=1` opens the form to anyone who can reach the address. The recovery key and password protect the account, not the form. Add your own access control if the address is reachable from outside. |

Egg's trial-host classifier (`web/src/server/no-domain.ts`) names three things a local trial address rules out: **HTTPS certificates**, **custom domains** and the **public status page host**. Those match three of the rows above; the rest of this guide explains what to do instead.

## Before you start

You need what setup A needs: Node.js 22.13 or newer, pnpm (`corepack enable`) and Git. You do not need Docker on the computer running Egg. See [What you need on the Egg machine](README.md#what-you-need-on-the-egg-machine).

Pick one of two host names:

| Host name | Resolves to | What it is for |
| --- | --- | --- |
| `127.0.0.1.nip.io` or `127.0.0.1.sslip.io` | `127.0.0.1` | Trying the dashboard on this computer only. Nothing to forward. |
| `<your-public-ip>.nip.io` or `<your-public-ip>.sslip.io` | Your public IP | Letting GitHub reach a webhook. You must forward the port to your computer and allow it through your firewall. |

The dashed form (`127-0-0-1.nip.io`) and `localhost.nip.io` also resolve to loopback and are recognised as trial host names by `web/src/server/no-domain.ts`. Any other label under those suffixes is a real name, not a stand-in for yours.

Check the name before you use it:

```bash
nslookup 127.0.0.1.nip.io
```

Both forms need `LOCAL_MODE_ALLOW_REMOTE=1`, even the loopback one: Egg's loopback check accepts only the literal `localhost`, an address starting `127.` and `::1` (`isLoopbackHost` in `web/src/server/config.ts`). A `nip.io` host name is treated as remote whatever it resolves to.

## 1. Install and create the settings file

Run from the repository root, then in `web/`:

```bash
git clone https://github.com/jeremy341/egg.git
cd egg/web
pnpm install
pnpm run setup
```

Type `pnpm run setup`, not `pnpm setup`; the latter is a different pnpm command. Setup writes `web/.env.local` with a fresh `APP_SECRET`, a separate `LOCAL_MODE_SECRET` recovery key, `APP_URL=http://localhost:3000` and `LOCAL_MODE=1`, and never overwrites an existing file. Keep it private. If you already have a file, do not replace its secrets.

## 2. Set the stand-in address

Edit `web/.env.local` and replace the setup `APP_URL` line with the host name you chose. Keep the port in the address:

```
APP_URL=http://127.0.0.1.nip.io:3000
LOCAL_MODE=1
LOCAL_MODE_ALLOW_REMOTE=1
```

Keep the existing `LOCAL_MODE_SECRET` and `APP_SECRET` lines. Leave `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET` empty. Egg now refuses to start with local mode and Hack Club credentials together (`LOCAL_MODE cannot be combined with Hack Club credentials`), because a Hack Club account is a different account from the local owner and the owner cannot turn on Terminal or File changes (see [Confirming again](README.md#confirming-again-reauth)).

Why the override is needed: without `LOCAL_MODE_ALLOW_REMOTE=1`, Egg refuses to start with

```
LOCAL_MODE: LOCAL_MODE signs anyone in as the owner, so APP_URL must be localhost or 127.0.0.1.
```

and the doctor adds a cross with `LOCAL_MODE needs APP_URL to be localhost or 127.0.0.1`. The doctor and the app read the same rule, in `web/src/server/config.ts` and `web/scripts/doctor-checks.mjs`.

One consequence worth knowing: the `pnpm dev` and `pnpm start` scripts bind to `127.0.0.1` explicitly, and `pnpm egg start` does the same when `APP_URL` is local. A remote-looking host name such as `127.0.0.1.nip.io` makes `pnpm egg start --dev` listen on all interfaces instead (`resolveServer` in `web/scripts/doctor-checks.mjs`). On the public-IP form, anyone who can reach the port can reach the login page. Stop the server or firewall the port when you are done.

## 3. Start in development mode

```bash
cd web
pnpm egg start --dev
```

Use `--dev`, not `pnpm egg start`. In a production build the session cookie carries the `Secure` flag; a browser will not keep that cookie over plain `http` at a `nip.io` host name, so you are sent back to login on every reload. The development server does not set the flag. It also skips the build. If you have changed settings, stop Egg with Ctrl+C and start it again.

## 4. Sign in and try it

Open <http://127.0.0.1.nip.io:3000/login> — the exact address in `APP_URL`. On the first visit, paste the value of `LOCAL_MODE_SECRET` from `.env.local` as the recovery key and choose a password of at least 12 characters. Afterwards, enter that password. You land on Projects as the owner.

Use this address rather than `http://localhost:3000`: the same-origin check on writes compares the browser's `Origin` with `APP_URL` (`web/src/server/http.ts`), so mixing the two addresses makes writes fail with `Cross-origin request blocked`.

From here you can import a public repository by URL, connect a server or run `pnpm fake-nest` in a second terminal, and press **Deploy**. For the GitHub App, the callback and setup URLs are `<APP_URL>/api/github/callback` and the webhook URL is `<APP_URL>/api/webhooks/github`; they only work when GitHub can reach that address. GitHub may refuse a plain-`http` callback for a non-localhost name, so check the App form. If pushes are out of reach, deploy with the **Deploy** button, a deploy hook or the CLI instead; see [Webhooks need an address GitHub can reach](README.md#webhooks-need-an-address-github-can-reach).

### Check it works

Run these from `web/` after the server starts:

```bash
pnpm run doctor
curl -I http://127.0.0.1.nip.io:3000/login
```

The doctor should show no cross (`✗`). A warning (`!`) about local mode is expected. `curl` should return `HTTP/1.1 200 OK`. Then sign in, reload `/projects`, and confirm you stay signed in: if you land back on `/login`, you are running a production build over plain `http` and need `pnpm egg start --dev` or HTTPS.

## Move to a real domain later

1. **Keep the data.** Everything is in `web/data/egg.db`, and the credentials that unlock it are in `web/.env.local`. Do not regenerate `APP_SECRET`: it unseals every stored SSH key and environment value. Status page keys are stored in the database, but their URLs are built from `APP_URL` when they are read, so no data migration is needed for a new address. See [Backups](README.md#backups).
2. **Point the domain at the server.** Add an A or AAAA record for the host you will use and open ports 80 and 443. Caddy gets and renews the certificate; it needs the DNS record to exist first (see `deploy/Caddyfile`).
3. **Change the settings next to `compose.yaml`**, in `.env`:

   ```
   APP_URL=https://egg.example.com
   APP_HOST=egg.example.com
   APP_SECRET=<the same value you used locally>
   ```

   `APP_HOST` is the host name without `https://`; it is read by Compose and Caddy, not by Egg. Put no comment after a value on the same line.
4. **Choose how people sign in.** If you keep local mode, carry `LOCAL_MODE_SECRET` over from `.env.local`, keep `LOCAL_MODE=1` and set `LOCAL_MODE_ALLOW_REMOTE=1` only behind a VPN or access proxy you control: on a public address that setting puts the sign-in form on the internet. If you use Hack Club sign-in instead, set both Hack Club keys and remove `LOCAL_MODE=1`; do not run the two together. See [Sign-in on a server](README.md#sign-in-on-a-server).
5. **Start the server:**

   ```bash
   docker compose up -d --build
   ```

   Only Caddy is published, on 80 and 443. Set `TRUST_PROXY=1` because every request then reaches Egg through it; see [HTTPS and ports](README.md#https-and-ports).
6. **Update the GitHub App.** Change the callback, setup and webhook addresses to the new `https://` value of `APP_URL`. If deliveries failed while you were away, redeliver them from the App's recent deliveries list: GitHub does not resend them by itself.
7. **Update bookmarks and status page links** from the old `nip.io` address to the new domain. The status pages themselves keep working at `<new APP_URL>/status/<key>`.
8. **Custom domains for deployed apps are a separate step.** On Nest, add the CNAME or TXT record Egg shows, then map the domain to the app's port in the Nest dashboard. On a server you own, Egg installs no reverse proxy or certificate for apps; add one yourself. See [What is Nest specific](README.md#what-is-nest-specific) and [self-host-gaps.md](../design/self-host-gaps.md).

If you want HTTPS before you own a domain, a tunnel that terminates TLS is the other route. Egg does not include a tunnel, and the [self-hosting guide](README.md#webhooks-need-an-address-github-can-reach) did not test one. Keep the sign-in address private whichever route you choose.

## Troubleshooting

| You see | Why | Fix |
| --- | --- | --- |
| `LOCAL_MODE: LOCAL_MODE signs anyone in as the owner, so APP_URL must be localhost or 127.0.0.1.` | `APP_URL` is a `nip.io` / `sslip.io` name; Egg only accepts the literal `localhost`, `127.x.x.x` and `::1` as local. | Add `LOCAL_MODE_ALLOW_REMOTE=1` to `web/.env.local` and restart, or set `APP_URL=http://localhost:3000`. |
| Doctor: `✗ Sign-in: LOCAL_MODE needs APP_URL to be localhost or 127.0.0.1` | The doctor applies the same check before the app starts. | Same as above; `pnpm run doctor` should then show only a warning for sign-in. |
| The page loads at `localhost` but not at the stand-in host name | The name resolves elsewhere, the port is not forwarded, or a firewall drops it. | Run `nslookup 127.0.0.1.nip.io` and `curl -I http://127.0.0.1.nip.io:3000/login`; for the public-IP form, forward the port in `APP_URL` to your computer. |
| You are sent back to `/login` after every sign-in | A production build sets the `Secure` cookie flag, which a browser will not keep over plain `http` at a non-localhost host name. | Use `pnpm egg start --dev` for the trial, or move to HTTPS with a real domain. |
| Writes fail with `Cross-origin request blocked` (403) | The browser address differs from `APP_URL` (for example `localhost` versus the `nip.io` name, or a different port). | Open exactly the address in `APP_URL`, including the port, and restart after editing it. |
| GitHub push deliveries fail and nothing deploys | GitHub cannot reach a loopback name, the public port is closed, or the App's Webhook URL is wrong. | Use `<public-ip>.nip.io` with a port forward and set the Webhook URL to `<APP_URL>/api/webhooks/github`; otherwise deploy by button, hook or CLI and redeliver from GitHub. |
| A domain on the Domains page stays **Waiting for DNS** or says `No CNAME found yet` | Egg expects a CNAME to `<username>.hackclub.app` or a TXT record `domain-verification=<username>`. No records were added for this trial. | Add the record at your DNS provider and press **Check**, or remove the domain. On your own server these Nest checks cannot pass. |
| A status page link shows `http://…nip.io:3000/status/<key>` | The URL is built from `APP_URL`; there is no separate status page host. | Expected at a stand-in address. Change `APP_URL` to the HTTPS domain later; the key keeps working. |
| `Port 3000 is already in use` | Another Egg, `fake-nest` or an unrelated program holds the port from `APP_URL`. | Stop that program or change the port in `APP_URL`, then restart; see [Troubleshooting local and self-hosted Egg](TROUBLESHOOTING.md). |
| Strangers can open the login page | `LOCAL_MODE_ALLOW_REMOTE=1` exposes the form at an address anyone can construct. | Stop Egg, firewall the port or put it behind a VPN/access proxy; for a private trial set `APP_URL=http://localhost:3000`. |

## Related resources

- [Run Egg yourself](README.md) — the full self-hosting guide, settings table and security notes.
- [Before you open Egg beyond localhost](README.md#before-you-open-egg-beyond-localhost) — what to secure once the address is reachable.
- [Finish setup after first boot](FINISHING-SETUP.md) — password, server, permissions, backups and status page.
- [Troubleshooting local and self-hosted Egg](TROUBLESHOOTING.md) — symptom, cause, exact fix and caution for common failures.
- [Set up the GitHub App](README.md#set-up-the-github-app) and [Webhooks need an address GitHub can reach](README.md#webhooks-need-an-address-github-can-reach).
- [Try it with a stand-in server](README.md#try-it-with-a-stand-in-server) — deploy without a Nest account.
- [Customising Egg](customising.md) — change ports, name, colours and build limits.
- [Known self-hosting gaps](../design/self-host-gaps.md) — why custom domains and app TLS are tied to Nest.
- [Status page reference](../design/feature-inventory.md#status-page) — what the public page shows.
- [Backend setup](../backend-setup.md) — Hack Club Auth and the GitHub App in detail.
