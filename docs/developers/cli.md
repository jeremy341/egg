# The Egg command line

`egg` lets you use Egg from a terminal or a script without writing HTTP calls. It has no packages to install. It uses the typed client in `web/src/lib/sdk/egg.ts`, and sends registered operations without a dedicated REST wrapper through Egg's compact API using the same bearer token and scopes.

## Set it up

Create a personal access token on the Developer page, then set two environment variables:

```sh
export EGG_TOKEN=egg_...                       # never commit this
export EGG_URL=https://deploy.example.com      # your Egg address
```

The CLI reads `EGG_TOKEN` and `EGG_URL` only. The snippets on the Developer page and the bundled examples use the older `NEST_TOKEN` and `NEST_URL` names for the same token and address; the CLI will not read those, so export the values under the `EGG_*` names. The two local commands below need no token at all.

Run the CLI from the `web/` folder:

```sh
node scripts/egg-cli.mjs whoami
```

On Node 22.18 or newer this works as it is. On Node 20 or an older Node 22, run it through tsx: `npx tsx scripts/egg-cli.mjs whoami`. To get an `egg` command on your path, run `npm link` in `web/` (the `bin` entry in `web/package.json` points at the script).

From a checkout, `pnpm audit:prod` checks the production dependencies for high-severity advisories. CI runs the same check on Linux and macOS: a finding fails the Linux job, while the macOS job only reports it.

## Commands

### On this computer, no token needed

| Command | What it does |
| --- | --- |
| `egg start [--dev]` | Set up if needed, check this computer, start Egg and open the browser. `--dev` runs the development server instead of a production build. |
| `egg doctor` | Check that this computer can run Egg and print one `Fix:` line per problem. It starts nothing. |

These are the same commands as `pnpm egg start` and `pnpm run doctor` from `web/`; the [self-hosting guide](../selfhost/README.md) describes what they check.

### Against a running Egg, needs `EGG_TOKEN` and `EGG_URL`

| Command | What it does | Token scopes |
| --- | --- | --- |
| `egg whoami` | Show the account, token scopes and expiry | none |
| `egg projects list` | List projects | `projects:read` |
| `egg projects show <project>` | Show a project by slug or id | `projects:read` |
| `egg projects create --name ... --server ... --repo ... --runtime ...` | Create a project; optional flags set slug, branch, port, root folder, commands, output folder, health path, auto-deploy and web/worker type | `projects:write` |
| `egg projects update <project> [settings]` | Change branch, port, root folder, commands, output folder, health path or auto-deploy | `projects:read`, `projects:write` |
| `egg projects source <project> [--repo <owner/name>] [--branch <name>]` | Change the GitHub repository or production branch after checking repository access | `projects:read`, `projects:write` |
| `egg projects delete <project> --confirm <name> [--remove-from-server]` | Permanently delete a project; optionally stop its service and remove releases from the server | `projects:read`, `projects:write` |
| `egg projects restart <project>` | Restart its production service | `projects:read`, `deployments:write` |
| `egg services list [--limit <n>] [--cursor <cursor>]` | List deployable services; pass the returned cursor to fetch another page | `projects:read` |
| `egg services show <service>` | Show service settings by slug or id | `projects:read` |
| `egg services create --name ... --server ... --repo ... --runtime ...` | Create a service | `projects:write` |
| `egg services update <service> [settings]` | Change supported project-backed service settings | `projects:read`, `projects:write` |
| `egg services configure <service> [--ports-file <json-file>] [--domain <name> \| --clear-domain]` | Replace all service ports and/or set or clear its internal DNS name | `projects:read`, `projects:write` |
| `egg services delete <service> --confirm <name> [--remove-from-server]` | Delete a service only when `--confirm` exactly matches its name; `--remove-from-server` also stops it and removes its releases and previews, while keeping shared data | `projects:read`, `projects:write` |
| `egg services logs <service>` | Read production runtime logs | `projects:read`, `logs:read` |
| `egg services restart <service>` | Restart the production process | `projects:read`, `deployments:write` |
| `egg services port <service> <port>` | Change its public port (linked domains return to pending until the Nest mapping is changed) | `projects:read`, `projects:write` |
| `egg services exposure <service> <domain> <action>` | Attach an owner's domain to the service with `attach`, or detach it with `detach` | `projects:read`, `domains:read`, `domains:write` |
| `egg deploy list <project>` | List up to 100 deployments, newest first | `projects:read`, `deployments:read` |
| `egg deploy show <deployment-id>` | Show one deployment | `deployments:read` |
| `egg deploy create <project> [--branch <name>] [--wait]` | Queue a deployment; other branches become previews | `projects:read`, `deployments:write` |
| `egg deploy redeploy <deployment-id> [--wait]` | Build the same commit again | `deployments:write` |
| `egg deploy cancel <deployment-id>` | Cancel a queued or active deployment | `deployments:write` |
| `egg deploy rollout <deployment-id> [--wait]` | Read the rollout state; `--wait` asks the API to hold for up to 60 seconds | `deployments:read` |
| `egg deploy rollback <deployment-id> [--wait]` | Queue a rollback to an earlier production deployment | `deployments:write` |
| `egg deploy logs <deployment-id> [--follow]` | Read or follow build and deploy output | `deployments:read` |
| `egg env list <project>` / `egg env names <project>` | List variable names and targets; values are never returned | `projects:read`, `env:read` |
| `egg env set <project> <key> <value> [--target <target>]` | Add or replace one write-only value | `projects:read`, `env:write` |
| `egg env unset <project> <key> [--target <target>]` | Remove a variable from one target or all targets | `projects:read`, `env:write` |
| `egg env add <project> <json-file> [--target <target>]` | Merge variables from a file; entries not listed stay unchanged | `projects:read`, `env:write` |
| `egg env replace <project> <json-file> --confirm <project-name>` | Replace the whole variable set; omitted values are removed | `projects:read`, `env:write` |
| `egg env delete <project> <json-file> --confirm <project-name> [--target <target>]` | Delete the named variables from one target or all targets | `projects:read`, `env:write` |
| `egg env sets list` | List shared environment sets and show the current default | `env:read` |
| `egg env sets create --name <name>` | Create a shared environment set; the first set becomes the default | `env:write` |
| `egg env sets rename <environment-id> --name <name>` | Rename a shared environment set | `env:write` |
| `egg env sets delete <environment-id> --confirm <name>` | Delete a shared environment set and its variables | `env:write` |
| `egg env sets default <environment-id>` | Choose the set applied to projects on their next deployment | `env:write` |
| `egg env shared list <environment-id>` | List shared variable names and targets; values are never returned | `env:read` |
| `egg env shared add <environment-id> <json-file> [--target <target>]` | Add or replace shared values from a file | `env:write` |
| `egg env shared replace <environment-id> <json-file> --confirm <name>` | Replace every shared value after confirming the environment name | `env:write` |
| `egg env shared delete <environment-id> <json-file> --confirm <name> [--target <target>]` | Delete named shared values from one target or all targets | `env:write` |
| `egg jobs list <project>` / `egg jobs show <project> <job-id>` | List or inspect scheduled jobs | `projects:read`, `jobs:read` |
| `egg jobs create <project> --name ... --schedule ... --command ... [--enabled <true-or-false>]` | Create a one-command job on a five-field UTC cron schedule | `projects:read`, `jobs:write` |
| `egg jobs update <project> <job-id> [--name ...] [--schedule ...] [--command ...] [--enabled <true-or-false>]` | Change a job or pause/resume its timer | `projects:read`, `jobs:write` |
| `egg jobs run <project> <job-id> --confirm <job-name>` | Run the scheduled command now | `projects:read`, `jobs:write` |
| `egg jobs runs <project> <job-id>` | Read its latest status snapshot | `projects:read`, `jobs:read` |
| `egg jobs logs <project> <job-id>` | Read recent output for the job | `projects:read`, `jobs:read` |
| `egg jobs cancel <project> <job-id>` | Pause future runs; it does not stop a command already running | `projects:read`, `jobs:write` |
| `egg jobs delete <project> <job-id> --confirm <job-name>` | Remove the scheduled job and its systemd units | `projects:read`, `jobs:write` |
| `egg ops start <deployment-id>` | Start a stopped production service | `deployments:write` |
| `egg ops stop <deployment-id>` | Stop a production service without deleting its files or data; visitors will see downtime | `deployments:write` |
| `egg ops restart <deployment-id>` | Restart the production service without rebuilding it | `deployments:write` |
| `egg ops scale <deployment-id> [--memory-mb <n>] [--cpu-percent <n>]` | Set memory (128–32768 MB) and/or CPU (1–6400 percent of one core) limits | `deployments:write` |
| `egg ops volumes <deployment-id>` | List Docker volumes owned by a Compose deployment | `deployments:read` |
| `egg domains list` | List domains and status | `domains:read` |
| `egg domains add <domain> --server <id> --port <port> [--project <slug>]` | Add a domain, optionally attached to a project | `domains:write`; `projects:read` when using `--project` |
| `egg domains remove <domain>` / `egg domains validate <domain>` | Remove a domain mapping or check DNS and certificate status | `domains:read`, `domains:write` |
| `egg notify channels list <project>` / `egg notify channels test <project>` | Read notification settings or send a test message | `projects:read`, `notifications:read` |
| `egg status` | Measure CPU, memory and disk use on each server | `container:read`, `resources:read` |

Project and service commands accept a slug or id. Commands that resolve a project slug first need `projects:read` in addition to their write scope. The older shortcuts remain available: `egg deploy <project>`, `egg deployments list <project>`, `egg logs <deployment-id>`, and `egg rollback <deployment-id>`.

The API exposes services as project-backed deployables. Scheduled jobs run one command on the service's server; Egg keeps a latest status and recent output, not historical run records. Canceling a job pauses its timer and does not stop a command already in progress.

SSH key management is not available to bearer tokens: the key routes require a signed-in browser session. Manage personal and project SSH keys in Egg's web interface.

Bulk environment commands read JSON from a local file so secret values do not have to appear in shell arguments. `env add` and `env replace` accept an array of entries or an object with an `envVars` array:

```json
[
  { "key": "API_URL", "value": "https://api.example.com", "target": "production" },
  { "key": "FEATURE_FLAG", "value": "on" }
]
```

Omitted entry targets use `all`, or the value from `--target`. `env delete` accepts a JSON array of names or an object with a `keys` array. `env replace` and `env delete` require the exact project name because they remove stored variables. Egg never returns environment values, so a replacement file must contain every value you want to keep.

`env shared add` and `env shared replace` accept the same `envVars` JSON file format. `env shared delete` accepts a JSON array of names or an object with a `keys` array. Shared values are encrypted and write-only; project variables take precedence over shared values at deployment.

## Output and exit codes

Output is plain text by default. Add `--json` for machine output: the command prints the API answer as JSON, such as `{"projects": [...]}`. Two exceptions: `egg logs --json` prints `{"deploymentId": "...", "lines": [...]}`, and with `--follow` it prints one JSON object per line as they arrive; `egg status --json` prints `{"servers": [...]}` with a `usage` object on each server. With `--json`, an API error is printed to stderr as `{"error": {"status", "code", "message"}}`.

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Failed: the server refused, the network failed, the project was not found, a followed deployment ended in `error` or `canceled`, or a server could not be measured |
| 2 | Wrong use: unknown command or option, a missing argument, or `EGG_TOKEN` or `EGG_URL` not set for a remote command |

Results go to stdout and errors to stderr, so `egg projects list --json | jq` stays clean.

## The token

For remote commands the token is read from `EGG_TOKEN` only (not `NEST_TOKEN`), sent only as the `Authorization` header and never printed. If a server ever echoes it back, the CLI replaces it with `[hidden]`. Build log text from the server is shown with its terminal control characters removed.

## Examples

```sh
# Who am I, and what can this token do?
egg whoami

# Deploy a branch and wait for the build
id=$(egg deploy my-app --branch feature/login --json | jq -r .deployment.id)
egg logs "$id" --follow            # exits 1 if the build fails

# Roll production back to the last good deployment
egg deployments list my-app
egg rollback dep_123

# Which servers are getting full?
egg status --json | jq '.servers[] | {host, disk: .usage.diskUsedMb}'
```

## From code

The same client is available to your own scripts. The API client has a method for every registered endpoint; `web/src/lib/sdk/endpoint-coverage.test.ts` checks that coverage. The CLI does not expose every endpoint, including analytics, terminal and file operations.

```ts
import { Egg } from "./egg";

const egg = new Egg({ token: process.env.EGG_TOKEN!, baseUrl: process.env.EGG_URL! });
// The Developer page names these NEST_TOKEN/NEST_URL; pass whichever your script uses.
const { projects } = await egg.listProjects();
```
