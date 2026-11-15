# Permissions: what each switch can do, and what is off by default

Rule: default deny. Anything that can run code, change files, delete things or
publish information starts off, and the person turns it on on purpose. People
already run apps on their container, so a default must never stop, restart,
overwrite or delete something Egg did not create.

Date of this review: 2026-11-05. Code references are to `web/src`.

## 1. The matrix

### Container switches (one set per server, `servers` table)

| Switch | Column | Default before | Default now (new servers) | Recommended |
| --- | --- | --- | --- | --- |
| Terminal | `allow_terminal` | false | false | OFF |
| File changes | `allow_file_writes` | false (0008 reset every row to false) | false | OFF |
| Removing leftovers | `allow_orphan_removal` | true | false | OFF |

**Terminal.** Can: a root shell, so any command, including stopping or editing
apps Egg did not deploy, and reading every secret the account can read.
Exposure: anyone signed in to the Egg account while it is on. Works on a
container with other apps: yes, and that is exactly the risk. Turning it on needs
a Hack Club sign-in from the last 5 minutes (`reauth_required`), and the page asks
for the server name. Turning it off closes the owner's open terminals on that
server. Enforcement: the open route and every API v1 terminal call read the stored
value per request. The browser input and resize routes do not (see Gaps).

**File changes.** Can: create, edit, rename, delete and upload inside a project's
`shared/` folder only. `current/` and every release folder stay read only, after
symlinks are resolved on the container. Exposure: a change in `shared/` can change
what the app does on its next restart. Works on a container with other apps: it
never reaches a folder that is not a project of ours. Same fresh sign-in rule as
the terminal. Enforcement: the four write routes and the API v1 write calls read
the stored value per request (tests in `permissions-routes.test.ts`).

**Removing leftovers.** Can: stop, disable and delete `egg-*.service` units, and
`rm -rf` folders directly under `~/.egg` that no project uses. This is the
only switch that deletes. Works on a container with other apps: only safe if
"ours" is a reliable test. The marker check:

- Before this review the only test was the name: `egg-<slug>.service` and any
  folder with a valid slug in `~/.egg`. There was no marker, so a unit or
  folder a person made with a matching name looked like a leftover.
- A marker is now being added by another change set in the same tree (not by this
  one): `# egg:managed` in the unit, `.egg-managed` in the project
  folder, and a rule for folders without the file (only releases, incoming, shared, current, no `.git`).
  `removeOrphans` then refuses anything unmarked (`notOurs`).
- Verdict: removal stays OFF by default whether or not that lands. With it on,
  removal still needs a click to confirm each time, 10 requests a minute at most,
  and it is never available to API tokens.

### Project toggles (`projects` table)

| Toggle | Stored as | Default | What it can destroy or expose | Recommended |
| --- | --- | --- | --- | --- |
| Auto deploy | `auto_deploy` | true | A push to the production branch builds and restarts the app. For a project adopted from a live checkout, the first push could replace the running app. | ON for a project created normally. OFF for an adopted project until the person confirms the first deploy. |
| Notifications | `notify_url_enc` (sealed webhook) | null, off | Sends project name, branch, result and commit text to a Discord or Slack URL. The `alert_on_*` flags default true but do nothing until a webhook exists. | OFF (already) |
| Analytics | `analytics_key` | null, off | A script on the visitor's page reports path and referrer host. No IP, no cookie. | OFF (already) |
| Click tracking and similar extras | `analytics_settings` (new, other change set) | each column default false | Reports what visitors click. Did not exist before this review. | OFF, one separate switch each, and turning analytics on must not turn them on |
| Status page | `status_key` | null, off | A public, unguessable URL showing name, state and recent outages. | OFF (already) |
| Deploy hook | `hook_hash` | null, off | Anyone with the URL can trigger a deploy, which restarts the app. Shown once, stored as a hash. | OFF (already) |

Each toggle is its own column and its own route, so turning one on never turns
another on. `permissions-defaults.test.ts` checks that a new project has all four
null, that the columns have no database default, and that enabling analytics
leaves the status page off and the other way round.

### API token scopes (`api-tokens.ts`)

A token is created with an explicit list of scopes (at least one). Nothing is
pre-ticked in the dialog. The quick picks are "Read only" (every `:read` scope)
and "Deploy" (`projects:read`, `deployments:read`, `deployments:write`,
`logs:read`). Neither contains `terminal:use` or `files:write`.

| Group | Scopes | Note |
| --- | --- | --- |
| Read | `projects:read`, `deployments:read`, `logs:read`, `env:read` (names only), `domains:read`, `notifications:read`, `alerts:read`, `analytics:read`, `activity:read`, `resources:read`, `container:read`, `files:read` | Logs can hold anything the app prints. `files:read` refuses each release's `.env`. |
| Write | `projects:write`, `deployments:write`, `env:write`, `domains:write` | `projects:write` sets build and start commands and `deployments:write` runs them, so the pair is close to code execution without a terminal. Not gated by a switch, on purpose (see open decisions). |
| Container | `files:write`, `terminal:use` | Expire within 7 days, and only work while the owner's matching switch is on. Never granted by a quick pick. |

Never available to a token: the container switches, leftover removal, creating or
editing tokens, sessions and account deletion.

### Account level choices

Profile (read only, comes from Hack Club), GitHub installations (managed on
GitHub), signed-in browsers (revoke one or all others), the container switches
above, and delete account (type your name). Deleting the account removes Nest
Deploy's records and closes terminals. It does not stop, remove or edit anything
on the container.

## 2. Decisions

1. **Leftover removal: OFF for new servers.** It is the only switch that deletes,
   and until a marker is reliable the name was the only test of "ours".
2. **Terminal and file changes: stay OFF.** Confirmed. New rows get false, the
   guards read the stored value, normalising anything unreadable gives false.
3. **Auto deploy on an adopted project: OFF until the first deploy is confirmed.**
   Not built here: it needs the adoption flow (another change set) to create the
   project with `autoDeploy: false`. `createProjectInput` still defaults to true.
4. **Analytics, extras, status page, notifications, deploy hook: OFF, separate.**
   Already true in the schema. Verified by test.
5. **Tokens: no terminal or file scope unless ticked.** Verified by test.
6. **No new switch for "deploy from the API".** Token scopes already cover it.

## 3. Migration plan: existing servers are not changed

Changing a column default only affects rows created afterwards. No statement in
this plan updates a row.

- `schema.ts`: `allowOrphanRemoval` is now `.default(false)`. Drizzle writes the
  default into the insert itself, so a server created through `createServer` gets
  `false` even before the SQL default changes. A test creates a server against the
  current migrations and checks all three switches read false.
- SQL default: SQLite cannot alter a default in place, so `drizzle-kit generate`
  will emit a rebuild of `servers` (create `__new_servers`, `INSERT ... SELECT`,
  drop, rename). The lead runs it. Check the generated file: the `INSERT ... SELECT`
  must copy `allow_orphan_removal` unchanged and there must be no `UPDATE`. The
  foreign key from `projects` must survive (compare migration 0008's test, which
  checks `PRAGMA foreign_key_check`). Add a test like 0008's that inserts a row
  with `allow_orphan_removal = 1` before the migration and expects 1 after.
  Skipping the SQL-level change is also safe, because the ORM supplies the value.
- Existing rows with removal on stay on. A silent flip would change what people
  rely on (a cleanup that worked yesterday stops), and unlike migration 0008 it
  guards a behaviour that only deletes our own leftovers. The protection for those
  people is the marker: with it, removal refuses anything we did not create even
  when the switch is on.
- If the lead wants people to choose, add a one-time notice on Account for servers
  where removal is on ("Removing leftovers is on for this server. Turn it off?")
  that changes nothing until clicked. Not built.

## 4. What happens to running apps

- Turning any switch on or off never restarts, stops or reloads an app. A switch
  only decides whether a later request is allowed. The one visible effect of
  turning the terminal off is that the owner's open terminal windows close.
- Turning a switch on does nothing by itself. Nothing runs until the person uses
  the feature.
- A switch never reaches a unit or folder without our marker. Leftover removal
  refuses anything unmarked, a deploy refuses to overwrite a unit or folder of the
  same name that is not ours, and file changes only ever write inside `shared/` of
  a project we deployed.
- An app Egg did not deploy is never restarted by Egg. The
  terminal is the exception only in that you can type anything into it yourself.
- Deleting your Egg account leaves every app running.

## 5. Gaps and open decisions

- **Gap (not fixed, outside this scope):** the browser terminal input and resize
  routes (`api/projects/[id]/terminal/[sessionId]/input`, `.../resize`) do not call
  `requireProjectFeature`. They rely on the permissions route closing the session.
  API v1 re-checks per call. `permissions-routes.test.ts` has an `it.fails` test
  that shows a 200 where 403 is expected. Fix: one `requireProjectFeature(user.id,
  id, "terminal")` line in each route, then change `it.fails` to `it`.
- Should turning leftover removal on also need the fresh sign-in and the typed
  server name? Not done: removal is limited to our own names and markers.
- Should `deployments:write` plus `projects:write` be gated by a switch? The
  brief says token scopes already cover deploys, so no.
- The marker work and the adoption flow are in the working tree from other
  changes and were not reviewed here beyond reading them.
