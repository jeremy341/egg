# The Egg command line

`egg` lets you use Egg from a terminal or a script without writing HTTP calls. It has no packages to install. It uses the typed client in `web/src/lib/sdk/egg.ts`, and sends registered operations without a dedicated REST wrapper through Egg's compact API using the same bearer token and scopes.

## Set it up

Create a personal access token on the Developer page, then set two environment variables:

```sh
export EGG_TOKEN=egg_...                       # never commit this
export EGG_URL=https://deploy.example.com      # your Egg address
```

The CLI reads `EGG_TOKEN` and `EGG_URL`, or the global `--token` and `--url` options for an individual invocation. It does not read `NEST_TOKEN` or `NEST_URL`, even though some Developer-page and bundled examples still use those names; set the values under the `EGG_*` names for the CLI. Local start/doctor, context, and information commands need no token.

Run the CLI from the `web/` folder:

```sh
node scripts/egg-cli.mjs whoami
```

On Node 22.18 or newer this works as it is. On Node 20 or an older Node 22, run it through tsx: `npx tsx scripts/egg-cli.mjs whoami`. To get an `egg` command on your path, run `npm link` in `web/` (the `bin` entry in `web/package.json` points at the script).

From a checkout, `pnpm audit:prod` checks the production dependencies for high-severity advisories. CI runs the same check on Linux and macOS: a finding fails the Linux job, while the macOS job only reports it.

## Commands

### On this computer

`egg start [--dev]` sets up and starts Egg locally; `--dev` runs the development server. `egg doctor` checks this computer and starts nothing. Both need no token.

### Command reference

Egg has **153 commands**. The tables list every registered command once, including aliases and offline information commands. Arguments and supported option names come from the command registry. `--token <token>`, `--url <url>`, `--json`, `--show-secrets`, and `--help` (`-h`) are global. Without `--json`, output is plain text in a terminal and JSON when piped.

Most project and service commands accept a slug or id. `egg use <project|org> [--org <org>] [--env <environment>]` saves local context; `egg context show` and `egg context clear` inspect or remove it. Context is stored at `EGG_CONTEXT_FILE` when set, otherwise `~/.egg/context.json`. Offline commands never store or print a token. The offline information commands are `version`, `commands`, `exit-codes`, `licenses`, and `root`.

#### Projects

| Command | Arguments | Options | What it does |
| --- | --- | --- | --- |
| `egg projects list` | — | — | List your projects. |
| `egg projects show` | `<project>` | — | Show a project by slug or id. |
| `egg projects create` | — | `--name`, `--server`, `--repo`, `--runtime`, `--slug`, `--branch`, `--port`, `--root-dir`, `--install-command`, `--build-command`, `--start-command`, `--output-dir`, `--health-path`, `--auto-deploy`, `--workload-kind` | Create a project from a public GitHub repository. |
| `egg projects update` | `<project>` | `--branch`, `--port`, `--root-dir`, `--install-command`, `--build-command`, `--start-command`, `--output-dir`, `--health-path`, `--auto-deploy` | Update supported project settings. |
| `egg projects source` | `<project>` | `--repo`, `--branch` | Change a project's GitHub repository or production branch. |
| `egg projects delete` | `<project>` | `--confirm`, `--remove-from-server` | Delete a project after confirming its exact name. |
| `egg projects restart` | `<project>` | — | Restart a project's production service. |
| `egg projects purge` | `<project>` | `--confirm` | Delete a project and its server resources after confirming its exact name. |

#### Deployments

| Command | Arguments | Options | What it does |
| --- | --- | --- | --- |
| `egg deploy list` | `<project>` | — | List a project's deployments. |
| `egg deploy show` | `<deployment-id>` | — | Show one deployment. |
| `egg deploy create` | `<project>` | `--branch`, `--wait`, `--timeout` | Deploy a project's configured GitHub repository. |
| `egg deploy redeploy` | `<deployment-id>` | `--wait`, `--timeout` | Build the same commit again. |
| `egg deploy cancel` | `<deployment-id>` | — | Cancel a deployment that is still running. |
| `egg deploy rollout` | `<deployment-id>` | `--wait` | Read the deployment's current rollout state. |
| `egg deploy rollback` | `<deployment-id>` | `--wait`, `--timeout` | Point production back at an earlier deployment. |
| `egg deploy logs` | `<deployment-id>` | `--follow` | Read a deployment's build log. |
| `egg deploy` | `<project>` | `--branch`, `--wait`, `--timeout` | Alias for deploy create. |
| `egg deployments list` | `<project>` | — | Alias for deploy list. |
| `egg logs` | `<deployment-id>` | `--follow` | Alias for deploy logs. |
| `egg rollback` | `<deployment-id>` | `--wait`, `--timeout` | Alias for deploy rollback. |
| `egg ops start` | `<deployment-id>` | — | Start a stopped production service. |
| `egg ops stop` | `<deployment-id>` | — | Stop a production service without deleting its data. |
| `egg ops restart` | `<deployment-id>` | — | Restart a production service without rebuilding it. |
| `egg ops scale` | `<deployment-id>` | `--memory-mb`, `--cpu-percent` | Change the current production service's CPU or memory limit. |
| `egg ops volumes` | `<deployment-id>` | — | List the Docker volumes owned by a Compose deployment. |
| `egg deploy delete` | `<deployment-id>` | `--confirm-name` | Delete a deployment after confirming its exact project slug. |
| `egg deploy pods` | `<deployment-id>` | `--live` | List the current project containers for a deployment. |
| `egg deploy metrics` | `<deployment-id>` | — | Show CPU, memory, and restart measurements for a deployment. |
| `egg deploy releases` | `<deployment-id>` | `--limit` | List recent releases for a deployment's project. |
| `egg deploy rollback-to` | `<id>` | `--confirm-deployment-id`, `--wait`, `--timeout` | Point production at a deployment after confirming its exact id. |
| `egg deploy image set` | `<id>` `<image>` | `--wait`, `--timeout` | Set the image used by an image-based deployment. |
| `egg deploy history` | `<id>` | — | Show a deployment's image history. |
| `egg deploy auto-deploy status` | `<id>` | — | Show a project's automatic deploy settings. |
| `egg deploy auto-deploy disable` | `<id>` | — | Disable automatic deploys for a project. |
| `egg deploy env get` | `<id>` | — | Show deployment environment variable names and readable values. |
| `egg deploy env set` | `<id>` `<assignment>` | `--file`, `--secret` | Set one deployment environment variable, optionally loading more from a dotenv file. |
| `egg deploy env unset` | `<id>` `<key>` | `--confirm-key` | Remove one deployment environment variable after confirming its exact key. |
| `egg deploy resources set` | `<id>` | `--cpu`, `--memory` | Update the supplied deployment CPU or memory request. |
| `egg deploy volumes get` | `<id>` | — | Show attached volume mount configuration. |
| `egg deploy volumes set` | `<id>` | `--volume`, `--confirm-deployment` | Replace the deployment volume list after confirming its exact project name. |
| `egg deploy strategy set` | `<id>` | `--type` | Choose rolling, recreate, or blue-green deployment updates. |
| `egg deploy pull-policy set` | `<id>` | `--policy` | Set when deployment images are pulled for pod starts. |
| `egg deploy health-check set` | `<id>` | `--path` | Set the supported deployment health-check path. |
| `egg deploy build-root set` | `<id>` `<mode>` | `--depot`, `--persistent-cache` | Set the deployment build-root mode and optional accelerators. |
| `egg deploy build-config set` | `<id>` | `--start-cmd`, `--root`, `--install-cmd`, `--build-cmd`, `--output-dir` | Update supported deployment build and start settings. |
| `egg compose list` | — | — | List Compose stacks in the selected project. |
| `egg compose show` | `<stack-id>` | — | Show a Compose stack and its managed deployments. |
| `egg compose redeploy` | `<stack-id>` | — | Redeploy a Compose stack from its current source. |
| `egg compose delete` | `<stack-id>` | `--confirm` | Delete a Compose stack and its managed deployments after confirming its exact name. |

#### Environment

| Command | Arguments | Options | What it does |
| --- | --- | --- | --- |
| `egg env list` | `<project>` | — | List variable names and targets; values are write-only. |
| `egg env names` | `<project>` | — | Alias for env list. |
| `egg env set` | `<project>` `<key>` `<value>` | `--target` | Create or replace one environment variable. |
| `egg env unset` | `<project>` `<key>` | `--target` | Remove an environment variable. |
| `egg env add` | `<project>` `<json-file>` | `--target` | Merge variables from a JSON file; omitted names are left alone. |
| `egg env replace` | `<project>` `<json-file>` | `--confirm` | Replace every variable from a JSON file after confirming the project name. |
| `egg env delete` | `<project>` `<json-file>` | `--confirm`, `--target` | Delete named variables from a JSON file after confirming the project name. |
| `egg env sets list` | — | — | List your shared environment sets. |
| `egg env sets create` | — | `--name` | Create a shared environment set. |
| `egg env sets rename` | `<environment-id>` | `--name` | Rename a shared environment set. |
| `egg env sets delete` | `<environment-id>` | `--confirm` | Delete a shared environment set after confirming its name. |
| `egg env sets default` | `<environment-id>` | — | Choose the shared environment applied by default. |
| `egg env shared list` | `<environment-id>` | — | List shared variable names and targets; values are write-only. |
| `egg env shared add` | `<environment-id>` `<json-file>` | `--target` | Add or replace shared variables from a JSON file. |
| `egg env shared replace` | `<environment-id>` `<json-file>` | `--confirm` | Replace all shared variables after confirming the environment name. |
| `egg env shared delete` | `<environment-id>` `<json-file>` | `--confirm`, `--target` | Delete named shared variables after confirming the environment name. |
| `egg env get` | `<name-or-id>` | — | Show one shared environment set by name or id. |
| `egg env get-default` | — | — | Show the default shared environment set. |
| `egg env create` | — | `--name`, `--slug` | Create an account-wide shared environment set. |
| `egg env sets remove` | `<name-or-id>` | `--confirm` | Delete a shared environment set after confirming its exact name. |
| `egg env set-default` | `<name-or-id>` | — | Set the default shared environment by name or id. |
| `egg env vars get` | `<environment-name-or-id>` | `--show-values` | List shared variable names and targets; Egg never returns their values. |
| `egg env vars set` | `<environment-name-or-id>` `<KEY=VALUE>` | `--file`, `--secret` | Merge one inline assignment and optional dotenv entries into a shared environment. |
| `egg env vars unset` | `<environment-name-or-id>` `<KEY>` | `--confirm` | Remove one shared variable after confirming its environment name. |

#### Jobs

| Command | Arguments | Options | What it does |
| --- | --- | --- | --- |
| `egg jobs list` | `<project>` | — | List the project's scheduled jobs. |
| `egg jobs show` | `<project>` `<job-id>` | — | Show one scheduled job. |
| `egg jobs create` | `<project>` | `--name`, `--schedule`, `--command`, `--enabled` | Create a one-command scheduled job using a five-field UTC cron schedule. |
| `egg jobs update` | `<project>` `<job-id>` | `--name`, `--schedule`, `--command`, `--enabled` | Change a job or pause or resume its timer. |
| `egg jobs run` | `<project>` `<job-id>` | `--confirm` | Run a scheduled command now after confirming its exact name. |
| `egg jobs runs` | `<project>` `<job-id>` | — | Read the job's latest status snapshot. |
| `egg jobs logs` | `<project>` `<job-id>` | — | Read recent scheduled-job output. |
| `egg jobs cancel` | `<project>` `<job-id>` | — | Pause future runs of a scheduled job. |
| `egg jobs delete` | `<project>` `<job-id>` | `--confirm` | Delete a scheduled job after confirming its exact name. |
| `egg job list` | `<project>` | — | List scheduled jobs in one project. |
| `egg job get` | `<project>` `<job-id>` | — | Show one scheduled job. |
| `egg job create` | `<project>` | `--name`, `--cron`, `--description`, `--timezone`, `--concurrency`, `--paused`, `--steps` | Create a scheduled job from one command step. |
| `egg job update` | `<project>` `<job-id>` | `--name`, `--cron`, `--description`, `--concurrency`, `--paused` | Change supported scheduled-job settings. |
| `egg job delete` | `<project>` `<job-id>` | `--confirm` | Delete a scheduled job after confirming its exact name. |
| `egg job steps set` | `<project>` `<job-id>` | `--file` | Replace a job's step definition from a JSON file. |
| `egg job run` | `<project>` `<job-id>` | `--allow-concurrent`, `--wait`, `--timeout`, `--confirm` | Start a scheduled job after confirming its exact name. |
| `egg job runs` | `<project>` `<job-id>` | `--limit`, `--cursor`, `--all` | Show the run status snapshot available for a job. |
| `egg job run get` | `<project>` `<job-id>` `<run-id>` | `--watch` | Show one run's status. |
| `egg job run cancel` | `<project>` `<job-id>` `<run-id>` | `--confirm` | Stop an active run after confirming its job name. |
| `egg job run logs` | `<project>` `<job-id>` `<run-id>` | `--step`, `--follow` | Read the logs for one job run. |

#### Services

| Command | Arguments | Options | What it does |
| --- | --- | --- | --- |
| `egg services list` | — | `--limit`, `--cursor` | List deployable services. |
| `egg services show` | `<service>` | — | Show one service by slug or id. |
| `egg services create` | — | `--name`, `--server`, `--repo`, `--runtime`, `--slug`, `--branch`, `--port`, `--root-dir`, `--install-command`, `--build-command`, `--start-command`, `--output-dir`, `--health-path`, `--auto-deploy`, `--workload-kind` | Create a service through the project API. |
| `egg services update` | `<service>` | `--branch`, `--port`, `--root-dir`, `--install-command`, `--build-command`, `--start-command`, `--output-dir`, `--health-path`, `--auto-deploy` | Update supported service settings. |
| `egg services configure` | `<service>` | `--ports-file`, `--domain`, `--clear-domain` | Replace the service's complete port list or change its internal DNS name. |
| `egg services delete` | `<service>` | `--confirm`, `--remove-from-server` | Delete a service after confirming its exact name. |
| `egg services logs` | `<service>` | — | Read a service's production runtime logs. |
| `egg services restart` | `<service>` | — | Restart a service's production process. |
| `egg services port` | `<service>` `<port>` | — | Change the public port for a service. |
| `egg services exposure` | `<service>` `<domain>` `<attach-or-detach>` | — | Attach or detach an owner's domain from a service. |

#### Domains

| Command | Arguments | Options | What it does |
| --- | --- | --- | --- |
| `egg domains list` | — | — | List your domains. |
| `egg domains add` | `<domain>` | `--server`, `--port`, `--project` | Add a domain to a server, optionally attached to a project. |
| `egg domains remove` | `<domain>` | — | Remove a domain by name or id. |
| `egg domains validate` | `<domain>` | — | Check DNS and certificate status for a domain. |
| `egg domains get` | `<domain-id>` | — | Show one domain record by id. |
| `egg domains update` | `<domain-id>` | `--service-port` | Change a domain's destination port. |
| `egg domains delete` | `<domain-id>` | `--confirm` | Remove a domain after confirming its exact name. |
| `egg domains protection get` | `<domain-id>` | — | Read a domain's protection settings. |
| `egg domains protection set` | `<domain-id>` | `--mode`, `--password` | Set a domain's protection mode and optional password. |

#### Alerts and notifications

| Command | Arguments | Options | What it does |
| --- | --- | --- | --- |
| `egg notify channels list` | `<project>` | — | Show the project's configured notification channel. |
| `egg notify channels test` | `<project>` | — | Send a test notification to the project channel. |
| `egg status-page show` | `<project>` | — | Show whether a project's status page is published and its URL. |
| `egg notify channels create` | — | `--webhook-url`, `--events`, `--project` | Create a signed webhook channel for selected deployment events. |
| `egg notify channels update` | `<channel-id>` | `--webhook-url`, `--events`, `--enabled`, `--disabled` | Update a webhook channel's receiver, event filter, or active state. |
| `egg notify channels delete` | `<channel-id>` | `--confirm` | Delete a notification channel after confirming its exact host. |
| `egg notify deliveries` | `<channel-id>` | `--limit` | List recent delivery attempts for a notification channel. |

#### Observability

| Command | Arguments | Options | What it does |
| --- | --- | --- | --- |
| `egg status` | — | — | Show CPU, memory and disk use of your servers. |
| `egg pod list` | — | `--namespace` | List project-scoped containers; Egg does not support Kubernetes namespace selection. |
| `egg pod get` | `<name>` | `--namespace` | Show safe details for a uniquely named project container. |
| `egg top` | `<id>` | `--db`, `--once` | Show a one-shot project health snapshot with --once; live and database monitoring are unavailable. |
| `egg observe logs` | `<deployment-id>` | `--level`, `--search`, `--tail`, `--follow` | Read and filter recent runtime log lines for a deployment. |
| `egg observe http` | `<deployment-id>` | — | Read the HTTP metrics Egg exposes for a deployment. |
| `egg observe errors` | `<deployment-id>` | `--window` | Read the anomaly summary for a deployment's project. |
| `egg observe activity` | `<deployment-id>` | `--kinds`, `--limit`, `--cursor`, `--all` | Read activity entries that mention a deployment. |
| `egg events tail` | — | `--types`, `--since-id` | Poll project change feeds for new organization events. |
| `egg audit list` | — | `--deployment`, `--action`, `--limit`, `--cursor`, `--all` | List organization audit entries with optional filters and paging. |

#### GitHub

| Command | Arguments | Options | What it does |
| --- | --- | --- | --- |
| `egg github status` | — | — | Report whether GitHub is connected and which app installations are available. |
| `egg github installations` | — | — | List GitHub App installations visible to the linked account. |
| `egg github repos` | — | — | List repositories available as deployment sources. |
| `egg github contents` | `<owner/repo>` `<path>` | `--branch` | List files and directories at a repository path. |
| `egg github dockerfile-info` | `<owner/repo>` `<dockerfile-path>` | `--branch` | Summarize build metadata from a repository Dockerfile. |
| `egg github branches` | `<owner/repo>` | `--installation`, `--limit` | List the branches of a GitHub repository. |
| `egg github dockerfiles` | `<owner/repo>` | `--installation`, `--ref` | Find Dockerfiles in a GitHub repository. |

#### Organizations

| Command | Arguments | Options | What it does |
| --- | --- | --- | --- |
| `egg orgs list` | — | — | List the organizations available to the signed-in user. |
| `egg orgs get` | — | `--org` | Show an organization selected with --org or the current organization scope. |
| `egg orgs registry list` | — | `--org` | List an organization's private registry logins without revealing passwords. |
| `egg orgs registry set` | `<registry>` | `--org`, `--username`, `--password`, `--password-stdin` | Add or replace an organization's private registry login. |
| `egg orgs registry remove` | `<id>` | `--org`, `--confirm` | Remove a registry login after confirming its exact registry host. |

#### Context and direct API

| Command | Arguments | Options | What it does |
| --- | --- | --- | --- |
| `egg use` | `<project\|org>` | `--org`, `--env` | Save a local default project, with optional organization and environment. |
| `egg context show` | — | — | Show the saved local default scope. |
| `egg context clear` | — | — | Clear the saved local default scope. |
| `egg api` | `<method>` `<path>` | `--body`, `--query`, `--confirm` | Call an Egg API path directly. |

#### Local and information

| Command | Arguments | Options | What it does |
| --- | --- | --- | --- |
| `egg whoami` | — | — | Show the account and token scopes. |
| `egg start` | — | `--dev` | Set up and start Egg on this computer. |
| `egg doctor` | — | — | Check whether this computer can run Egg. |
| `egg version` | — | — | Print the CLI version. |
| `egg commands` | — | — | List every CLI command. |
| `egg exit-codes` | — | — | List documented process exit codes. |
| `egg licenses` | — | — | Print the CLI package license. |
| `egg root` | — | — | Show the bare CLI usage text. |

### Destructive commands

Destructive commands require the exact resource name through `--confirm` or a command-specific exact-name/id option. A mismatch is wrong use and exits 2; the operation does not proceed. This applies to project, service, job, environment-set, domain, channel, and Compose deletion; project purge; deployment deletion and rollback-to; environment replace/delete; shared environment replace/delete; and other changes that remove deployment configuration. `egg api` requires `--confirm` to equal the final path segment for POST, PATCH, PUT, and DELETE. Check the command's options for the exact confirmation flag. `--remove-from-server` on project/service deletion also removes server resources/releases.

### Not built in the CLI

The checklist has **120 entries marked missing**. They include CLI commands not implemented and Egg API operations that do not yet have a CLI command. The list names every missing checklist entry; consult the corresponding parity JSON for its specific reason.

**alerts-notify.json:** `alert list`, `alert metrics`, `alert status`, `alert create`, `alert update`, `alert delete`, `webhook deploy`.

**bindings-env.json:** `env pull`.

**deploy-config.json:** `deploy resources get`.

**deploy-releases.json:** `deploy killed logs`, `deploy auto-deploy enable`, `deploy github-deployments`.

**domains-status.json:** `status-page list`, `status-page options`, `status-page create`, `status-page update`, `status-page delete`.

**egg-only-gaps.json:** `egg endpoint find`, `egg endpoint diagnose_deployment`, `egg endpoint get_deployment_next_steps`, `egg endpoint get_alerts`, `egg endpoint get_status_page`, `egg endpoint get_analytics`, `egg endpoint get_resource_history`, `egg endpoint get_project_resources`, `egg endpoint get_container_inventory`, `egg endpoint get_activity`, `egg endpoint list_files`, `egg endpoint read_file`, `egg endpoint download_file`, `egg endpoint write_file`, `egg endpoint make_folder`, `egg endpoint rename_file`, `egg endpoint delete_file`, `egg endpoint get_audit_log`, `egg endpoint get_changes`, `egg endpoint get_job_run`, `egg endpoint replace_job_steps`, `egg endpoint search_logs`, `egg endpoint get_log_context`, `egg endpoint get_build_logs`, `egg endpoint get_build_history`, `egg endpoint get_killed_container_logs`, `egg endpoint list_deployment_errors`, `egg endpoint triage_deployment_error`, `egg endpoint list_crash_reports`, `egg endpoint get_crash_report`, `egg endpoint list_github_repos`, `egg endpoint get_repo_branches`, `egg endpoint get_repo_contents`, `egg endpoint get_repo_dockerfiles`, `egg endpoint detect_repo_config`, `egg endpoint get_github_status`, `egg endpoint list_github_deploy_targets`, `egg endpoint list_notification_channels`, `egg endpoint get_notification_channel`, `egg endpoint update_notification_channel`, `egg endpoint delete_notification_channel`, `egg endpoint list_notification_rules`, `egg endpoint create_notification_rule`, `egg endpoint update_notification_rule`, `egg endpoint delete_notification_rule`, `egg endpoint list_notification_deliveries`, `egg endpoint replay_notification_channel`, `egg endpoint test_notification_channel`, `egg endpoint get_env_vars`, `egg endpoint set_env_var_secret`, `egg endpoint get_auto_deploy_status`, `egg endpoint enable_auto_deploy`, `egg endpoint disable_auto_deploy`, `egg endpoint get_ingress`, `egg endpoint update_ingress`, `egg endpoint create_deployment`, `egg endpoint delete_deployment`, `egg endpoint rename_deployment`, `egg endpoint retry_deployment_apply`, `egg endpoint update_deployment_build_config`, `egg endpoint update_deployment_health_check`, `egg endpoint update_deployment_image`, `egg endpoint update_deployment_pull_policy`, `egg endpoint update_deployment_strategy`, `egg endpoint update_deployment_resources`, `egg endpoint update_deployment_volumes`, `egg endpoint get_deployment_metrics`, `egg endpoint list_compose_stacks`, `egg endpoint get_compose_stack`, `egg endpoint list_compose_releases`, `egg endpoint redeploy_compose_stack`, `egg endpoint get_deploy_verdict`, `egg endpoint get_deployment_http_metrics`, `egg endpoint get_request_stats`, `egg endpoint get_anomalies`, `egg endpoint get_resource_recommendation`, `egg endpoint get_attack_signals`, `egg endpoint get_image_history`, `egg endpoint list_build_runs`, `egg endpoint get_observability_link`, `egg endpoint list_organizations`, `egg endpoint get_organization`, `egg endpoint list_releases`, `egg endpoint analyze_deployment_resources`, `egg endpoint get_deployment_volumes`, `egg endpoint deploy_from_github_url`, `egg endpoint get_resource_quota`, `egg endpoint list_project_containers`, `egg endpoint get_project_container`, `egg endpoint get_project_health`.

**github-git.json:** `link`, `unlink`.

**observe-events.json:** `observe overview`, `observe runtime`, `observe capabilities`.

**pods-console.json:** `up`.

**project-registry.json:** `quota show`, `quota me`, `quota members`, `quota projects`.

**services-compose.json:** `compose deploy`.

**use-claude-api.json:** `api search`, `api describe`.

### Partial support

The checklist also records limits for commands that do exist. The most important gaps are: alert metric rules, status-page management, webhook deploy, environment pull, observe overview/runtime/capabilities, project build upload (`up`), quota-by-member commands, Compose stack creation, GitHub deployment statuses, enabling auto-deploy with branch/path filters, killed-container entry logs, directory `link`/`unlink`, and `api search`/`api describe` are unavailable. Auto-deploy settings on project create/update do not set branch or path filters.

Other limits include write-only environment values; project-scoped deployment environment commands; live service limits rather than per-pod requests; volume edits must be made in Compose; only health-check paths and a subset of build settings are supported; jobs run one scheduled command and expose limited run history; domain management does not cover all host/path/TLS routing; GitHub repository listing and contents have argument/pagination limits; observe returns limited Egg metrics/activity rather than a complete runtime stream or request-rate/error-rate/latency view; project create/update only handles deployable source and settings; organization registry credentials support long-form options, and organization lookup has parser limits. Container listing and `top` are project-scoped, not a Kubernetes console.

Full partial-entry reasons from the parity checklist:

**alerts-notify.json:** `notify channel create`: Egg can create signed HTTPS webhook channels with events and one project scope, but cannot select Discord, Slack, or email delivery, store a display name, or configure email recipients. The CLI's global --url option is reserved for the Egg server, so the command uses --webhook-url for its destination. `notify channel update`: Egg's update endpoint only changes the webhook URL, event filter, and active state; it cannot change a display name, email recipients, or project scope. The shared CLI uses --webhook-url for the destination because --url is global, and requires --enabled true|false because --enabled is already value-typed for another command.

**bindings-env.json:** `env list`: Egg lists account-wide shared sets with id, name, and default status; it has no project namespaces or deployment counts. `env get`: The command can show an account-wide shared set, but the SDK exposes only id, name, and default status; namespace, resource counts, and creation time are unavailable. Use env get-default when no name is supplied. `env create`: Egg creates account-wide shared sets, not project namespaces, and its endpoint does not accept a slug; --slug is rejected. `env delete`: The command deletes an account-wide shared set after exact-name confirmation; Egg has no project namespace or contained project resources to remove. `env set-default`: Egg chooses one account-wide shared set, while the spec requires a default namespace within a project. `env vars get`: The command lists names and targets, but Egg's endpoint never returns values; --show-values is rejected. `env vars set`: Inline and dotenv input are supported, but Egg's endpoint has no secret marker and the shared parser accepts only one inline assignment per invocation. `env vars unset`: The command removes one shared key per invocation; the shared CLI parser cannot accept the spec's variable-length key list.

**deploy-config.json:** `deploy env get`: The SDK endpoint is project-scoped and accepts a project id, while the spec requires a deployment id. `deploy env set`: The SDK writes one project variable per call; the CLI parser cannot accept zero or multiple positional assignments, and the endpoint applies changes on the next deploy rather than restarting immediately. `deploy env unset`: The SDK removes one project variable per call and the CLI parser retains only the last repeated --confirm-key, so multi-key confirmation cannot be represented safely. `deploy resources set`: Egg's resource endpoint changes live service CPU and memory limits, while this spec requires per-pod requests. `deploy volumes set`: The endpoint rejects volume edits because mounts must be changed in the Compose file; the CLI parser also retains only the last repeated --volume flag, so only one mount can be submitted. `deploy health-check set`: Egg supports only the health path; the endpoint and CLI lack probe type, enablement, timing, and liveness, readiness, and startup controls. `deploy build-root set`: The SDK can set an application subdirectory but cannot switch the Docker build context to the repository root or configure these build accelerators. `deploy build-config set`: Egg supports root, install, build, start, and output settings, but lacks build type, Dockerfile path and target, and builder selection; the CLI parser also rejects empty values needed to clear settings.

**deploy-core.json:** `deploy delete`: Egg exposes the deployment's project slug but not a separate deployment name, so exact-name confirmation is limited to the project slug.

**deploy-releases.json:** `deploy rollback`: The confirmed rollback command can target a deployment and wait for rollout, but Egg has no API support for selecting an image-history entry or restoring bound databases. `deploy history`: Egg can list image history, but no SDK method reads build logs for a selected history entry.

**domains-status.json:** `domain list`: Egg lists owned domain records and their status, but it does not list host and path routes or filter routes by deployment. `domain get`: Egg's endpoint returns domain details but does not include the configured host and path route fields. `domain create`: Egg can register a hostname with a server and port, but it cannot create a configured host and path route with TLS settings. `domain update`: Egg's endpoint can change domain ownership or port, but cannot edit route hosts, paths, TLS, or redirects. `domain delete`: Egg removes its domain record but leaves Nest's host and path route in place; the CLI requires confirmation with the exact domain name. `domain validate-dns`: Egg checks DNS and certificate readiness for a registered domain, while this command validates the supplied host against the cluster. `status-page show`: Egg's endpoint reports publication and URL for a project page, requiring a project slug or id; it cannot resolve a public page by slug or host or return its condition and components.

**github-git.json:** `github repos`: Egg's listGithubRepos method has no pagination input for the --all behavior. `github contents`: The CLI parser requires every positional argument, so it cannot make the second path positional optional.

**jobs.json:** `job list`: Egg lists jobs for a named project, while Orchard can also list jobs across the organization. `job get`: Egg can show its scheduled command but cannot return Orchard's ordered multi-step definition. `job create`: Egg creates one scheduled command and requires a cron schedule; it cannot create a multi-step pipeline, manual-only job, or set all requested fields. `job update`: Egg does not expose the schedule timezone or concurrency policy, stores one command per job, and cannot resume through the paused flag. `job delete`: Egg deletes the scheduled job and its units, but it does not keep Orchard-style run records to remove. `job steps set`: Egg's step-replacement endpoint accepts only one command step, while Orchard supports an ordered multi-step list. `job run`: Egg starts a single command but does not provide pipeline concurrency controls or wait-for-completion behavior. `job runs`: Egg exposes only the latest status snapshot and has no run history to page through. `job-run get`: Egg can retrieve one run, but cannot watch active runs or return Orchard's ordered per-step results. `job-run logs`: Egg returns output scoped to a run but does not support per-step selection or following live output.

**meta.json:** `doctor`: local doctor checks this machine; server isolation and cluster self-test are not exposed

**observe-events.json:** `observe logs`: Egg's getDeploymentLogs method provides structured deployment build output, not the requested runtime log stream. `observe http`: Egg's HTTP metrics endpoint reports pageview counts rather than request rate, error rate, or latency. `observe errors`: Egg's anomaly endpoint is project-scoped and has no server-side window filter; it does not return grouped deployment errors or recent trends. `observe activity`: Egg's activity feed is account-wide and typed items do not identify their deployment reliably; the CLI keeps only rows whose visible fields mention the requested deployment id. `events tail`: Egg only exposes paged project change feeds; the CLI aggregates and polls them, so --since-id is a project cursor and delivery lacks organization-wide event ids.

**orgs.json:** `org get`: The Egg CLI parser cannot accept an optional positional slug-or-id alongside --org; use --org or the single-organization current scope. `org registry set`: The Egg CLI parser rejects the spec's -u and -p short aliases; the --username, --password, and --password-stdin forms are supported.

**pods-console.json:** `pod list`: Egg can list project-scoped containers but cannot list cluster-wide Kubernetes pods or honor --namespace. `pod get`: Egg can resolve a unique project container name and show safe details, but it has no pod address, node, or per-container restart details. `top`: Egg can show one project health snapshot, but it cannot provide continuous pod resource or traffic monitoring or database activity metrics.

**project-registry.json:** `import`: Egg's createProject requires a name, server, repository URL and runtime, and only creates the project; it cannot perform org-based build detection, the initial deployment or return the protected address.

**projects.json:** `project create`: Egg's SDK only creates deployable projects from a repository on a server and requires server, repository, and runtime inputs; it has no method for creating an organization project from name, slug, and description alone. `project update`: Egg's updateProject SDK method only changes deployment settings; it has no fields for project name, description, repository URL, icon, or background image.

**services-compose.json:** `service list`: Egg can list services, but its command does not scope them to one deployment. `service create`: Egg creates a deployable service from source, while this command adds a port service to an existing deployment. `service delete`: Egg confirms deletion with the exact name, but its command deletes a deployable service rather than a deployment port service. `service exposure set`: Egg attaches or removes a domain, while this command switches the service between public and internal networking. `service port public enable`: Egg can change a service's public port number, but it does not enable exposure for one selected port. `service port public disable`: Egg can change a service's public port number, but it does not disable exposure for one selected port. `compose auto-deploy enable`: needs SDK method enableAutoDeploy `compose auto-deploy disable`: needs SDK method disableAutoDeploy

Orchard groups that do not apply to Egg are not offered: managed Postgres and other managed database bindings, Greenhouse sandboxes, templates, Tailscale, account/token management, memberships/invitations, and credential/SSH identity management. Accounts and tokens stay in the dashboard.

## Output and exit codes

Use `--json` for machine-readable output. Errors go to stderr. Bearer tokens are always hidden; `--show-secrets` applies to other secret fields in API responses, never tokens. Offline commands do not read or write tokens.

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Failed for another request or network error |
| 2 | Wrong use: unknown command/option, missing required argument/option, or confirmation mismatch |
| 3 | Authentication failed or token missing |
| 4 | Resource not found |
| 6 | Rate limited |
| 7 | Egg returned a server error |
| 8 | Request timed out |

## The token

Remote commands read `EGG_TOKEN` and `EGG_URL`, or the global `--token` and `--url` options. The token is sent as an authorization header and never printed. `whoami` shows the account and scopes, not the token. Token creation and account management stay in the dashboard.

## Examples

```sh
export EGG_TOKEN="$EGG_TOKEN"
export EGG_URL=https://deploy.example.com

egg whoami
egg projects list
egg deploy create my-app --branch feature/login --wait
egg env names my-app
egg status --json
egg use my-app --org team --env production
egg context show
```
## From code

The same client is available to your own scripts. The API client has a method for every registered endpoint; `web/src/lib/sdk/endpoint-coverage.test.ts` checks that coverage. The CLI does not expose every endpoint, including analytics, terminal and file operations.

```ts
import { Egg } from "./egg";

const egg = new Egg({ token: process.env.EGG_TOKEN!, baseUrl: process.env.EGG_URL! });
// The Developer page names these NEST_TOKEN/NEST_URL; pass whichever your script uses.
const { projects } = await egg.listProjects();
```
