# The Egg command line

`egg` lets you use Egg from a terminal or a script without writing HTTP calls. It has no packages to install and sends every request through the typed client in `web/src/lib/sdk/egg.ts`.

## Set it up

Create a personal access token on the Developer page, then set two environment variables:

```sh
export EGG_TOKEN=egg_...                       # never commit this
export EGG_URL=https://deploy.example.com      # your Egg address
```

Run the CLI from the `web/` folder:

```sh
node scripts/egg-cli.mjs whoami
```

On Node 22.18 or newer this works as it is. On Node 20 or an older Node 22, run it through tsx: `npx tsx scripts/egg-cli.mjs whoami`. To get an `egg` command on your path, run `npm link` in `web/` (the `bin` entry in `web/package.json` points at the script).

## Commands

| Command | What it does | Token scopes |
| --- | --- | --- |
| `egg whoami` | Who the token belongs to, its scopes and expiry | none |
| `egg projects list` | List your projects | `projects:read` |
| `egg projects show <slug>` | Show one project | `projects:read` |
| `egg deploy <slug> [--branch <name>]` | Queue a deployment. Without a branch it deploys the production branch to production; any other branch is a preview | `projects:read`, `deployments:write` |
| `egg deployments list <slug>` | List a project's deployments, newest first | `projects:read`, `deployments:read` |
| `egg logs <deployment-id> [--follow]` | Print a deployment's build log. `--follow` keeps polling until the deployment finishes | `deployments:read` |
| `egg rollback <deployment-id>` | Point production back at an earlier deployment. This changes what is live | `deployments:write` |
| `egg env names <slug>` | List environment variable names and targets. Values are never returned | `projects:read`, `env:read` |
| `egg domains list` | List your domains and their status | `domains:read` |
| `egg status` | CPU, memory and disk use of each server | `container:read`, `resources:read` |

A project is named by its slug. Its id works too.

## Output and exit codes

Output is plain text by default. Add `--json` for machine output: the command prints the API answer as JSON, such as `{"projects": [...]}`. Two exceptions: `egg logs --json` prints `{"deploymentId": "...", "lines": [...]}`, and with `--follow` it prints one JSON object per line as they arrive; `egg status --json` prints `{"servers": [...]}` with a `usage` object on each server. With `--json`, an API error is printed to stderr as `{"error": {"status", "code", "message"}}`.

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Failed: the server refused, the network failed, the project was not found, a followed deployment ended in `error` or `canceled`, or a server could not be measured |
| 2 | Wrong use: unknown command or option, a missing argument, or `EGG_TOKEN` or `EGG_URL` not set |

Results go to stdout and errors to stderr, so `egg projects list --json | jq` stays clean.

## The token

The token is read from `EGG_TOKEN` only, sent only as the `Authorization` header and never printed. If a server ever echoes it back, the CLI replaces it with `[hidden]`. Build log text from the server is shown with its terminal control characters removed.

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

The same client is available to your own scripts. It has a method for every endpoint of the public API, including the ones the CLI does not use (creating projects, setting environment variables, domains, the terminal and files). A test in `web/src/lib/sdk/endpoint-coverage.test.ts` fails if an endpoint is added to the API and not to the client.

```ts
import { Egg } from "./egg";

const egg = new Egg({ token: process.env.EGG_TOKEN!, baseUrl: process.env.EGG_URL! });
const { projects } = await egg.listProjects();
```
