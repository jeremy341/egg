# Egg feature inventory

A working document for writers. Every statement was checked against the code in `web/src` and `web/drizzle`. Paths are relative to `web/src` unless they start with `web/`. A reference such as `server/projects.ts:241` means that file, that line, as of this writing.

Conventions used below:

- "Label" is the text copied from the source: a button, a heading, or a field label.
- "Needs" says whether the feature needs a container permission switch, a sign-in, a token scope, or nothing, and the default.
- "UNCONFIRMED" marks anything the code does not settle, with the reason.
- "Sign-in" means a Hack Club session cookie (`egg_session`, 30 days, `server/auth/session.ts:5-7`). API calls and the MCP endpoint use a bearer token instead and never read cookies (`server/api-v1-http.ts:6-10`).
- Every browser write route checks that the `Origin` header matches the site (`server/http.ts:79-89`). A request with no `Origin` header passes. The hook, collector, API and MCP routes skip this check on purpose.
- The three container permission switches are Terminal, File changes and Removing leftovers. All three are off for a new server (`server/db/schema.ts:85-87`).

Shared rate limits (per signed-in user, per minute, in memory, reset on restart): terminal input 300, file changes 60, leftover removals 10 (`server/rate-limit.ts:65-69`). Per token: 120 reads, 30 changes, 10 for anything that opens an SSH session, 300 for terminal input (`server/api-v1-kit.ts:24-29`).

---

## Sign-in and account

### Log in to Egg (Continue with Hack Club)

- **Label:** page heading "Log in to Egg"; button "Continue with Hack Club" (`app/(auth)/login/page.tsx:96-123`).
- **What it does:** signs you in with Hack Club Auth (OAuth with PKCE) and creates a session. Hack Club only confirms who you are; the scopes asked for are `openid`, `profile`, `email` (`server/auth/hackclub.ts:12`).
- **Steps:** open the login page, press Continue with Hack Club, approve at Hack Club, land on Projects (`app/api/auth/callback/route.ts`).
- **Limits:** session lasts 30 days (`server/auth/session.ts:7`). The sign-in handshake cookie lasts 10 minutes (`app/api/auth/login/route.ts`, `maxAge: 600`). Only a hash of the session token is stored (`session.ts:57-73`). Expired sessions are deleted whenever a new session is created (`session.ts:72`).
- **Errors (login page text, `login/page.tsx:16-22`):**
  - "Hack Club sign-in is not set up on this installation yet." The button is disabled. Self-hosters must set `HACKCLUB_CLIENT_ID` and `HACKCLUB_CLIENT_SECRET`.
  - "You did not approve the sign-in. Try again when you are ready."
  - "That sign-in link was not valid. Please try again."
  - "The sign-in took too long or came from another browser. Please try again." Start again from the login page, in one browser, within 10 minutes.
  - "Hack Club could not sign you in. Please try again in a moment."
  - Anything else: "Something went wrong signing in."
- **Needs:** nothing.
- **Dev only:** a "Development sign-in" form with a "Sign in" button appears only when `DEV_LOGIN` is on and the build is not production (`login/page.tsx:134-150`, `server/config.ts:21`).
- **Files:** `app/(auth)/login/page.tsx`, `app/api/auth/{login,callback,logout,reauth,dev}/route.ts`, `server/auth/{hackclub,session,current}.ts`.

### Sign out

- **What it does:** deletes the current session and closes every terminal the account has open, with reason "signed-out" (`app/api/auth/logout/route.ts`).
- **Files:** `app/api/auth/logout/route.ts`, `components/user-menu.tsx` (the "Account menu").

### Confirm with Hack Club again (fresh sign-in)

- **What it does:** a second Hack Club sign-in that marks the current session as "fresh". Needed only to turn the Terminal or File changes switch on.
- **Steps:** flip the switch on in Account. The browser goes to `/api/auth/reauth?next=...`, then Hack Club, then back to `/account?turn=<switch>&server=<id>#container-permissions-heading`, where the switch is applied (`components/container-permissions.tsx:187-203`, `app/api/auth/reauth/route.ts`).
- **Limits:** fresh means within 5 minutes (`REAUTH_WINDOW_MS`, `server/auth/session.ts:117`). The same Hack Club account must sign in, or the callback sends you back to `/account?reauth=mismatch` (`app/api/auth/callback/route.ts`). Recorded in Activity as "Confirmed sign-in with Hack Club" (`auth.reauth`).
- **Errors:** the API answers 403 "Confirm with Hack Club first. Turning this on needs a sign-in in the last 5 minutes." (`app/api/servers/[id]/permissions/route.ts:38-42`).
- **UNCONFIRMED:** the redirect values `/account?reauth=not_configured` and `?reauth=mismatch` or `?reauth=denied` are set by the server, but no page reads a `reauth` query parameter (grep finds none), so the person sees no message. The switch simply stays off.
- **Needs:** sign-in. Turning a switch off never needs it.

### Account page

- **Label:** heading "Account"; cards "Profile", "GitHub", "Container permissions", "Signed-in browsers", "Delete Account" (`app/(app)/account/page.tsx`, `components/account-view.tsx`).
- **Profile:** Name and Email (shows "Not shared" when none). Read-only; "This comes from your Hack Club account. Change it there."
- **GitHub:** lists the accounts where the Egg GitHub App is installed, each with a "Manage on GitHub" link to `https://github.com/settings/installations/<id>`. Empty text: "Not connected yet. Import a project to install the app."
- **Signed-in browsers:** each session shows a label such as "Chrome on Windows" and "Signed in <time ago>". The current one has a "This browser" badge. Others have a "Sign out" button. "Sign out everywhere else" appears when other sessions exist.
  - Errors: "That is the session you are using. Sign out instead." (`server/account.ts:39`); "Session not found" (404); client fallbacks "Could not sign that browser out" and "Could not sign the others out".
  - Signing out other sessions closes every open terminal of the account (`server/account.ts:48,60`).
- **Delete Account:** type your name exactly, then press "Delete account". Deletes your projects, servers, domains, keys, tokens, sessions and your activity rows; apps already on the container keep running (`server/account.ts:103-112`). Terminals are closed first.
  - Error: "Type your name exactly to confirm." (400). Comparison trims whitespace only.
- **Needs:** sign-in.

---

## Servers (Connect a Nest server)

### Add a server (Create key)

- **Label:** page "Connect a Nest server"; card "Add your server" (or "Add another server"); field "Nest username"; button "Create key" (`components/connect-flow.tsx:278-343`).
- **What it does:** makes a dedicated ed25519 SSH key for one Nest account. The public key is shown to paste into the Nest dashboard. The private key is sealed with AES-256-GCM (key derived from `APP_SECRET`, bound to `server:<id>`) before it is stored and is never shown (`server/servers.ts:73-110`, `server/crypto.ts:32-39`).
- **Steps:**
  1. Enter your Nest username.
  2. Press Create key.
  3. Copy the "Public key" field and paste it on the SSH Keys page of the Nest dashboard ("Open the Nest dashboard" link goes to `https://dashboard.hackclub.app`).
  4. Press "Test connection".
- **Status words:** "Waiting for the key" (pending), "Connected", "Could not connect" (`connect-flow.tsx:128-138`).
- **Limits:** at most 5 servers per account (`MAX_SERVERS_PER_USER`, `server/servers.ts:18`). Username must match `^[a-z0-9][a-z0-9._-]{0,31}$`, case-insensitive (`servers.ts:20`). One server per Nest username per account (unique index `servers_user_nest_idx`, `schema.ts:97`). The host is `hackclub.app` port 22 unless `NEST_HOST` and `NEST_PORT` are set (`server/config.ts:39-41`).
- **Errors:**
  - "That does not look like a Nest username. Use the name you log in with, for example sam-r." (400)
  - "You can connect up to 5 servers." (400)
  - "<name> is already connected." (409)
- **Warning shown on the page:** "This key gives Egg the same access as your own login, because SSH into Nest lands in a root shell inside your container. Only connect a container you are happy to deploy to."
- **Needs:** sign-in.
- **Files:** `components/connect-flow.tsx`, `app/(app)/connect/page.tsx`, `app/api/servers/route.ts`, `server/servers.ts`, `server/ssh/keys.ts`, `server/crypto.ts`.

### Test connection (host key and capability check)

- **Label:** button "Test connection" (busy text "Connecting…"). Success heading "Reached your container" with rows System, Logged in as, Node.js, Python, systemd, Key fingerprint (`connect-flow.tsx:142-147,204-239`).
- **What it does:** opens an SSH session with the stored key, records the host key on the first success (trust on first use), runs one probe script, and saves status, probe and time (`server/servers.ts:171-203`).
- **Host key:** the SHA-256 fingerprint of the Nest bastion is pinned the first time a test succeeds. After that, any other host key aborts the connection before anything is sent (`server/ssh/connection.ts:104-125`). Rotating the key does not clear the pin (`servers.ts:113-130`).
- **Probe contents:** user id, OS, architecture, home folder, which of systemctl, node, npm, python3, tar, curl, git, sha256sum exist, Node and Python versions, CPU count, memory, disk, load, systemd state (`server/ssh/probe.ts:35-51`). 30 second timeout (`probe.ts:92`). Connect timeout is 20 seconds (`connection.ts:98`).
- **Issues listed after a test** (`probe.ts:102-151`):
  - error: "systemd is not available in this container, so Egg cannot keep your apps running or restart them."
  - warning: "SSH did not log in as root. Nest normally does; without root, installing the service files may fail."
  - error: "tar is not installed."
  - warning: "sha256sum is missing, so uploads cannot be verified."
  - warning: "curl is missing. Health checks fall back to a plain TCP connection check."
  - warning: "Neither Node.js nor Python 3 is installed. Only projects that ship their own binary can run."
  - warning: "Only N MB of disk is free. Releases are kept for rollback, so deploys may fail." (under 1024 MB free)
  - The comment at `probe.ts:98-100` says errors block deploying. No code enforces that: `probeIssues` is only called for display (`servers.ts:46,179`). A deploy is not blocked by these.
- **Errors (saved as the server's last error and shown in a red alert; `connection.ts:46-125`):**
  - "Nest rejected the key. Check that you pasted the public key on the SSH Keys page of the Nest dashboard, and that the username is exactly your Nest username." Paste the key again, check the username.
  - "Timed out connecting to Nest. Your container may be stopped or starting; try again in a minute."
  - "Could not reach the Nest SSH host (<reason>)."
  - "The host key of <host> changed (was <old>, now <new>). Nothing was sent. If you expected this, reconnect the server." The only way to clear a pin is Disconnect, then add the server again (see the cascade note below).
  - "SSH error: <message>" for anything else.
  - "Could not run the test" is the browser fallback.
- **Needs:** sign-in.
- **Files:** `server/servers.ts`, `server/ssh/{connection,probe}.ts`, `app/api/servers/[id]/test/route.ts`.

### New key (rotate the key)

- **Label:** button "New key"; dialog "Generate a new key?"; text "The old key stops working once you remove it in the Nest dashboard, and you must add the new one."; confirm "Generate key" (`connect-flow.tsx:149-160`).
- **What it does:** replaces the key pair, sets status to pending, clears the saved probe and error, keeps the pinned host key, and records "Replaced the SSH key for <server>" (`server/servers.ts:113-130`).
- **Steps:** New key, Generate key, paste the new public key in the Nest dashboard, Test connection.
- **Note:** the existing docs call this "Rotate key". The label in the product is "New key".
- **Needs:** sign-in.

### Disconnect

- **Label:** button "Disconnect"; dialog "Disconnect <name>?"; text "Your running apps are not touched. Remove the key from the Nest dashboard to end our access."; confirm "Disconnect" (`connect-flow.tsx:161-173`).
- **What it does:** deletes the server record (`server/servers.ts:132-136`). Because projects, domains and usage samples reference the server with `ON DELETE CASCADE` (`schema.ts:121-123,290-292`) and SQLite foreign keys are on (`server/db/index.ts:25`), every project on that server is deleted from Egg too, with its deployments, logs, environment variables, hook and status page. Nothing is removed from the container. The dialog does not say projects are deleted.
- **Note:** the existing docs call this "Remove a server". The label is "Disconnect".
- **Needs:** sign-in.

### Container usage reading

- **Where:** Projects page card "UsageCard" and the project page card "Container" show CPU load, memory and disk from the last probe. "No reading yet. Press Test connection on the Connect page." when none (`components/usage-card.tsx:71`). Only the first connected server is shown on the Projects page (`app/(app)/projects/page.tsx:95,193`).
- **API:** `GET /api/servers/[id]/usage` runs a fresh probe and saves it (`server/runtime-info.ts:80-89`).

---

## Container permissions

Defaults and enforcement: `server/permissions.ts`, `lib/container-permissions.ts`, `server/permission-guards.ts`. The server checks the stored value on every request, before any SSH work, so turning a switch off stops the very next call. Ownership is checked first (404), then the switch (403).

Where: Account, card "Container permissions", one card per connected server named like `sam-r.hackclub.app`, three switches each, each showing "On" or "Off" (`components/container-permissions.tsx`).

Common steps: flip the switch. It saves at once. A toast says "<Label> turned on" or "turned off" with the server name. Turning the terminal off adds "Any open terminal on <server> will close." Turning a switch on or off never restarts an app (`lib/container-permissions.ts:56`).

Common errors: "Could not save. Try again." (client fallback); 403 "Confirm with Hack Club first. Turning this on needs a sign-in in the last 5 minutes."; 404 "Server not found". The permission route accepts only the three boolean keys and at least one (400 "Send at least one switch to change.") (`app/api/servers/[id]/permissions/route.ts:10-17`). Every change is recorded in Activity as "Changed container permissions for ...", with the names only (`permissions.ts:92-94`).

### Terminal (switch)

- **Label:** "Terminal". Default: off. Needs a fresh Hack Club sign-in to turn on.
- **Description in the product:** "A shell on your container, running as root. Off by default. Anything you type runs for real, so it can stop or change any app on the container, including apps Egg did not deploy. Anyone with access to your Egg account can use it while it is on."
- **What it can destroy:** anything the container user can touch, including apps and files Egg did not create.
- **Refusal message:** "The terminal is turned off for this server. Turn it on in Account, under Container permissions." (`permissions.ts:38`).
- **Switching off** also closes all of the owner's open terminals on that server (`app/api/servers/[id]/permissions/route.ts:45-47`).

### File changes (switch)

- **Label:** "File changes". Default: off. Needs a fresh Hack Club sign-in to turn on.
- **Description in the product:** "Create, edit, rename, delete and upload files in each project's shared/ folder only. Nothing else on the container is written to, and the live release (current/) is always read only. Off by default, because a file change can change the code your app runs the next time it restarts, which makes this close to terminal access."
- **What it can destroy:** anything inside `shared/` of any project on that server, including data the app keeps there. Folder delete is recursive.
- **Refusal message:** "Changing files is turned off for this server. Turn it on in Account, under Container permissions."
- **Reading files is not behind a switch.** Browsing, reading and downloading work with the switch off.

### Removing leftovers (switch)

- **Label:** "Removing leftovers". Default: off for new servers. Does not need a fresh sign-in.
- **Description in the product:** "Stop and remove services whose names start with egg- and folders inside ~/.egg that no project uses any more. Off by default. A server connected earlier keeps the setting it already had. Anything outside those names is never touched, but a service or folder you made yourself with a matching name would look like a leftover, so each removal asks you to confirm."
- **What it can destroy:** Egg services (`egg-*.service`) that no project uses, and whole folders under `~/.egg` that no project uses, including their `shared/` data. In code, only items that carry the Egg marker are removed (see "Ownership markers").
- **Refusal message:** "Removing leftovers is turned off for this server. Turn it on in Account, under Container permissions."

### Defaults for servers that existed before

- `servers` created before migration `0006` got terminal off, file changes on, removing leftovers on (`web/drizzle/0006_omniscient_norrin_radd.sql`). Migration `0008` then dropped and re-added file changes as off, so every existing server had File changes switched off (`web/drizzle/0008_exotic_terrax.sql`). Terminal stayed off. Removing leftovers stayed on for servers created before `0006` unless the owner changed it.
- **Contradiction in product copy:** the section intro says "Servers you connected earlier keep the settings they had." (`lib/container-permissions.ts:56`) and the leftovers description says "A server connected earlier keeps the setting it already had." That is not true for File changes, which migration `0008` reset to off on every server.
- Anything unreadable falls back to off (`lib/container-permissions.ts:107-121`).

### Unused confirmation copy

- `ENABLE_COPY` (titles "Turn on the terminal?" and "Turn on file changes?", buttons "Turn on terminal" and "Turn on file changes") and `typedConfirmFor` (type the Nest username) are defined in `lib/container-permissions.ts:71-146` but nothing imports them. The switch goes straight to the Hack Club re-sign-in with no dialog and no typed confirmation. Do not document a typed confirmation for turning switches on. `web/drizzle/0008_exotic_terrax.sql` also mentions "the typed confirmation"; the code does not do it.

---

## Projects

### New project (import a repository)

- **Label:** heading "Let's build something new"; "Import Git Repository"; then the configuration step headed "New Project" (`components/new-project-flow.tsx:283-290,636-655`). Reached from "New project" buttons and `/new`.
- **What it does:** picks a GitHub repository, reads it for suggestions, lets you set options, creates the project, saves any environment values you typed, and queues the first deployment.
- **Steps:**
  1. Pick a GitHub account (select labelled "GitHub account") and a repository ("Search repositories…", press "Import"), or paste a public URL under "Or use a public repository URL" (button "Continue"). If the GitHub App is not installed: "Install the GitHub App" or "I already installed it".
  2. In "New Project", read the "We found" summary and press "Use these settings" to fill the fields. Nothing is applied until you press it.
  3. Choose "Nest server", "Project name", "Application preset" (Node.js, Python, Static site, Custom command), "Production branch", "Root directory", "Port your app listens on", and optional "Install command (optional)", "Start command (optional)", "Build command (optional)", and "Output directory" (static only).
  4. Fill any "Environment variables" fields shown from the example env file. An empty field is skipped.
  5. Optionally tick "Adopt an existing checkout".
  6. Press "Deploy". Busy text: "Starting deployment…". You land on the deployment page.
- **Defaults in the form:** name is the repository name made into a slug; preset Node.js; root `.`; port `3000`; branch is the repository default branch (URL imports start at `main`) (`new-project-flow.tsx:156-165`, `:624-629`). Automatic deploys are on (`server/projects.ts:73`). Health path is `/` (the form has no health path field; change it in Settings).
- **Limits (server side, `server/projects.ts`):**
  - name 1 to 60 characters; slug lowercase letters, digits and hyphens, 1 to 40 characters, must start and end with a letter or digit (`layout.ts:42`, `projects.ts:57-65`)
  - commands: at most 500 characters, single line (`projects.ts:21-27`)
  - root directory: relative, no `..`, at most 200 characters (`projects.ts:29-37`)
  - branch: letters, digits, `. _ - /`, at most 200 characters, no leading `-`, no `..` (`projects.ts:39-45`)
  - port: whole number 1024 to 65535, and not 20000 to 29999 (reserved for previews) (`projects.ts:47-55`)
  - health path: starts with `/`, at most 200 characters (`projects.ts:72`)
  - repository URL: https, host `github.com` only, no credentials (`server/deploy/build.ts:50-68`)
  - the form's own port check allows 1 to 65535 (`new-project-flow.tsx:204`), so a port under 1024 passes the form and is refused by the server.
- **Errors:**
  - "Use lowercase letters, numbers and hyphens." (form, name)
  - "The project name must use lowercase letters, digits and hyphens (up to 40)." (400)
  - "You already have a project called "<slug>"." (409). Pick another name.
  - "Port <n> is already used by another project on this server." (409). Pick another port.
  - "Ports 20000 to 29999 are reserved for previews" (400)
  - "Only plain https repository URLs are supported." / "Repositories on <host> are not supported yet. Supported: github.com." / "The repository URL is not valid."
  - "Enter a GitHub repository URL such as https://github.com/owner/name" (URL box)
  - "The project was created, but <NAME> was not saved: <reason>. Press Deploy to try again." The project exists; a retry does not create it twice (`new-project-flow.tsx:172,250`).
  - Repository lookup problems are shown as "<message> You can still set everything by hand." Messages: "Could not read this repository. If it is private, install the GitHub App so it can be read." ; "Could not find the <branch> branch of <repo>." ; "GitHub did not answer (<status>). Try again later." ; "Could not reach GitHub to look. Try again in a moment." (`server/repo-read.ts`).
  - "Connect a server first" empty state with a "Connect a server" button when there is no server.
- **Public URL imports do not auto-deploy.** The form sends `repoFullName: null` and no installation for a pasted URL (`new-project-flow.tsx:224-225,624-629`), and the push webhook finds projects by `repoFullName` (`server/github/webhook.ts:48-51`). A project made from a pasted URL is built only by "Deploy", a deploy hook, or the API. The page says only "pushes do not deploy automatically" when the GitHub App is not configured at all (`new-project-flow.tsx:761-765`). UNCONFIRMED whether anything fills `repoFullName` later: grep finds no code that does.
- **Needs:** sign-in, at least one connected server. GitHub App only for private repositories and push deploys.
- **Files:** `components/new-project-flow.tsx`, `components/env-import.tsx`, `components/project-conflicts.tsx`, `app/(flow)/new/page.tsx`, `app/api/projects/route.ts`, `server/projects.ts`, `server/repo-detect.ts`, `server/repo-read.ts`.

### Repository detection ("We found")

- **What it does:** reads the repository tree and a few files from GitHub and suggests package manager, runtime, commands, output folder, monorepo roots and environment variable names.
- **Rules (`server/repo-detect.ts`, `server/repo-read.ts`):**
  - Language: `package.json` means Node; `requirements.txt` or `pyproject.toml` Python; `go.mod`, `Gemfile`, `Cargo.toml` are named as not supported; a `Dockerfile` is ignored (Egg does not build Docker images).
  - Package manager: the `packageManager` field, else a lockfile (`bun.lock`, `bun.lockb`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`), else npm. Bun is detected but "not built by Egg yet".
  - Vite or Astro without a `start` script is suggested as a Static site with output `dist`.
  - Monorepo: workspaces, `pnpm-workspace.yaml` or `packages/*` and `apps/*` folders with a `package.json` (up to 20 listed as "Apps in this repository" buttons).
  - Only `package.json` and the example env files are read: `.env.example`, `.env.sample`, `.env.template`, `.env.local.example`. A file larger than 200,000 bytes is skipped (`repo-read.ts:16`). Tree paths deeper than 3 levels under the root are ignored (`repo-read.ts:18`). At most 100 names (`repo-detect.ts:73`). Names that are invalid or reserved are dropped. Values are never returned.
  - A committed `.env`, `.env.local`, `.env.production` or `.env.production.local` produces the warning "A .env file is committed to this repository. Remove it from git and rotate the values." The file is never read.
  - Request timeouts: 10 seconds for the tree, 8 seconds per file.
- **Notes shown:** "This repository is very large, so some files may not have been looked at." ; "Nothing here tells us what this project is. Choose a preset below." ; "package.json has no "start" script. Add one, or set a start command yourself." ; "This looks like a monorepo. Set the root directory to the app you want to deploy."
- **Mismatch to know:** detection prefers the `packageManager` field, but the build chooses the package manager from the lockfile only (`server/deploy/build.ts:163-169`).
- **Needs:** sign-in. A private repository needs the GitHub App installation.

### Adopt an existing checkout and container conflict check

- **Label:** checkbox "Adopt an existing checkout" with "This repository already runs on this container." Section "What is already on this container" with a status line and badges "Blocks the deploy", "Made by Egg", "Good to know" (`new-project-flow.tsx:402-427`, `components/project-conflicts.tsx`).
- **What it does:** as soon as name, server and port are valid (600 ms pause), the form asks the container, read-only, whether the new project would collide with anything (`app/api/projects/conflicts/route.ts`, `server/adoption.ts`). The same check runs again at the start of every deploy, before anything is written (`server/deploy/pipeline.ts:360-381`).
- **Limits:** 20 checks per minute per user (`conflicts/route.ts:11`), 429 "Too many checks. Wait <n> second(s) and try again." The probe has a 60 second timeout (`adoption.ts:256`). The probe never returns command lines, environment or file contents.
- **What blocks a deploy (`server/adoption.ts:52-223`):**
  - a service `egg-<slug>.service` that Egg did not create, or one systemd already has: "A service called egg-<slug>.service already exists and Egg did not create it. It will not be replaced. Choose another project name."
  - the project folder `~/.egg/<slug>` being a link, a file, a git checkout that is not Egg's, or a folder with other files in it
  - the port already used by another program ("Port <n> is already in use by <process>. Egg will not stop it. Choose another port, or stop that program yourself first.")
  - a program or service already running from the project folder
  - the same repository already running by hand from another checkout: blocks only the first production deploy (`scope: "firstDeploy"`)
- **What does not block:** the ports cannot be read ("Egg could not read the listening ports on this container, so it could not check that port <n> is free."); a stopped service for the same repo; a checkout that is only sitting there (up to 5 listed); leftovers made by an earlier Egg project with this name ("It will be reused").
- **Form behaviour:** with blocking items, "Deploy is turned off because N thing(s) on this container is/are in the way. Egg will not stop or change it for you. Fix it on your container, or change the project name, server or port." and a link "Open container status". If the check itself fails: "Could not check this container just now: <reason>. The deploy checks again before it changes anything."
- **Deploy-time error:** "Nothing was changed on your container. <up to 3 details>" (`pipeline.ts:375-380`).
- **What "adopt" does:** the server creates the project with automatic deploys off (`server/projects.ts:169`). The form says "Adopted means the first deploy is manual, and automatic deploys start only after you confirm that first deploy works." No code turns automatic deploys on afterwards: the person must tick "Deploy automatically on push" in Settings, Build and Run. The adopt flag is not stored.
- **Needs:** sign-in, connected server. Nothing is stopped, moved or deleted by this check.

### Project settings (Build and Run)

- **Label:** Settings page, card "Build and Run" (`components/project-settings.tsx:160-243`). Left nav "SettingsNav".
- **Fields (exact labels):** "Production branch", "Port", "Start command", "Copy build settings from another project" with "Choose a project" and "Copy", "Runtime", "Root directory", "Install command", "Build command", "Output directory", "Health check path", "Deploy automatically on push". Button "Save".
- **What it does:** updates the project with the same limits as creation (`server/projects.ts:82-201`). Message after saving: "Saved. Changes apply to the next deployment."
- **Limits:** same as New project. Changing the port: 409 "Port <n> is already used on this server." The Output directory placeholder is "dist (static sites only)"; it is used only by the Static site runtime.
- **Copy build settings:** copies runtime, install, build and start commands, output and root directory and health path from another project on the same server into the form. Nothing is saved until Save. Variables, secrets, hooks, notifications, the port and the repository are not copied (`components/project-build-fields.tsx:159-163`, `server/clone-settings.ts`). Errors: "Pick a different project to copy from." ; "You can only copy from a project on the same server." ; "Could not load the build settings. Reload the page to try again." ; "There are no other projects on this server to copy from."
- **Root directory help:** for a subfolder, shows what GitHub has there: package.json, Lockfile, requirements.txt, Start script. Messages: `No folder called "<dir>" on the <branch> branch.`, "That path is a file, not a folder.", "That root directory is not a valid relative path." (up to 8 segments, characters `A-Za-z0-9._@~+ -`), "Could not look at the folder right now." (`server/root-detect.ts`).
- **Needs:** sign-in.
- **Files:** `components/project-settings.tsx`, `components/project-build-fields.tsx`, `server/projects.ts`, `server/clone-settings.ts`, `app/api/projects/[id]/route.ts`, `app/api/projects/[id]/clone/route.ts`, `app/api/projects/[id]/detect/route.ts`.

### Runtimes

- **Names:** "Node.js", "Python", "Static site", "Custom command" (stored as `node`, `python`, `static`, `command`; `server/db/schema.ts:111`).
- **Node.js:** build install is the project's install command, else `npm ci` (npm lockfile), `corepack enable && pnpm install --frozen-lockfile`, `corepack enable && yarn install --frozen-lockfile`, or `npm install` with no lockfile (`server/deploy/runtime.ts:33-71`). Lockfile order: pnpm, yarn, npm (`build.ts:163-169`). Build command: yours, else the package manager's build script if `package.json` has a `build` script. After upload the container runs the production install (`npm ci --omit=dev`, `pnpm install --prod --frozen-lockfile`, `yarn install --production --frozen-lockfile`, or `npm install --omit=dev`). `node_modules` is left out of the archive. Default start: `npm start` (also for pnpm and yarn projects).
- **Python:** no default build. The container runs `python3 -m venv .venv && .venv/bin/pip install --disable-pip-version-check -r requirements.txt` if `requirements.txt` exists. The service PATH starts with the venv `bin`. Default start: `python3 app.py`.
- **Static site:** build as Node when `package.json` exists. The folder shipped is the Output directory (default the root `.`). Default start serves it with `python3 -m http.server <port> --bind 0.0.0.0`, or a one-line Node server if Python 3 is missing. Error: "Static sites need Python 3 or Node.js on your Nest container to be served."
- **Custom command:** no detection, no remote install. Install, build and start commands come from you. Error: "Set a start command for this project (for example ./my-binary)."
- **Always:** the app runs from its release folder with `PORT`, `HOST=0.0.0.0`, `NODE_ENV=production` (`server/deploy/remote.ts:108-109`). Reserved variable names: `PORT`, `HOST`, `PATH`, `HOME`, `EGG` (`runtime.ts:162`).
- **Build image:** `node:22-bookworm` for Node, static and custom builds, `python:3.12-bookworm` for Python (`server/config.ts:33-34`).

### Delete Project

- **Label:** card "Delete Project"; checkbox "Also stop the service and delete releases on <nest>.hackclub.app" (default checked); field "Type <slug> to confirm"; button "Delete" (`components/project-settings.tsx:354-396`).
- **What it does:** with the box ticked, stops the service, removes production and preview releases and the `current` link, but only if the unit and folder carry the Egg marker, then deletes the records. The `shared/` folder is kept, because the browser never sends `data=1` (`app/api/projects/[id]/route.ts:20-32`, `server/deploy/remote.ts:233-253`). Unticked, only the records go and the app keeps running.
- **Errors:** "Could not remove the project from your container." (502). Records are kept so you can retry. Messages `<path> was not created by Egg, so it was left alone.` appear in the script output, not in the UI.
- **Needs:** sign-in.

---

## GitHub app and installation

### Connect GitHub and install the app

- **Label:** card "Connect GitHub": "Install the Egg GitHub App to pick repositories, deploy private ones, and deploy on every push." Buttons "Install the GitHub App" and "I already installed it"; link "Add another account or repository" (`components/new-project-flow.tsx:716-733,704-713`).
- **What it does:** "Install the GitHub App" goes to `https://github.com/apps/<slug>/installations/new`. "I already installed it" goes to `/api/github/connect`, which sends you through GitHub OAuth. The callback lists the installations your GitHub user can reach for this app and links them to your account (`server/github/app.ts:129-209`).
- **Limits:** one installation belongs to the first Egg user who links it (`app.ts:190-193`). Repository lists fetch up to 5 pages of 100, newest push first (`app.ts:97`). The OAuth state cookie lasts 10 minutes. App JWT lifetime 9 minutes; installation tokens are cached until one minute before expiry (`app.ts:32-60`). The user's OAuth token is used once and not stored.
- **Return notices (query `?github=`)**: `connected`, `invalid_state`, `failed`, `not_configured` (`app/api/github/{connect,callback}/route.ts`). The page turns them into a notice (`app/(flow)/new/page.tsx`). UNCONFIRMED exact notice text: not read.
- **Errors from the code:**
  - "The GitHub App is not configured." (self-hosting: needs `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`; `server/config.ts:80-89`)
  - "The GitHub App is no longer installed on that account." (404 from GitHub)
  - "GitHub refused to issue an access token (<status>)."
  - "GitHub did not accept the authorization (<error>)."
  - "Could not list repositories (<status>)." ; "That GitHub installation is not linked to your account." (403)
  - Empty list: "No repositories shared with the app yet." ; "No repositories match “<query>”."
- **If the app is uninstalled:** the `installation` "deleted" event removes the record and clears `installationId` on projects. Projects keep their record but lose private-repo access until relinked (`server/github/webhook.ts:158-173`).
- **Needs:** sign-in. The repository permission the app needs for reading code, plus Pull requests read and write for comments.
- **Files:** `server/github/app.ts`, `app/api/github/{connect,callback,installations,repos}/route.ts`, `components/new-project-flow.tsx`.

### GitHub webhook (Deploying on push)

- **What it does:** receives GitHub events at `/api/webhooks/github`. Only a valid `X-Hub-Signature-256` HMAC over the raw body gets in (`app/api/webhooks/github/route.ts`, `server/github/app.ts:239-248`).
- **Responses:** 503 `webhook not configured`, 401 `bad signature`, 400 `bad json`, 500 `internal`.
- **Push rules (`server/github/webhook.ts:28-86`):**
  - ignored: non-branch refs, deleted branches
  - only projects whose `repoFullName` matches and whose "Deploy automatically on push" is on
  - skipped when the event's installation id differs from the project's
  - skipped when a deployment for the same branch and commit is already queued, building or deploying (retries)
  - the production branch deploys to production; any other branch builds a preview
  - source is `webhook`; commit message first line (300 characters) and author recorded
- **Needs:** webhook secret configured. Nothing else.

---

## Build pipeline and releases

### What happens on a deploy

- **Where it runs:** a worker process picks queued jobs (2 at a time by default, `WORKER_CONCURRENCY`; `instrumentation.ts:26-28`, `server/jobs.ts:161`), but never two jobs of the same project at once (`jobs.ts:31-38`). Polls every second.
- **Steps (`server/deploy/pipeline.ts:287-505`):**
  1. State becomes Building. Environment values for this environment are decrypted; those and the GitHub token are masked in the log (values shorter than 4 characters are not masked, `server/deploy/logger.ts:22`).
  2. Clone: `git clone --depth 1 --branch <branch> --single-branch --no-tags` with a 5 minute limit (`build.ts:217-232`). A redeploy fetches the exact commit (3 minute limit); if it cannot, it builds the branch tip and logs "Could not fetch <sha>; building the branch tip instead."
  3. Build in a sandbox: install command and build command joined with `&&`, `CI=true` set, your variables passed in. With `BUILD_RUNNER=docker` (default): `docker run --rm --memory 2g --memory-swap 2g --cpus 2 --pids-limit 2048 --cap-drop ALL --security-opt no-new-privileges` (`build.ts:363-407`). `BUILD_RUNNER=local` runs with no isolation (development only). Timeout `BUILD_TIMEOUT_SECONDS`, default 900 (`config.ts:35`).
  4. Pack a tarball. Left out: `.git`, `node_modules` (Node and static), `.next/cache` (`build.ts:308-315`). Maximum 500 MB (`MAX_ARCHIVE_BYTES`, `build.ts:46`).
  5. State becomes Deploying. Connect over SSH, probe the container, check for conflicts (see Adopt), create folders, check the service name is free, upload the archive to `incoming/<release>.tar.gz`, verify SHA-256 if `sha256sum` exists, unpack into `releases/<release-id>/`, run the production install, write `.env` (mode 600), write the systemd unit, `daemon-reload` and `enable`.
  6. Production: point `current` at the new release and restart the service. Preview: restart the preview unit. Then wait for the app (see Health check).
  7. On success: mark Ready, mark this release current (production), send the notification and the pull request comment, prune old releases.
  8. The source folder in the worker is deleted when the deployment ends (`pipeline.ts:500-503`).
- **Errors (copy exactly):** see "Deployment states and errors" below.

### Health check and automatic revert

- **What it does:** after the switch, waits up to 45 seconds (`healthTimeoutSeconds`, `pipeline.ts:50`) for the service to answer on `127.0.0.1:<port><health path>`. Healthy means HTTP status 200 to 499 (`remote.ts:165`, pattern `[234]??`). Without `curl` it accepts a TCP connection (`remote.ts:166`). If systemd marks the service failed it stops at once ("Service crashed on start").
- **If it fails:** the last 30 journal lines are written to the log. For production with a previous release, the old release is activated again and checked for 20 seconds, with the log line "The previous release is serving traffic again." or "The previous release did not come back either. Check the logs." (`pipeline.ts:449-474`).
- **Error:** "The new release did not become healthy on port <port>. Make sure your app listens on the PORT environment variable and on 0.0.0.0."
- **Note:** this check treats 4xx as healthy, so a health path that returns 404 passes. The monitor and the Service card use "below 500" as well.

### Release folders on the container

Layout under `<home>/.egg/<slug>/` (`server/deploy/layout.ts`, `remote.ts:31-43`):

- `releases/<uuid>/` one folder per deployment (id is the deployment's release id; a rollback reuses an old one)
- `incoming/<uuid>.tar.gz` upload area, emptied on cleanup
- `current` a symlink to the live release, replaced atomically with `ln -sfn` then `mv -Tf` (`remote.ts:127-143`)
- `shared/` created empty, never touched by deploys; survives releases
- `.egg-managed` marker file
- production unit `egg-<slug>.service`; preview units `egg-<slug>-pv-<first 8 chars of release id>.service`
- Production runs from `current/`; previews run from their own `releases/<id>/` folder (`pipeline.ts:154-161`). A `.env` file sits at the top of each release.
- Unit: `Restart=always`, `RestartSec=3`, `WantedBy=multi-user.target`, `ExecStart=/bin/bash -lc "exec <start command>"`, `EnvironmentFile=<release>/.env` (`remote.ts:91-116`).

### Keeping five releases

- **Constants:** `KEEP_RELEASES = 5`, `KEEP_PREVIEWS = 2` (`server/deploy/layout.ts:8-9`).
- **What it does after each successful deploy** (`pipeline.ts:219-280`): production keeps the 5 newest Ready production releases plus the live one plus the releases of the kept previews; everything else under `releases/` with a UUID name is deleted, and its deployment is marked cleaned up. Previews: only the 2 newest Ready previews are kept; older ones have their unit stopped and removed and their folder deleted.
- **Consequences:** the live release counts on top of the five, so up to six production releases can exist after a rollback. A removed release cannot be rolled back to. Failed and canceled deployments do not count toward the five and have no folder on the container.
- **Cleanup errors are swallowed** (`.catch(() => {})`, `pipeline.ts:255,275`): if the prune or the preview removal fails over SSH, the deployment records are still marked cleaned up, so a leftover folder can stay on the container while the page says it is gone.

---

## Deployments

### Deployments page and project Deployments tab

- **Label:** page "Deployments" (sidebar) and the project tab "Deployments" (`app/(app)/deployments/page.tsx`, `app/(app)/projects/[slug]/deployments/page.tsx`, `components/deployments-view.tsx`).
- **Controls (exact labels):** search "Search by commit, branch, author or #pr…" (phone: "Search deployments"); "Sort deployments" ("Newest first", "Oldest first", "Longest build", "Shortest build"); "Filter by time" ("Any time", "Last 24 hours", "Last 7 days", "Last 30 days"); "Filter by status" ("All", "Ready", "Building", "Error" with counts); "Filter by environment" ("All envs", "Production", "Preview"); "Filter by project"; "Clear filters"; checkbox "Select all shown".
- **Search:** every word must match project, branch, commit message, short sha, author, how it started, environment, or PR (`#14` or `pr 14`) (`lib/deployments-filter.ts:53-69`).
- **Status pills:** "Ready" matches Ready; "Building" matches `building` and `queued` only; "Error" also covers Canceled (`deployments-filter.ts:35-46`). A deployment in `deploying` is therefore matched by no pill except "All", although its row is drawn as Building (`lib/status.ts:4-17`). UNCONFIRMED whether that is intended.
- **Limits:** the page loads the newest 100 deployments (`deploymentViews` default, `server/queries.ts:177-193`); the list shows 25 at a time with a "Show N more" button (`PAGE = 25`, `deployments-view.tsx:44`). Older deployments are not reachable in the page. UNCONFIRMED: whether any other route lists more (the API `list_deployments` has its own limits, not read here).
- **Empty states:** "No deployments yet", "No deployments match".
- **Needs:** sign-in.

### Deployment page

- **Label:** heading "Deployment <8 characters>", card "Details" (Created, Duration, Environment, Address, Port, Source with branch, commit and message), card "Build Logs" (`app/(app)/projects/[slug]/deployments/[id]/page.tsx`).
- **Build Logs:** collapsible; shows line count and a "Find in logs…" box; while the deployment runs, new lines stream over server-sent events and the page refreshes every 4 seconds; "Waiting for the first log line…" before any line (`components/build-logs.tsx`, `app/api/deployments/[id]/stream/route.ts`). The stream polls every 750 ms, sends a keepalive every 20 polls, and stops after 18,000 polls, about 3.75 hours (`stream/route.ts:30`). Each stored line is cut to 4000 characters (`logger.ts:32`). The page loads up to 1000 existing lines (`projects.ts:487`, default `limit = 1000`). No download button exists for build logs.
- **If it failed:** a red alert shows the error text (at most 500 characters stored, `pipeline.ts:493`).

### Deployment states

States in the database: `queued`, `building`, `deploying`, `ready`, `error`, `canceled` (`schema.ts:213-221`). Product words (`lib/status.ts`, `components/status-dot.tsx`): "Queued", "Building" (also used for deploying), "Ready", "Error", "Canceled". The compare table uses "Queued", "Building", "Deploying", "Ready", "Error", "Canceled" (`deployments-filter.ts:198-205`).

- Queued: waiting; one job per project runs at a time.
- Building: clone, install, build, pack.
- Deploying: upload, unpack, start, health check. A rollback job also shows Deploying.
- Ready: started and answering.
- Error: a step failed. The error text is on the page.
- Canceled: you canceled it, or its pull request closed ("Pull request closed").

Errors that end in Error (exact text):

- "Could not clone the repository. Check the branch name and that Egg has access to it."
- `The root directory "<dir>" does not exist in this repository.` ; `"<dir>" is outside the repository.`
- "The build failed (exit <code>)." ; "The build timed out." ; "The build was canceled."
- `The output folder "<dir>" was not created by the build.`
- "The build output is <n> MB, over the 500 MB limit."
- "Nothing was changed on your container. <details>"
- `<label> failed (exit <code>).` for Preparing folders, Checking the service name, Unpacking the release, Registering the service, Switching the release, Starting the preview. "Upload is corrupted: checksum mismatch" appears as exit 20 in the log. "Upload failed (exit <code>): <stderr>".
- "<path> is a link, so Egg will not write into it." / "<path> exists and is not a folder." / "<path> already exists and was not created by Egg, so it was left alone." / "<unit> already exists and was not created by Egg, so it was left alone." (exit 30)
- "The new release did not become healthy on port <port>. Make sure your app listens on the PORT environment variable and on 0.0.0.0."
- "The worker stopped while this deployment was running. Try again." and "The worker restarted while this deployment was running. Try again." (`server/jobs.ts:72,102`). A running job is presumed dead after 1 hour (`jobs.ts:15`).
- "No free preview ports on this server." (409, at queue time)

### Deploy and Redeploy

- **Labels:** button "Deploy" on the project page; it reads "Redeploy" once something is live (`app/(app)/projects/[slug]/page.tsx:143-148`). In a row's actions menu ("Actions for deployment <7 chars>"): "View logs", "Redeploy", "Instant rollback", "Cancel" (`components/deployment-actions.tsx`).
- **What they do:**
  - The project page button ("Deploy" or "Redeploy") always queues a new build of the production branch tip (`components/deploy-button.tsx`, `server/projects.ts:370-383`). It does not rebuild the same commit, despite the "Redeploy" label.
  - "Redeploy" in the actions menu builds the same commit of that deployment again, into the same environment (`projects.ts:394-406`, `build.ts:239-260`).
  - The browser has no way to deploy a non-production branch by hand. Preview builds come from pushes, pull requests, a deploy hook with `{ "branch": ... }`, or the API.
- **Steps:** open the project, press Deploy; or open the deployment's actions menu, choose Redeploy. You land on the new deployment.
- **Errors:** toast "Could not start the deployment" or the server message; 404 "Deployment not found"; 409 "No free preview ports on this server."
- **Needs:** sign-in. API: `deployments:write`.

### Instant rollback

- **Label:** "Instant rollback" button (tooltip "Switches back to the previous release. Database changes are not reversed." or "There is no earlier release on your server to switch back to.") (`components/rollback-button.tsx`), and the same item in a row's menu.
- **What it does:** queues a rollback job that points `current` at an earlier release still on the container and restarts the service, with the same 45 second health check. If the old release is unhealthy, the release that was live is put back (`server/deploy/pipeline.ts:508-571`).
- **Which deployments qualify:** production, state Ready, not the live one, release not removed. The project page button targets the newest such deployment (`app/(app)/projects/[slug]/page.tsx:85-92`).
- **Errors:**
  - "Only production deployments can be rolled back to." (400)
  - "That deployment never finished, so there is nothing to roll back to." (400)
  - "That release was removed from your server to save space." (409)
  - "That deployment is already live." (409)
  - "That release is no longer on your server (old releases are removed to save disk space)." (log)
  - "The older release did not become healthy, so nothing was changed."
  - "Rollback failed" (toast fallback)
- **Log line on success:** "Rollback complete. Database changes are not reversed."
- **Result record:** a new deployment with source `rollback`, state Ready.
- **Needs:** sign-in. API: `deployments:write`.

### Cancel

- **Label:** "Cancel" in a row's menu (shown only while Queued, Building or Deploying).
- **What it does:** marks the deployment Canceled and fails its queued job (`projects.ts:444-459`). A running build is stopped within about 2 seconds (the worker polls the state, `jobs.ts:121-132`).
- **Errors:** "That deployment is already finished." (409).
- **UNCONFIRMED:** whether a cancel that arrives after the release switch (`activateProduction`) stops it. The pipeline checks for cancellation only after the build, after the upload and after registering the service (`pipeline.ts:333,387,423`).
- **Needs:** sign-in. API: `deployments:write`.

### Select, Compare, bulk Cancel and Delete previews

- **Labels:** "N selected", "Compare", "Cancel (n)", "Delete previews (n)", "Clear selection" (`deployments-view.tsx:368-421`).
- **Compare:** needs exactly two selected rows. Shows Branch, Commit SHA, Commit message, Environment, State, Duration, Created, Live release, with differences marked (`lib/deployments-filter.ts:215-239`, `components/deployment-compare.tsx`).
- **Bulk Cancel:** only previews that are Queued, Building or Deploying (`canBulkCancel`, `deployments-filter.ts:164`). Other selected rows are skipped.
- **Bulk Delete previews:** only previews that are not live, not already cleaned up, not running, and at least 24 hours old (`OLD_PREVIEW_MS`, `deployments-filter.ts:151,172-179`). Dialog "Delete N preview(s)?" with "Each preview is stopped and its files are removed from your container. This cannot be undone. Production releases and the live release are never deleted." Confirm "Delete previews". The deployment record stays in the list, marked cleaned up, and the action is recorded as "Deleted a preview deployment of" (`server/deployments-bulk.ts`).
- **Limits:** at most 50 ids per request (`MAX_BULK = 50`, `deployments-bulk.ts:14`). Each id is checked and run on its own; one failure does not stop the rest.
- **Errors:** "Only previews that are queued or running can be canceled in bulk." (409); "Only old previews that are not live or removed can be deleted in bulk." (409); "Could not remove the preview from your container." (502); "Something went wrong on our side."; toast "N could not be canceled/deleted"; dialog error "None of the previews could be deleted."
- **Needs:** sign-in. Bulk delete does not need a container permission switch. UNCONFIRMED whether that is intended: `deletePreview` runs `removePreview` over SSH without checking "Removing leftovers" (`deployments-bulk.ts:44-69`).

### Restart (Service card)

- **Label:** "Restart" on the Service card (see Monitoring). Dialog "Restart the service?" "The app is offline for a few seconds." confirm "Restart".
- **What it does:** runs `systemctl restart egg-<slug>.service` for the production service, no build (`server/runtime-info.ts:45-55`).
- **Errors:** "Could not restart the service. It may not be deployed yet." (502). Disabled while not deployed or the container cannot be reached.
- **Needs:** sign-in. Recorded as "Restarted <project>".

---

## Previews

### Branch previews

- **What it does:** a deployment of any branch other than the production branch is a preview with its own service on its own port.
- **Ports:** the lowest free port from 20000 to 29999 on that server, counting previews that are not cleaned up and are queued, building, deploying or ready (`PREVIEW_PORT_MIN/MAX`, `server/projects.ts:18-19,296-315`). Error: "No free preview ports on this server."
- **Address:** none from Egg. The log says "Preview is running on port <port>. Map a domain to it in the Nest dashboard to open it." A domain can be recorded in Domains with that port.
- **Keeps:** the 2 newest Ready previews (`KEEP_PREVIEWS`). Older ones are stopped and deleted after the next successful deploy. A preview runs from its own release folder, with the same environment variables that target All or Preview.
- **Same checks apply:** container conflict check, host marker checks, health check (but no automatic revert: there is no previous preview to restore).
- **Where to see them:** project page card "Active branches" (one row per branch, linking to its latest deployment); Deployments page filter "Preview".
- **Needs:** sign-in; "Deploy automatically on push" for pushes.

### Pull request previews and comments

- **What it does:** a pull request from the same repository, not a draft, and not from the production branch, builds a preview and gets one comment from the app that is updated as the build finishes (`server/github/webhook.ts:106-156`, `server/github/pulls.ts`).
- **How it works:** the push to the PR branch normally starts the preview (as a branch preview). The pull request event links that deployment to the PR number. If none exists yet it queues one with the PR number.
- **Comment text:** "### Preview ready" or "### Preview failed", project name, branch, short sha, "It is running on its own port (<port>) on the owner's Nest container. Nest only gives it a public address once a domain is mapped to that port." or "The build log is in Egg.", a link "Open the deployment", and a hidden marker `<!-- egg-preview -->` (`pulls.ts:31-49`). The comment includes no error output, server name or variable values. The link works only for the project's owner (it points to the signed-in deployment page).
- **Rules:** one comment per PR; the app only edits a comment it wrote (type Bot with the marker). Up to 100 comments are read (`per_page=100`, `pulls.ts:65`).
- **Closing a pull request:** cancels builds still queued or running and removes its Ready previews from the container, best effort. Marked as canceled with "Pull request closed" (`pulls.ts:131-192`).
- **Not built:** forks ("pull request from a fork is not built"), drafts ("draft pull request"), PRs whose head branch is the production branch. Actions handled: `opened`, `reopened`, `synchronize`, `ready_for_review`, `closed` (`webhook.ts:99`).
- **Caveat:** a draft PR's branch push still builds a preview through the push event (`webhook.ts:60-86`); only the PR event skips drafts, so the PR number is not linked and no comment is written until the PR is ready. A fork's code never reaches this path because pushes to a fork do not arrive at the base repository's webhook.
- **If the comment fails:** nothing visible; the server logs "pull request comment failed" and the deploy is unaffected. A 403 usually means the app lacks Pull requests read and write (`pulls.ts:121`).
- **Needs:** GitHub App with Pull requests read and write and the Pull request event; the project must have `repoFullName` and an installation.

---

## Deploy hooks

- **Label:** card "Deploy Hook"; buttons "Create hook", "Make a new URL", "Revoke" (`components/project-automation.tsx:19-121`).
- **What it does:** a private URL `<APP_URL>/api/hooks/deploy/ndh_<token>` that starts a deployment on POST. Only the SHA-256 of the token is stored; the URL is shown once, with a ready-made `curl -X POST <url>` line (`server/hooks.ts`).
- **Steps:** Settings, Deploy Hook, "Create hook", copy the URL. Send a POST from CI. Optional JSON body `{ "branch": "my-branch" }`.
- **Rules:** a branch other than the production branch builds a preview; the source is `hook`, author "deploy hook", message "Triggered by deploy hook". Branch format as for projects; extra body fields are refused (`strict`). Creating a new URL replaces and invalidates the old one at once. "Revoke" removes it.
- **Responses:** 202 `{ deployment: { id, state, branch, env } }`; 404 "Unknown hook" (also for a malformed token); 400 "Request body must be JSON" or a branch validation message; 409 "A deployment is already running for this project." (any queued, building or deploying deployment of the project).
- **Text on the card:** "Copy it now. For safety it is not shown again. Anyone with this URL can deploy this project, so treat it like a password." ; "A hook is active and its URL is hidden. Make a new one to see a URL again; the old one stops working at once."
- **Limits:** one hook per project. No rate limit beyond the 409 rule. The route skips the origin check on purpose.
- **Needs:** sign-in to create. The call itself needs only the URL. API: `deployments:write` to replace or revoke.
- **Audit:** "Created a deploy hook for", "Revoked the deploy hook for", "Deployed through the deploy hook for".

---

## Environment variables

### Add, change, delete, import names

- **Label:** card "Environment Variables"; fields "Name", "Value", "Applies to" ("All", "Production", "Preview"); button "Save" (or "Update" while editing); pencil button "Change the value of <name>"; trash button "Delete <name>"; button "Import names from the repository" (`components/project-settings.tsx:245-344`, `components/env-import.tsx:259-356`).
- **What it does:** stores values encrypted (AES-256-GCM, bound to project, name and target) and writes them to the release's `.env` (mode 600) at deploy time; they are also passed to the build (`server/projects.ts:216-254`, `pipeline.ts:304-309,404`).
- **Write-only:** the list shows names and targets only. Values are never returned by the browser routes or the API (`projects.ts:257-266`). To change a value, use the pencil, type a new value ("New value" placeholder) and press Update. Saving the same name and target replaces the value.
- **Steps:** type a name, a value, pick where it applies, press Save. Changes apply at the next deployment ("Redeploy to apply it now"; the page says "they reach your server on the next deploy").
- **Import names from the repository:** reads the example env files in the repository and adds every name not already present with an empty value. Message "Added N name(s) with empty values. Use the pencil on each to set its value." Empty values are left out of the `.env` file (`runtime.ts:169-181`).
- **Limits:**
  - name: letters, digits and underscores, not starting with a digit, at most 100 characters (`runtime.ts:159`, `projects.ts:205-212`)
  - reserved: `PORT`, `HOST`, `PATH`, `HOME`, `EGG` (case-insensitive)
  - value: at most 10,000 characters
  - 100 variables per project, counted per name and target pair (`projects.ts:241`)
  - unique per name and target (`schema.ts:210`)
- **Errors:** "Names use letters, digits and underscores, and do not start with a digit" ; "That name is set by Egg" ; "A project can have up to 100 variables." ; import: "No example env file (such as .env.example) was found in the repository." ; "Every name in the repository is already here." ; "<n> added, then it stopped: <reason>" ; "Could not look at the repository."
- **Delete dialog:** `Delete <name>?` "Deployments after this one will not have it."
- **Masking:** values of 4 or more characters are replaced by `***` in build and deploy log lines (`logger.ts:22-29`, `build.ts:176-183`). Shorter values and transformed values (for example base64) are not masked.
- **If a name exists for All and for a specific target:** both are loaded and the later row wins (`pipeline.ts:91-95`). UNCONFIRMED which row is later: the query has no `ORDER BY`.
- **Needs:** sign-in. API: `env:read` for names, `env:write` to set and remove. The API refuses to read `current/.env` and release `.env` files (see Files).
- **Reading values back is possible in the browser file manager:** the Files page can open `current/.env`, which holds the values in plain text; only the API refuses it (`app/api/projects/[id]/files/read/route.ts` has no check; `server/api-v1-shell.ts:162-178` does). See the discrepancy list.

---

## Domains

### Add a domain, DNS check, app check

- **Label:** page "Domains"; form "Add a domain" with "Domain", "Project (optional)", "Target port", button "Add domain" (busy "Adding…"); each row has status, "Check" (busy "Checking…"), "Edit <domain>", "Remove <domain>" (`components/domains-view.tsx`).
- **What it does:** records which domain should reach which port on your Nest container, tells you what to enter at your DNS provider and in the Nest dashboard (Nest has no API for the mapping), and checks DNS and the app itself.
- **Steps:**
  1. Domains, enter the domain, optionally pick a project (this fills its port), set the target port, press Add domain.
  2. Copy "CNAME name" and "CNAME value" (`<nest-username>.hackclub.app`) to your DNS provider. Names that already end in `.hackclub.app` skip this.
  3. In the Nest dashboard Domains page, add the domain with that port.
  4. Press Check.
- **Statuses:** "Not checked" (pending), "Valid", "Needs attention" (`domains-view.tsx:41-48`).
- **DNS check (`server/domains.ts:179-227`):** valid when the domain's CNAME includes `<nest-username>.hackclub.app`. For names under `<nest-username>.hackclub.app`, or that exact name, an A record is enough. Reasons shown under "Needs attention":
  - "The CNAME points to <x>, but it should point to <target>." (a different hackclub.app name)
  - "The CNAME points to <x>. It should point to <target>."
  - "No CNAME found yet. Create one pointing to <target>. DNS changes can take a few minutes."
  - "The name does not resolve yet. Add it in the Nest dashboard first."
  - "DNS could not be checked right now. Try again in a minute."
  - Fallback text: "DNS does not point at your server yet. Press Check to see what it points at." (`lib/connection-error.ts:35`)
- **App check (only when DNS is Valid, `domains.ts:239-270`, `server/app-check.ts`):** a GET over HTTPS to the domain, to `/` and to the project's health path if different, with a 5 second timeout, certificate checking on, no redirects followed, body never read. The domain must resolve only to public addresses (`server/net-guard.ts`). Shows "Certificate accepted" or "Certificate not verified yet" plus per path "Answers with HTTP <code>" or "Reachable but returning <code>" (500 and above). Messages: "The app check runs once DNS points at Nest." ; "The certificate has expired." ; "The certificate is for a different name." ; "The certificate is not trusted." ; "No answer within 5 seconds." ; "The connection was refused on port 443." ; "The secure connection could not be set up." ; "Could not connect." ; "The name does not resolve to an address yet." ; "The name resolves to a private or internal address, so it was not checked." ; "Only domain names can be checked, not IP addresses."
- **Limits:** domain is a hostname (up to 253 characters, no IP, no URL; `domains.ts:18-31`); port 1 to 65535; a domain can be added once across all users (unique index `domains_domain_idx`, `schema.ts:304`); no cap on the number of domains found.
- **Errors:** "Enter a domain name such as app.example.com (not an IP address or a URL)." ; "<domain> is already added." (409) ; "Enter a port between 1 and 65535." ; "Project not found" (project must be on the same server) ; "Could not add the domain" ; "Check failed".
- **Edit:** the pencil changes the project and port. Moving to a project without a port uses that project's port. Changing the port resets the status to "Not checked" and says "Saved. Also change the target port to <n> on the Domains page of your Nest dashboard, then press Check." (`domains.ts:130-171`, `domains-view.tsx:163-167`)
- **Remove:** "This removes the record from Egg." Nothing changes at Nest or your DNS.
- **Which server:** the Add form always uses the first server in the list (`domains-view.tsx:79`, `servers[0]`). UNCONFIRMED how a second server's domains are added from the UI: no server selector exists in the form.
- **Needs:** sign-in, a connected server. API: `domains:read`, `domains:write`.

---

## Logs

### Build logs

See "Deployment page". Stored per deployment, searchable in the page ("Find in logs…"), streamed while running.

### Runtime logs (Logs page)

- **Label:** page "Logs", region "Runtime logs" (`components/logs-view.tsx`).
- **Controls:** project select, "Search logs" ("Search the last 1000 lines…"), "Time range" ("1 hour", "24 hours", "7 days", default 7 days), "Level" ("All lines", "Warnings and errors"), checkbox "Refresh every 5s" (shows "Live"), "Download", "Refresh".
- **What it does:** reads the production service's journal over SSH (`journalctl -u egg-<slug>.service ... -o short-iso`) (`server/deploy/remote.ts:174-179`). Shows up to 300 lines. A search or the "Warnings and errors" level reads the newest 1000 lines first, filters them, then keeps the newest 300 (`server/runtime-info.ts:14-42`). The API clamps `lines` to 1 to 1000 (`app/api/projects/[id]/runtime-logs/route.ts:10-11`).
- **Level detection:** read from the line text: `[ERROR]`, `level=warn`, JSON level fields, pino numbers, systemd `<n>` priorities, words like error, failed, fatal, exception, traceback, warning, deprecated, error class names, stack frames, npm `ERR!`, Node `ERR_` codes. Counts of zero such as "0 errors" do not count. Stack trace lines take the level of the error above (`lib/log-filter.ts:39-258`). Lines marked "Error" or "Warning" in the "Warnings and errors" view.
- **Download:** saves exactly the lines on screen as a plain text file named like `recipe-api-logs-24h-2026-11-05.txt` (`log-filter.ts:261-273`). The button label includes the count. Disabled with no lines.
- **Errors:** "Could not read the logs from your container." (502) ; connection problems show "We can't reach your container right now" with details and a retry button (`lib/connection-error.ts:7`). Empty states: `No lines match “<term>”.` ; "No warnings or errors in this time range." ; "Nothing printed in this time range. Try a longer one." ; "Nothing to read yet" with no projects.
- **Limits:** SSH script timeout 30 seconds. Search text is cut to 200 characters. Journal retention is whatever systemd keeps on the container, not set by Egg.
- **Needs:** sign-in. API: `logs:read` for runtime logs; build output needs `deployments:read` and uses the SSH rate bucket.
- **Files:** `components/logs-view.tsx`, `lib/log-filter.ts`, `server/runtime-info.ts`, `app/api/projects/[id]/runtime-logs/route.ts`.

---

## Monitoring

### Service card

- **Label:** card "Service" on the project page, shown once something is live; buttons "Restart" and "Check now"; facts Status ("Running", "Starting", "Crashed", "Stopped", "Not deployed", "Unknown"), Uptime, Memory, Restarts, Health check ("HTTP <code> in <ms> ms", "No answer", "Not checked") (`components/service-status.tsx`).
- **What it does:** one SSH read of `systemctl show` (state, pid, restarts, memory, CPU time, start time), the machine uptime, and one real `curl` to `http://127.0.0.1:<port><health path>` with a 3 second limit (`server/deploy/remote.ts:265-278`, `server/service-status.ts`).
- **Refresh:** when the page opens, every 30 seconds while the tab is visible (`REFRESH_MS`, `service-status.tsx:16`), and on "Check now". The script has a 20 second timeout.
- **Errors:** "Could not read the service from your container." (502); SSH messages as 502 or 504; connection failures show the retry alert.
- **Needs:** sign-in.

### Resource use (project) and the Resources page

- **Project card:** "This service only, last 24 hours. Checked every few minutes." Memory and CPU charts (`components/project-resources.tsx`). CPU is a share of one core and can pass 100. A point is left blank when there is no earlier sample, the gap since it is over 30 minutes, or the counter went backwards after a restart (`server/monitor.ts:33-42`).
- **Resources page:** server load, memory and disk for 24 hours or 7 days (`app/(app)/resources/page.tsx:20-23`), plus a table of each project's memory, CPU and restarts. Server picker via `?server=`.
- **Data:** the worker samples every connected server every 5 minutes by default (`MONITOR_INTERVAL_MS`, `server/jobs.ts:198`) and keeps 7 days (`SAMPLE_KEEP_MS`, `monitor.ts:24`). Project samples are only written when the service is running.
- **Needs:** sign-in; a worker running. API: `resources:read`.

### Uptime checks

- **What it does:** every 5 minutes the worker checks each project that has a live production release and no deployment queued, building or deploying (`monitor.ts:170-203`). One SSH session per server. A server that cannot be reached is skipped and no project on it is reported down (`monitor.ts:311-322`).
- **Healthy means:** service running, and the health path answers with a status of 1 to 499; with no `curl`, running is enough (`monitor.ts:49-54`). With a slow response limit set, a slower answer counts as a failed check.
- **Down after N failed checks in a row:** default 2 (`FAILURES_BEFORE_DOWN`, `monitor.ts:22`; per-project setting `alertFailures`, 1 to 10, default 2 in `schema.ts:166`).
- **Where it shows:** project page header "Answering", "Not answering since <time>", "Not checked yet"; Projects page "Needs attention" card; public status page; Activity entries "Detected downtime on" and "Detected recovery of".
- **Down detail text:** "The service is <state>." ; "The health path took <ms> ms to answer, over your limit of <n> ms." ; "The service is running but nothing answered on its health path." ; "The health path answered HTTP <code>." ; "The service did not pass its check." ; recovery "It is answering again." (`monitor.ts:157-165,277-278`)
- **Projects page "Needs attention" card** (heading text; element id `alerts-heading`): lists apps not answering, projects whose latest deployment failed (and are not down), a disk, memory or CPU load at or over the lowest limit set across your projects (default 90%) for the first server, and projects with alerts paused (`app/(app)/projects/page.tsx:39-185`, `server/notify.ts:417-437`). The docs say "Alerts card" and "disk or memory over 90%"; the card is "Needs attention", includes CPU load, and follows the limits you set.

---

## Alerts and notifications

### Notifications (webhook)

- **Label:** card "Notifications"; fields "Webhook URL", "Send" ("Every deployment", "Failures only"); buttons "Save", "Send test message", "Remove" (`components/project-automation.tsx:123-260`).
- **What it does:** posts a short message to a Discord or Slack incoming webhook when a deployment finishes (Ready or Error), and the alerts below use the same webhook.
- **Accepted URLs (`server/notify.ts:22-51`):** https, no port, query, hash or credentials. Discord hosts `discord.com`, `discordapp.com`, optionally with `ptb.` or `canary.`, path `/api/webhooks/<digits>/<token>`. Slack host `hooks.slack.com`, path `/services/<A-Z0-9>/<A-Z0-9>/<token>`. The URL is stored encrypted and never shown again; the card says "Sending to Discord for every finished deployment. The URL is hidden. Paste a new one to replace it."
- **Message:** "<project> is live in production|a preview" or "<project> failed to deploy to production|a preview", then branch, short sha and commit message (or error up to 200 characters), duration, and a link. Discord messages block mentions (`allowed_mentions: { parse: [] }`). Posts time out after 5 seconds, redirects are refused, and a failed post is logged only (`notify.ts:100-116,191-193`).
- **Test:** "Send test message" posts "Test from Egg for <project>". Messages: "Sent. Check the channel." ; "Add a webhook URL first." (400) ; "Discord answered <status>." / "Slack answered <status>." (502).
- **Errors:** "That is not a valid URL." ; "Use the plain https webhook URL from Discord or Slack." ; "Only Discord and Slack incoming webhook URLs are supported." ; "Could not save" ; "Could not send" ; "Could not remove".
- **Filtering rules:** "Failures only" suppresses Ready messages. The "Deployment results" alert channel and an active pause also suppress them. The event is still written to history (`notify.ts:160-190`).
- **Needs:** sign-in. API: `notifications:read` (read settings and send a test).

### Alerts

- **Label:** card "Alerts": "Pause all alerts", "When to warn" ("Disk full (%)", "Memory used (%)", "CPU load per core (%)", "Failed checks before down", "Slow response limit (ms)"), "Send to the webhook" (four checkboxes), "History" (`components/project-automation.tsx:379-715`).
- **Alert types:** `down` ("Not answering"), `disk` ("Disk"), `memory` ("Memory"), `cpu` ("CPU load"), `deploy` ("Deploy result") (`schema.ts:441`).
- **Defaults and ranges:** disk, memory and CPU limits default 90, whole numbers 1 to 100. CPU is the 1 minute load average divided by the core count. Failed checks 1 to 10, default 2. Slow response limit empty (off) or 50 to 60000 ms (`server/notify.ts:231-267`, `schema.ts:162-168`).
- **Channels (all on by default):** "The app stops answering", "The app answers again", "Disk, memory or CPU warnings", "Deployment results" (the last also follows the "Send" setting above).
- **One alert per lasting problem:** an alert row is opened when the problem starts and stays open until it clears. A resource alert fires once when a value reaches its limit and once more when it falls back below; nothing is sent between (`monitor.ts:111-119`, `notify.ts:520-565`). A down alert fires once when the project flips to down and a recovery once when it flips up (`monitor.ts:141-155`). The disk, memory and CPU figures are for the whole server; each project checks them against its own limits.
- **Messages:** "<project> is not answering" / "<project> is back up" ; "<project>: disk usage is high" / "disk usage is back to normal" (and memory, CPU load) with "Disk on the server reached 91% (your limit is 90%)." / "Disk on the server is back below 90% (now 85%)." (`monitor.ts:127-132`, `notify.ts:472-487`).
- **Pause:** select "For 1 hour", "For 24 hours" or "Until I resume", press "Pause". While paused nothing is sent but history still records the event with the badge "Not sent, paused". "Resume alerts" ends it. A recovery is not sent for an alert that was muted when it fired (`notify.ts:546-565`). Toasts "Alerts paused", "Alerts resumed".
- **History:** newest 50, badges "Still happening", "Resolved", "Not sent, paused"; "Kept for 90 days" (`notify.ts:229,336-357`). Open resource and down alerts are kept past 90 days; resolved rows and deploy rows are pruned (`notify.ts:440-455`).
- **Errors:** "The disk limit must be a whole number from 1 to 100." (and the memory, CPU forms) ; "The response time limit must be at least 50 ms." ; "The response time limit cannot be above 60000 ms." ; "Failed checks must be a whole number from 1 to 10." ; "Could not load alert settings" (with "Try again") ; "Could not save" ; "Could not pause alerts" ; "Could not resume alerts".
- **Needs:** sign-in; the worker running. A webhook is needed for any message to be sent. API: `alerts:read`.

---

## Status page

- **Label:** card "Public Status Page"; buttons "Publish status page" and "Unpublish" (`components/project-automation.tsx:263-324`). Page at `<APP_URL>/status/<key>` (`app/status/[key]/page.tsx`).
- **What it does:** a public page for one project. It shows the project name, a state card ("Operational" / "The app is answering.", "Not responding" / "The app has stopped answering.", "No data yet" / "Checks have not run for this app yet."), the uptime share over 30 days, a strip of 30 days, and "Recent outages" (the latest 10) (`server/status-page.ts:112-159`). It shows nothing else.
- **The strip:** one square per UTC day, ending today. Up (answered all day), partial (down for part of the day), down (down for more than half of it), none (no checks yet) (`status-page.ts:89-110`). Hover text gives the minutes.
- **Window:** `windowDays = 30` (`status-page.ts:132`). The percentage is withheld until a check has run.
- **Key:** 9 random bytes, shown as 12 URL-safe characters (`randomToken(9)`, `status-page.ts:22`). The page is `noindex` (`robots: { index: false, follow: false }`). Unpublishing deletes the key, so the old link stops working; publishing again makes a new key.
- **Source of truth:** the uptime checks (every 5 minutes) via the Activity records `monitor.down` and `monitor.up`. A very short outage can be missed. A slow response above the "Slow response limit" counts as down on this page too, because it makes a failed check.
- **Needs:** sign-in to publish; nothing to view. API: `projects:read` shows the status page URL.

---

## Analytics

### Turn on analytics and paste the snippet

- **Label:** page "Analytics" (project tab); card "Count visits" then "Tracking snippet"; buttons "Turn on analytics" and "Turn off" (`components/analytics-setup.tsx`).
- **What it does:** creates a key `nda_<random>` and shows `<script defer data-key="nda_..." src="<APP_URL>/api/analytics/script?key=nda_..."></script>` to paste into the head of every page you want counted, then redeploy (`server/analytics.ts:23-52`).
- **Counted by default:** page path and referring site only. No cookies. No IP address or browser details stored. A visitor is a hash of IP, browser, project and the date, salted with `APP_SECRET`, truncated to 16 characters, so it cannot be followed across days (`analytics.ts:83-85`).
- **Skipped:** browsers that send Do Not Track or Global Privacy Control (the script exits, and the collector also drops a request carrying `DNT: 1` or `Sec-GPC: 1`), localhost and 127.0.0.1, and known bots (user agent matching bot, crawl, spider, slurp, preview, monitor, headless, lighthouse, curl, wget, python-requests) (`server/analytics-script.ts:25-27`, `server/analytics-events.ts:47-49`, `analytics.ts:56`).
- **Rate guard:** one page view per second per project and address; click, time and goal events 30 per 10 seconds per project and address (`analytics.ts:89-98`, `analytics-events.ts:59-73`).
- **Path cleaning:** query and fragment removed, trailing slash removed, 200 characters (`analytics.ts:63-69`). Referrer reduced to the host without `www.`, 100 characters.
- **Turning off:** "Turn off" removes the key; existing numbers stay until they age out (90 days).
- **Retention:** 90 days (`PAGEVIEW_KEEP_MS`); clicks, times and goals age out the same way by day (`analytics.ts:132-138`). Pruning runs inside the worker's monitor pass.
- **Caching:** the script response is cached 5 minutes with a key, 1 hour without (`app/api/analytics/script/route.ts`). A setting change reaches visitors in about 5 minutes.
- **The collector:** `POST /api/collect/<key>`, any origin, always answers 204 whether or not the key exists (`app/api/collect/[key]/route.ts`). The body is limited to 5000 characters and is read as text.
- **Needs:** sign-in. API: `analytics:read`.

### What you see

- Page views and visitors for the last 30 days, a bar chart per day, "Top pages" and referring sites (top 10 each) (`server/analytics.ts:154-207`). "Visitors are counted per day, so someone who comes on two days counts twice."
- Percentages, shares and the median appear only with at least 50 visits or visitors behind them (`MIN_SAMPLE = 50`, `server/stats.ts:31`). Below that the page shows counts and "Not enough data".

### What else to record (opt-in)

Card "What else to record". Each is off until turned on; with all off the script is the plain page-view script (`server/analytics-script.ts`).

- **Clicks** ("Top clicks"): records the label of the clicked link, button, `[role=button]`, `[role=link]` or `summary`, or any element with `data-egg-track`. The label is `data-egg-track`, else `aria-label`, else the text, collapsed whitespace, at most 40 characters. A label containing an email address is dropped whole. URL-like words lose their query and fragment. Never records input values, form content or visitor ids; stores only the project, the UTC day and the label (`analytics-events.ts:22-44`). Top 10 shown.
- **Time on page:** time the page was open and visible, bucketed "Under 10 seconds", "10 to 60 seconds", "1 to 5 minutes", "Over 5 minutes", with median and shares once there are 50 visits. Sent when the page is left or the route changes. Stores the day and bucket only (`analytics-events.ts:19,168-244`).
- **Funnel:** 2 to 6 steps (`MIN_STEPS`, `MAX_STEPS`, `analytics-config.ts:26-27`), each a page path starting with `/` or a "Tracked name" (`data-egg-track`; letters, digits, spaces and `- _ . :`, at most 40 characters, `TRACK_NAME`). Shows visitors reaching each step and who dropped off. A visitor counts at a step only after reaching the ones before it, in order, on the same UTC day. Tracked-name steps store the name, the daily visitor hash and the time. A funnel with fewer than 2 steps counts as off.
- **Errors:** "A funnel needs at least 2 steps" ; "A funnel has at most 6 steps" ; `A page step starts with "/", like /pricing` ; "A tracked name uses letters, numbers, spaces and - _ . : and is at most 40 characters" ; "Could not save" ; "Could not change analytics".
- **Needs:** sign-in; analytics on.
- **Files:** `components/analytics-{setup,features,insights,chart,top-list}.tsx`, `server/analytics*.ts`, `app/api/{analytics/script,collect/[key],projects/[id]/analytics}/route.ts`.

---

## Access tokens, API and MCP

### Developer page and access tokens

- **Label:** sidebar "Developer", page "Developer", section "Access tokens", button "Create token" opening the dialog "New token" (`components/developer-tokens.tsx`, `app/(app)/developer/page.tsx`).
- **Create steps:** name the token ("Name", 1 to 60 characters), tick "Permissions" (quick picks "Read only" and "Deploy"), choose "Expires after" (7, 30, 90 or 365 days; default 90), press the create button, then copy the secret. The secret starts with `egg_` and is shown once ("Copy it now. It will not be shown again.").
- **Quick picks:** "Read only" ticks every permission whose id ends in `:read` (which includes `files:read`). "Deploy" ticks the deploy preset (`developer-tokens.tsx:443-444`, `lib/developer.ts`).
- **Edit and revoke:** each active token has "Edit <name>" (name, permissions, expiry counted from now; a revoked token is final) and "Revoke <name>" (dialog `Revoke "<name>"?`). Groups: "Active", "Expired". Status words: Active, Expired, Revoked. Dropping the deploy permission shows "Deploys will stop working for anything that uses this token, including redeploys, cancels and rollbacks."
- **Limits:**
  - 25 active tokens per account (`MAX_TOKENS_PER_USER`, `server/api-tokens.ts:77`; shown as "N of 25 active tokens used. Revoked and expired tokens do not count." and "You have 25 active tokens, the most allowed. Revoke one to create another.")
  - expiry choices 7, 30, 90, 365 days (`api-tokens.ts:84`)
  - a token holding `terminal:use` or `files:write` lives at most 7 days; if no expiry is sent it gets 7 days (otherwise 90) (`api-tokens.ts:68-69,153-157`)
  - only a SHA-256 of the token is stored; `lastUsedAt` is updated at most once an hour (`api-tokens.ts:283`)
  - tokens cannot create tokens, remove leftovers, change container permissions, or manage the account or sessions (`api-tokens.ts:8-17`)
- **Errors:** "Give the token a name." ; "Pick at least one permission." ; "You can have up to 25 active tokens. Revoke one first." ; "A token with the terminal or file change permission expires in 7 days at most. Pick 7 days, or remove that permission." ; on edit "...Set the expiry to 7 days in the same change, or remove that permission." ; "This token is revoked and cannot be edited." (409) ; "Token not found" ; "Could not load your tokens".
- **Where the docs and code differ:** the OpenAPI description says tokens are "created in Account" (`server/api-v1-openapi.ts:26`); they are created on the Developer page.
- **Needs:** sign-in. Tokens need a fresh sign-in for nothing.

### Scopes

18 scopes (`server/api-tokens.ts:20-61`):

- `projects:read` Read projects, their settings and status page
- `projects:write` Create, change and delete projects, including build and start commands
- `deployments:read` Read deployments and build output
- `deployments:write` Deploy, redeploy, cancel and roll back, and replace or revoke the deploy hook
- `logs:read` Read runtime logs
- `env:read` List environment variable names (never their values)
- `env:write` Set and remove environment variables
- `domains:read` Read domains
- `domains:write` Add, check and remove domains
- `notifications:read` Read notification settings and send a test message
- `alerts:read` Read alert settings and history
- `analytics:read` Read visitor analytics
- `activity:read` Read your activity log
- `resources:read` Read CPU, memory and disk, now and over time
- `container:read` List servers and see what is on the container (read only)
- `files:read` List and read files in a project's folder on the container
- `files:write` Create, change, rename and delete files in a project's shared/ folder (never the live release)
- `terminal:use` Open and use a shell on the container. Commands run for real

Only `projects`, `deployments`, `env` and `domains` have a write scope. Notifications, alerts, analytics, resources, activity, container and logs are read only (and `notifications:read` also sends a test message). There is no write scope to change notification or alert settings. `files:write` and `terminal:use` are marked short-lived and additionally need the matching container switch on.

### The REST API and the OpenAPI document

- **Address:** `<site>/api/v1/...`, bearer token only (`Authorization: Bearer egg_...`). The OpenAPI 3.1 document is at `/api/v1/openapi.json`, generated from the same endpoint list as the routes and MCP tools (`server/api-v1-openapi.ts`).
- **First call:** `GET /api/v1/me` needs no scope. Returns the owner's display name, the token's name, scopes and expiry, and counts of servers and projects. No email, no ids (`server/api-v1-me.ts`).
- **Endpoint list (id, method, path, scope, rate bucket):** `list_projects`, `get_project`, `create_project`, `update_project`, `delete_project`; `list_deployments`, `deploy_branch` (POST `/projects/{id}/deployments`), `get_deployment`, `get_deployment_logs` (ssh bucket), `redeploy`, `cancel_deployment`, `rollback_deployment`; `get_logs`; `list_env_vars`, `set_env_var` (PUT `/projects/{id}/env/{key}`), `delete_env_var`; `list_domains`, `add_domain`, `verify_domain`, `remove_domain`; `rotate_deploy_hook`, `revoke_deploy_hook`; `get_notifications`, `test_notification`, `get_alerts`, `get_status_page`, `get_analytics`; `get_server_usage`, `get_resource_history` and `get_project_resources` (ssh bucket); `list_servers`, `get_container_inventory` (ssh bucket); `get_activity`; terminal: `terminal_status`, `terminal_open`, `terminal_send`, `terminal_read`, `terminal_resize`, `terminal_close`; files: `list_files`, `read_file`, `download_file`, `make_folder`, `rename_file`, `write_file`, `delete_file` (all ssh bucket).
- **Limits:** per token per minute: 120 reads, 30 changes, 10 for SSH-opening calls, 300 for terminal input (`api-v1-kit.ts:24-29`). Request body at most 16 KB unless an endpoint says otherwise (`DEFAULT_MAX_BODY_BYTES`). API file write at most 1 MB; API file download at most 2 MB (`api-v1-shell.ts:151,260`). Unknown body fields are refused: `Unknown field "<name>". Allowed: ...` (400).
- **Errors:** 401 "Send an access token as an Authorization: Bearer egg_... header." ; 401 "That access token is not valid." (missing, revoked, expired and unknown look the same) ; 403 "This token does not have the <scope> permission." ; 404 "No such item, or it belongs to someone else." ; 413 "The request body is too large." ; 429 "Too many requests for this token. Wait <n> second(s) and try again." with `Retry-After` ; 502 container not reachable ; 503 "Too many terminals are open right now. Try again soon." Errors are JSON `{ "error": { "code", "message" } }`.
- **Audit:** deploys, redeploys, rollbacks, cancels, file and terminal actions made with a token record "via: api" and the token id; Activity shows the token name.
- **Secrets:** environment values, webhook URLs and token secrets are never returned; the deploy hook URL is returned once by the call that creates it. The API refuses to read `current/.env` and `releases/<id>/.env` with 403 "That file holds the project's environment variable values, which are never returned by the API." (`api-v1-shell.ts:162-178`).
- **Developer page extras:** "Build with it" lists the TypeScript client (one file, `web/src/lib/sdk/egg.ts`), a Node script, a Python script, a static dashboard, a GitHub Actions workflow and MCP config, each stating which permissions it needs (`lib/developer.ts:BUILD_RESOURCES`). Copyable examples use the placeholder `egg_...`.

### MCP endpoint

- **Address:** `POST <site>/api/mcp`, JSON-RPC 2.0, one message per request, one JSON response, no streaming, no sessions, no batches (`server/mcp.ts`, `app/api/mcp/route.ts`). GET and DELETE answer 405 "This endpoint only accepts POST." Bearer token only; body at most 64 KB.
- **Methods:** `initialize` (protocol versions 2025-06-18, 2025-03-26, 2024-11-05), `ping`, `tools/list`, `tools/call`. Notifications get 202 with no body. Tools are the same endpoints as the REST API, with the same scopes, limits and checks. The server's `instructions` string tells agents to call `get_me` first.
- **Errors:** tool errors come back as results with `isError: true` and text `<code>: <message>`; "internal: Something went wrong on our side." ; JSON-RPC errors -32700, -32600, -32601, -32602, -32603; "Batches are not supported. Send one message per request." ; "Not a JSON-RPC 2.0 message." ; "Unknown tool: <name>". A 429 is an HTTP error with `Retry-After`.
- **Needs:** a token with the scopes of the tools it calls.

---

## Terminal

- **Label:** project tab "Terminal"; heading "Terminal"; "Open terminal" (busy "Connecting…"); "Resume terminal"; "Close it"; "Open a new terminal"; "Reopen terminal" (`components/terminal-view.tsx`, `app/(app)/projects/[slug]/terminal/page.tsx`).
- **What it does:** a live shell on the container, started in `~/.egg/<slug>`, in the browser. The page says "This is a shell on your Nest container." and, after it connects, who it runs as ("This shell runs as root on <host>." or "...as the container user (uid <n>) on <host>.").
- **Off by default.** With the switch off the page shows "The terminal is turned off for this server." and "Go to Account".
- **Steps:** turn on Terminal in Account (fresh Hack Club sign-in), open the project's Terminal tab, press "Open terminal", type. "Close" ends it.
- **Limits (`server/terminal.ts:22-40`):**
  - idle: 10 minutes without input (input counts as activity; output does not)
  - total: 60 minutes, whatever you do
  - one terminal per user per project at a time
  - at most 50 terminals open on the whole server
  - one input request at most 8 KB; 300 input requests per minute per user
  - the last 64 KB of output is kept so a reload can resume
  - size 20 to 400 columns, 5 to 200 rows
  - sessions live in server memory, so a restart of the web process ends them
  - a countdown shows time left; "Type something to keep it open." and "It is reaching the 60 minute limit."
- **Ending messages (`terminal-view.tsx:48-64`):** "Terminal closed after a pause" ("It closes after 10 minutes without typing. Anything running in it was stopped."), "Terminal reached its time limit" ("A terminal closes after 60 minutes, whatever you are doing. Anything running in it was stopped."), "Terminal closed", "The shell ended", "The connection dropped", "The terminal stopped", "This terminal is no longer open".
- **Errors:**
  - 403 "The terminal is turned off for this server. Turn it on in Account, under Container permissions."
  - 409 "This server has not been verified yet. Run Test connection on the Connect page first." (no pinned host key)
  - 409 "A terminal is already open for this project. Resume or close it first."
  - 503 "Too many terminals are open right now. Try again soon."
  - 403 "The terminal was closed before it opened." (signed out or switched off while connecting)
  - 400 "The terminal size must be 20 to 400 columns and 5 to 200 rows."
  - 429 "Too many requests for terminal input. Wait <n> second(s) and try again."
  - 404 "Terminal session not found"
  - "Could not open a terminal." ; "Could not close the terminal." (client fallbacks)
- **What is recorded:** only when a terminal opens and closes ("Opened a terminal on", "Closed a terminal on" with duration and reason, "Closed a terminal after a sign-out on"). Keystrokes and output are never recorded.
- **Ends on:** sign-out, revoking a session, deleting the account, switching the terminal off, an SSH drop or the shell exiting.
- **Needs:** Terminal switch on for that server, sign-in. API: `terminal:use` (7 day token) plus the switch. Turning the switch on needs a fresh sign-in; using it does not.
- **Files:** `server/terminal.ts`, `server/ssh/shell.ts`, `app/api/projects/[id]/terminal/**`, `server/api-v1-shell.ts`, `components/terminal-{view,screen}.tsx`.

---

## File manager

- **Label:** project tab "Files"; heading "Files"; "New folder", "Upload"; breadcrumb "Folder path"; dialogs "Create", "Rename", "Delete"; "Discard unsaved changes?"; "Replace" (`components/file-manager.tsx`).
- **What it does:** browse, read and download files in the project's folder on the container (`~/.egg/<slug>`); with File changes on, create folders, upload, edit text, rename and delete inside `shared/`.
- **Areas (`server/files-paths.ts:1-12,81-101`):** `shared/**` writable (when the switch is on) and survives deploys; `current/**` the live release, read only always; `releases/**`, `incoming/**` and anything else read only. `shared` itself cannot be renamed or deleted.
- **Notices:** "current/ is the live release and is read only." "Changing it here would change the code your app runs. Make code changes in your repository and deploy. Files that must last, like data or settings, belong in shared/." ; "This location is read only. Files in shared/ can be changed." ; with the switch off: "File changes are turned off for this server." plus an explanation and a link to Account ; "Uploads are not allowed here" / "Open shared/ first."
- **Steps to edit:** switch on File changes, open `shared/`, select a file, edit and save; New folder; Upload; rename; delete (folders need typing the name).
- **Limits:**
  - path at most 1024 characters, each name at most 255 bytes, no `..`, no absolute paths, no empty segments (`files-paths.ts:14-63`)
  - text preview and edit: first 1 MB (`READ_LIMIT`)
  - upload and download: 50 MB (`UPLOAD_LIMIT`, `DOWNLOAD_LIMIT`)
  - folder listing: 3000 entries (`LIST_LIMIT`, `files.ts:32`), more are not shown
  - 60 file changes per minute per user
  - symbolic links are never written through; links are resolved and refused when they leave the project folder
  - an upload that arrives short is refused: "The upload arrived incomplete. Nothing was saved."
- **Errors (`server/files.ts:189-200`):** "This project has no folder on your container yet. Deploy it first." ; "That path leaves the project folder." ; "This location is read only. Files in shared/ can be changed. The live release (current/) cannot." ; "Nothing exists at that path." ; "That path is not a folder." ; "That path is not a file." ; "That file is over the 50 MB limit." ; "That path is a symbolic link. Files are not written through links." ; "That path is a folder." ; "Something with that name already exists." ; "This container's tools are too limited to list files." ; "Your container could not finish that. Try again." ; "That is the same path." ; "A folder cannot move into itself." ; "Changing files is turned off for this server. Turn it on in Account, under Container permissions." ; "Could not save the file." ; "The upload failed." ; "Over the 50 MB limit." ; "A folder with this name already exists." ; "Could not load this folder".
- **Binary and large files:** "Binary file, cannot preview" ; "Too large to preview" ; "This file is empty." ; "No file selected".
- **The .env file:** Egg writes each release's variables to `.env` at the top of the release. The API refuses to read or download `current/.env` and `releases/<id>/.env` ("secret_file", 403). The browser file manager has no such refusal and can open them (read, list and download routes do not check). See the discrepancy list.
- **Audit:** "Saved a file on", "Created a folder on", "Renamed a file on", "Deleted a file on" with the path. File contents are never recorded.
- **Needs:** reading: sign-in only, no switch. Changing: File changes switch on for that server. API: `files:read`, `files:write` (7 day token) plus the switch.
- **Files:** `server/files.ts`, `server/files-paths.ts`, `app/api/projects/[id]/files/*/route.ts`, `components/file-manager*.tsx`.

---

## Container page: inventory, leftovers and ownership markers

### Container page

- **Label:** sidebar "Container"; heading "Container"; "What is running on <server>, and what Egg left behind."; "Refresh" (busy "Reading…"); server select when you have more than one (`components/container-view.tsx`).
- **What it does:** reads the container in one SSH round trip, read-only (`server/inventory.ts:401-416`, `server/ssh/inventory-probe.ts:116-165`). Timeout 60 seconds.
- **Sections:**
  - disk bar "Disk used": "<n>% used." and how much of it is Egg folders (a warning colour from 80%)
  - "Projects": the service per project (Running, Starting, Crashed, Stopped, or "No service yet"), port, folder size, previews and their ports, and a warning "Port <n> is held by <x>, not by <project>." with a "Change the port" link
  - "Orphans" (leftovers)
  - "Other ports": programs listening that Egg did not start, read-only ("This container only" or "Open to the network"); "This container has neither ss nor netstat, so its listening ports could not be read." ; "The container did not share process names, so ports are matched to projects by their number only."
  - port conflict alert: "A port is already taken" / "Some ports are already taken": "<project>'s port ... The next deploy of <project> will fail its health check until that is sorted out."
- **Empty states:** "Connect a server first" ; "Nothing is running here yet" ; "No leftovers".
- **Errors:** connection errors become "We can't reach your container right now" with a retry; "The container's answer was cut short, so nothing was classified." (nothing is classified from a half-read answer) ; 502 and 504 with the SSH message.
- **Needs:** sign-in. API: `container:read`.

### Removing leftovers (Orphans)

- **What counts as a leftover:** a unit named `egg-<slug>.service` or `egg-<slug>-pv-<8 hex>.service` that no project (or live preview record) uses, and a folder under `~/.egg/` that is not a project's slug. Kinds: "Service", "Preview service", "Folder" (`inventory.ts:119-292`).
- **Steps:** turn on Removing leftovers in Account, open Container, press "Remove" on a row, confirm.
  - Service dialog "Remove <unit>?": "This stops the service, turns off starting it at boot and deletes its unit file. Files in its folder are not touched." Confirm "Remove service".
  - Folder dialog "Delete the folder <name>?": "This permanently deletes ~/.egg/<name> and everything inside it (<size>), including any data in its shared folder. It cannot be undone." You must type the folder name. Confirm "Delete folder".
- **Safety rules (`inventory.ts:433-547`, `inventory-probe.ts:312-357`):** every id is validated against a strict pattern, then checked against a fresh read, so anything that belongs to a project is refused even if named. A removal runs only when the item carries the Egg marker and is not a symbolic link; the script checks again on the container. Folders must resolve to a direct child of `~/.egg`.
- **Limits:** at most 50 ids per request (`MAX_ORPHANS_PER_REQUEST`); 10 requests per minute per user; script timeout 120 seconds.
- **Row notes:** "A link, so it cannot be removed here"; "Its folder is listed here too"; "What it runs" (the ExecStart line).
- **Results and messages:** removed, gone, refused, failed. "It is no longer on the container." ("<id> was already gone" toast) ; "This belongs to one of your projects, so it was left alone." ; "Egg did not create this, so it was left alone." ; "This is a link, so it was left alone." ; "That is not an Egg name." ; "That service is not in Egg's service folder, so it was left alone" ; "This service was not created by Egg, so it was left alone" ; "That folder is a link, so it was left alone" ; "This folder was not created by Egg, so it was left alone" ; "Refusing a folder outside <base>" ; "The unit file is still there" ; "The folder is still there" ; "Choose something to remove." ; "Remove at most 50 items at a time." ; "Nothing was removed." (client). Success toasts "Removed <id>" and "Deleted the folder <id>".
- **Switch off:** a note "Removing leftovers is turned off for this server. Leftovers are still listed, but they cannot be removed from here. Turn removal back on in Account, under Container permissions." with "Go to Account". 403 from the API with the standard refusal text.
- **Recorded:** "Removed a leftover from the container" with the kind and name only.
- **Needs:** Removing leftovers switch on, sign-in. Not available to API tokens or MCP.

### Ownership markers

How Egg tells what it created from what you made (`server/deploy/layout.ts:61-78`):

- a unit file carries a first-lines comment `# egg:managed project=<slug>`; there is no other rule for units
- a project folder carries the file `.egg-managed`; an older folder without it counts as ours only when it holds nothing but `releases`, `incoming`, `shared`, `current`, `current.new` and has no `.git`
- anything without a marker is never overwritten, stopped, moved or deleted by Egg: the deploy refuses (exit 30), the cleanup refuses, project deletion leaves it ("<path> was not created by Egg, so it was left alone.")
- the marker file is created when the deploy first prepares the folder (`remote.ts:41`)

### Adoption checks

See "Adopt an existing checkout and container conflict check" under Projects. The probe code is in `server/ssh/adoption-probe.ts` and `server/adoption.ts`.

---

## Activity

- **Label:** sidebar "Activity"; filters "Search by action, project or detail", "Kind" (All, Projects, Deployments, Domains, Servers, "Access and tokens", Monitoring, "Terminal and files"), "Date range" ("Last 24 hours", "Last 7 days", "Last 30 days", "All time"); button "Load more" (`components/activity-view.tsx`, `components/activity-filters.tsx`, `server/activity.ts`).
- **What it does:** a newest-first log of your own changes, grouped by UTC day, with details per entry. Examples of action text: "Created project", "Changed settings for", "Redeployed", "Rolled back", "Canceled a deployment of", "Deployed through the deploy hook for", "Detected downtime on", "Created an access token", "Opened a terminal on", "Saved a file on", "Changed container permissions for", "Removed a leftover from the container" (`server/audit.ts:29-70`).
- **Secrets:** meta keys and values that look like secrets are dropped before display (`server/activity.ts:238-307`).
- **Limits:** 50 entries per page (`PAGE_SIZE`, `activity.ts:9`); a search scans at most the newest 5000 entries, in batches of 200, and says when it stopped at the limit (`server/activity-query.ts:11-14`); search text 80 characters. No pruning of the audit log was found in the code; only account deletion removes it. UNCONFIRMED retention: nothing deletes old rows, but nothing guarantees them either.
- **Errors:** "Could not load more" ; empty states "No activity yet" and "Nothing in this range yet".
- **Note:** monitor events for a project and hook triggers by URL are written with the owner's user id, so they appear in Activity.
- **Needs:** sign-in. API: `activity:read`.

---

## Public stats page

- **Label:** "Stats" in the marketing site (`app/(marketing)/stats/page.tsx`), sections "Usage", "Reliability", "Shape of the work", "About"; JSON at `GET /api/stats` (public, no sign-in, no cookie, cached 5 minutes) (`app/api/stats/route.ts`, `server/stats-cache.ts`).
- **What it shows:** totals only: accounts, 7-day sign-up growth, servers connected, projects deployed, status pages, domains mapped, active tokens, deployments started through the API, deployments in the last 30 days (daily, by outcome, environment, weekday and UTC hour), success rate, median and 90th percentile build time, projects per runtime, and the share of checked projects that were up (`server/stats.ts`).
- **Privacy rules:** a count under 10 is shown as "fewer than 10"; larger counts keep two significant figures; a series bucket under 10 is hidden the same way; a percentage, median or percentile appears only with at least 50 items behind it, otherwise "Not enough data"; growth needs 50 sign-ups in both weeks; windows are 30 days (`WINDOW_DAYS`) and 7 days (`GROWTH_DAYS`); all times are UTC (`stats.ts:13-39`).
- **Needs:** nothing.

---

## Other features

- **Find** (`components/find-palette.tsx`): press `F` (when not typing and no modifier key) or use the "Find" control; search box "Find pages and projects…" jumps to pages, "New project", "Docs", "Account" and your projects (`lib/nav.ts:233-253`).
- **Projects page** (`app/(app)/projects/page.tsx`): the list of projects with search ("Try a project name, repository, or domain."), the "Needs attention" card, the "UsageCard" and "Recent deployments" (latest 5).
- **Empty states:** "Connect your Nest container first" ; "Import your first repository" (`components/projects-view.tsx`).
- **Server switcher and project switcher** in the sidebar (`components/server-switcher.tsx`, `components/project-switcher.tsx`).
- **Navigation:** team level "Projects", "Deployments", "Logs", "Resources", "Domains", "Activity", "Container", "Developer", "Connect"; project level "Overview", "Deployments", "Analytics", "Files", "Terminal", "Settings" (`lib/nav.ts`). "Account" opens from the account menu.

---

## Checked against the existing docs (`web/src/app/(marketing)/docs/_content/sections.tsx`)

Claims the code contradicts or qualifies:

1. `sections.tsx:120` "Rotate key" and `:123` "Remove a server": the labels in the product are "New key" and "Disconnect" (`components/connect-flow.tsx:149-173`). Disconnect also deletes every project on that server from Egg through the foreign-key cascade (`server/db/schema.ts:121-123`), which the docs and the dialog do not say.
2. `sections.tsx:214-216` "Deploy builds a branch now": the project page "Deploy" button can only build the production branch (`components/deploy-button.tsx`, no branch picker in the UI). It is labelled "Redeploy" when something is live (`app/(app)/projects/[slug]/page.tsx:146`) but builds the branch tip, not the same commit. The same-commit action is "Redeploy" in a row's actions menu. The rollback label is "Instant rollback", not "Rollback" (`sections.tsx:222`).
3. `sections.tsx:232-235` "shows 25 at a time with a Show more button": the button reads "Show N more", and the page loads only the newest 100 deployments (`server/queries.ts:192`), so "25 at a time" is a window onto at most 100.
4. `sections.tsx:238-239` "Production keeps your last five releases and the one that is live": correct for counting (`pipeline.ts:260-268`), but only Ready releases count and, after a rollback, up to six production releases can exist.
5. `sections.tsx:257` and `:673` "never shown again in full" and "never sent back to your browser": values are never returned by the env routes or the API, but the browser Files page can open `current/.env` in plain text (`app/api/projects/[id]/files/read/route.ts` has no check; the API-only refusal is `server/api-v1-shell.ts:162-178`).
6. `sections.tsx:272-275` "Values are masked wherever they would appear in build or deploy output": only values of 4 or more characters are masked, and only as the exact text (`server/deploy/logger.ts:22`, `build.ts:177`).
7. `sections.tsx:288-289` runtime logs "latest 300 lines and can refresh every five seconds" is right, but the page also has a time range (1 hour, 24 hours, 7 days) and a level filter "Warnings and errors" and a "Download" button the docs do not mention (`components/logs-view.tsx`). Search and level read the newest 1000 lines.
8. `sections.tsx:324-345` "Pull requests from forks, draft pull requests, and pull requests from the production branch are not built": a push to the head branch of a draft pull request in the same repository still builds a preview through the push webhook (`server/github/webhook.ts:60-86`). Only the pull request event skips drafts. The PR comment content also includes the project name, branch and port, not only "the state, the commit and a link" (`server/github/pulls.ts:31-49`).
9. `sections.tsx:329-333` "With Deploy automatically on, a push ... deploys": not for projects made from a pasted public repository URL, which store no `repoFullName` (`new-project-flow.tsx:224,624-629`, `webhook.ts:48-51`).
10. `sections.tsx:390-392` "Only discord.com and hooks.slack.com webhook URLs are accepted": also `discordapp.com`, `ptb.discord.com`, `canary.discord.com` (`server/notify.ts:22-25`).
11. `sections.tsx:414-432` and `:739` "Down after two failed checks": two is the default; it is a per-project setting from 1 to 10, with an optional slow response limit and per-project disk, memory and CPU limits, four channel switches and a pause (`server/notify.ts:231-291`). The docs do not describe these controls at all. The "overview's Alerts card" is titled "Needs attention", also lists CPU load, and uses your own limits, not a fixed 90% (`app/(app)/projects/page.tsx:39-185`).
12. `sections.tsx:486-488` "Domains, alerts and notifications, analytics, resources and activity. Read or change, each on its own permission.": only domains (and projects, deployments, env) have write scopes. Notifications, alerts, analytics, resources and activity are read only (`server/api-tokens.ts:20-39`).
13. `sections.tsx:509-511` "/api/mcp ... offers the same calls as tools": checked, correct (`server/mcp.ts:60`).
14. `sections.tsx:466-469` "Give the token a name ... 7, 30, 90 or 365 days": matches. The OpenAPI text says "created in Account" (`server/api-v1-openapi.ts:26`), which is wrong.
15. `sections.tsx:575-578` analytics steps are right. `:631` "History ... is kept for 90 days" matches (`server/analytics.ts:21`).
16. `sections.tsx:742` "Your container: Nest sets it: 2 vCPU, 2 GB of memory and 16 GB of disk by default." UNCONFIRMED: no code reads or sets these; they are not in the repository's logic.
17. The docs have no section on: container permissions, the Terminal, the Files tab, the Container page and leftover removal, ownership markers, adoption checks, "Copy build settings", repository detection, bulk Cancel and Delete previews, Compare, alert controls and pause, or the Resources page's 7-day view beyond one sentence. Every one of those is in the product.

## UNCONFIRMED list (collected)

- Whether bulk "Delete previews" should need the Removing leftovers switch (`server/deployments-bulk.ts:44-69` does not check it).
- Which row wins when an environment variable exists for All and for one target (`server/deploy/pipeline.ts:91-95`, no ordering).
- Whether canceling after the release switch stops the switch (`pipeline.ts:333,387,423` are the only checks).
- Whether the "Building" status pill should include deploying deployments (`lib/deployments-filter.ts:41-42` matches `building` and `queued` only).
- Retention of Activity rows: none found.
- Exact notice text for `/new?github=...` results: not read.
- Whether more than the first server can be used on the Domains page.
- Reauth failure messages for the permission switches: set by the server, shown nowhere.
- Hosted container sizes (2 vCPU, 2 GB, 16 GB) quoted in the docs.
- Whether the probe's "error" issues should block a deploy (`server/ssh/probe.ts:98-100` says so, nothing enforces it).
- Stale code comments that say the opposite of the code: `server/permissions.ts:15-17` says the terminal input and resize routes do not call a guard (the input route does, `app/api/projects/[id]/terminal/[sessionId]/input/route.ts:21-22`); `app/(app)/projects/[slug]/files/page.tsx:36` says file changes default to on (they default to off). Writers should follow the code.
