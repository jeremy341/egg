# Orchard parity checklist (MCP and API tools)

Generated from the Orchard parity manifest (`orchard-parity.json`). Our side: `ENDPOINTS` in `web/src/server/api-v1*.ts`, plus the compact server's three tools in `web/src/server/mcp-compact.ts`. Test-only names are excluded.

Totals: 217 Orchard product tools. Present: 126. Partial: 10. Missing: 0. Not applicable: 81. Ours only: 34.

`present` means an equivalent endpoint exists with the same job. `partial` means it covers part of the job. `missing` means no equivalent yet.

## apps/server/src/mcp/tools/configuration.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [x] `add_env_vars` | present | `add_env_vars` |
| [~] `create_ingress` | partial | `add_domain` |
| [x] `create_service` | present | `create_service` |
| [x] `delete_registry_credential` | present | `delete_registry_credential` |
| [x] `get_ingress_protection` | present | `get_ingress_protection` |
| [x] `list_registry_credentials` | present | `list_registry_credentials` |
| [x] `set_env_vars` | present | `set_env_vars` |
| [x] `set_ingress_protection` | present | `set_ingress_protection` |
| [x] `set_registry_credential` | present | `set_registry_credential` |
| [x] `set_service_exposure` | present | `set_service_exposure` |
| [x] `set_service_port_public` | present | `set_service_port_public` |
| [x] `update_deployment_build_config` | present | `update_deployment_build_config` |
| [x] `update_deployment_health_check` | present | `update_deployment_health_check` |
| [x] `update_deployment_image` | present | `update_deployment_image` |
| [x] `update_deployment_pull_policy` | present | `update_deployment_pull_policy` |
| [x] `update_deployment_strategy` | present | `update_deployment_strategy` |
| [x] `update_deployment_volumes` | present | `update_deployment_volumes` |
| [x] `update_ingress` | present | `update_ingress` |
| [x] `update_service` | present | `update_service` |

## apps/server/src/mcp/tools/environments.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [x] `add_shared_env_vars` | present | `add_shared_env_vars` |
| [x] `create_environment` | present | `create_environment` |
| [x] `delete_shared_env_vars` | present | `delete_shared_env_vars` |
| [x] `get_shared_env_vars` | present | `get_shared_env_vars` |
| [x] `list_environments` | present | `list_environments` |
| [x] `rename_environment` | present | `rename_environment` |
| [x] `set_default_environment` | present | `set_default_environment` |
| [x] `set_shared_env_vars` | present | `set_shared_env_vars` |

## apps/server/src/mcp/tools/query.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [x] `analyze_deployment_resources` | present | `analyze_deployment_resources` |
| [x] `detect_repo_config` | present | `detect_repo_config` |
| [-] `exec_in_pod` | not applicable | - |
| [x] `find` | present | `find` |
| [x] `get_audit_log` | present | `get_audit_log` |
| [x] `get_build_logs` | present | `get_build_logs` |
| [x] `get_current_user` | present | `get_me` |
| [-] `get_database` | not applicable | - |
| [-] `get_database_metrics` | not applicable | - |
| [x] `get_deployment` | present | `get_deployment` |
| [x] `get_deployment_http_metrics` | present | `get_deployment_http_metrics` |
| [x] `get_deployment_logs` | present | `get_deployment_logs` |
| [~] `get_deployment_metrics` | partial | `get_deployment_metrics` |
| [x] `get_deployment_volumes` | present | `get_deployment_volumes` |
| [x] `get_env_vars` | present | `get_env_vars` |
| [x] `get_github_status` | present | `get_github_status` |
| [x] `get_image_history` | present | `get_image_history` |
| [x] `get_ingress` | present | `get_ingress` |
| [x] `get_killed_container_logs` | present | `get_killed_container_logs` |
| [~] `get_pod_details` | partial | `get_project_container` |
| [-] `get_pod_logs` | not applicable | - |
| [x] `get_project` | present | `get_project` |
| [x] `get_repo_branches` | present | `get_repo_branches` |
| [x] `get_repo_contents` | present | `get_repo_contents` |
| [x] `get_repo_dockerfiles` | present | `get_repo_dockerfiles` |
| [~] `get_resource_quota` | partial | `get_resource_quota` |
| [-] `get_template` | not applicable | - |
| [-] `get_template_instance` | not applicable | - |
| [-] `get_template_yaml_guide` | not applicable | - |
| [-] `list_databases` | not applicable | - |
| [x] `list_deployment_errors` | present | `list_deployment_errors` |
| [x] `list_deployments` | present | `list_deployments` |
| [x] `list_github_repos` | present | `list_github_repos` |
| [~] `list_ingresses` | partial | `list_domains` |
| [-] `list_killed_containers` | not applicable | - |
| [-] `list_node_pools` | not applicable | - |
| [x] `list_organizations` | present | `list_organizations` |
| [~] `list_pods` | partial | `list_project_containers` |
| [x] `list_projects` | present | `list_projects` |
| [x] `list_services` | present | `list_services` |
| [-] `list_template_instances` | not applicable | - |
| [-] `list_templates` | not applicable | - |
| [x] `triage_deployment_error` | present | `triage_deployment_error` |
| [x] `validate_dns` | present | `verify_domain` |

## apps/server/src/mcp/compact/compact-server.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [x] `call_api` | present | `compact:call_api` |
| [x] `describe_operation` | present | `compact:describe_operation` |
| [x] `search_api` | present | `compact:search_api` |

## apps/server/src/mcp/tools/deployments.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [x] `cancel_build` | present | `cancel_deployment` |
| [~] `create_deploy_webhook_token` | partial | `rotate_deploy_hook` |
| [x] `create_deployment` | present | `create_deployment` |
| [x] `deploy_from_github` | present | `deploy_from_github_url` |
| [x] `deploy_from_github_url` | present | `deploy_from_github_url` |
| [x] `disable_auto_deploy` | present | `disable_auto_deploy` |
| [x] `enable_auto_deploy` | present | `enable_auto_deploy` |
| [x] `get_auto_deploy_status` | present | `get_auto_deploy_status` |
| [x] `get_deployment_next_steps` | present | `get_deployment_next_steps` |
| [x] `list_deploy_webhook_tokens` | present | `list_deploy_webhook_tokens` |
| [x] `list_github_deploy_targets` | present | `list_github_deploy_targets` |
| [x] `rebuild_deployment` | present | `redeploy` |
| [x] `rename_deployment` | present | `rename_deployment` |
| [x] `restart_deployment` | present | `restart_deployment` |
| [x] `retry_deployment_apply` | present | `retry_deployment_apply` |
| [x] `rollback_deployment` | present | `rollback_deployment` |
| [x] `scale_deployment` | present | `scale_deployment` |
| [x] `start_deployment` | present | `start_deployment` |
| [x] `stop_deployment` | present | `stop_deployment` |
| [-] `update_deployment_disruption_budget` | not applicable | - |
| [x] `update_deployment_github_repo` | present | `update_deployment_github_repo` |
| [-] `update_deployment_placement` | not applicable | - |
| [x] `update_deployment_resources` | present | `update_deployment_resources` |

## apps/server/src/mcp/tools/database-recovery.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [-] `cancel_database_operation` | not applicable | - |
| [-] `create_checkpoint` | not applicable | - |
| [-] `create_database_user` | not applicable | - |
| [-] `delete_database_user` | not applicable | - |
| [-] `diagnose_database` | not applicable | - |
| [-] `fork_database` | not applicable | - |
| [-] `get_database_activity` | not applicable | - |
| [-] `get_database_operation` | not applicable | - |
| [-] `get_database_pooler` | not applicable | - |
| [-] `get_database_recovery_window` | not applicable | - |
| [-] `get_database_replication` | not applicable | - |
| [-] `get_database_security` | not applicable | - |
| [-] `get_project_database_security` | not applicable | - |
| [-] `list_checkpoints` | not applicable | - |
| [-] `list_database_operations` | not applicable | - |
| [-] `list_database_restore_tests` | not applicable | - |
| [-] `list_database_users` | not applicable | - |
| [-] `list_deleted_databases` | not applicable | - |
| [-] `list_postgres_versions` | not applicable | - |
| [-] `set_database_pooler` | not applicable | - |
| [-] `set_database_protection` | not applicable | - |
| [-] `set_database_replication` | not applicable | - |
| [-] `test_database_backup` | not applicable | - |
| [-] `undelete_database` | not applicable | - |
| [-] `update_database_minor` | not applicable | - |

## apps/server/src/mcp/tools/jobs.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [x] `cancel_job_run` | present | `cancel_job_run` |
| [x] `create_job` | present | `create_job` |
| [x] `delete_job` | present | `delete_job` |
| [x] `get_job` | present | `get_job` |
| [x] `get_job_run` | present | `get_job_run` |
| [x] `get_job_run_logs` | present | `get_job_run_logs` |
| [x] `list_job_runs` | present | `list_job_runs` |
| [x] `list_jobs` | present | `list_jobs` |
| [x] `replace_job_steps` | present | `replace_job_steps` |
| [x] `run_job` | present | `run_job` |
| [x] `update_job` | present | `update_job` |

## apps/server/src/mcp/tools/resources.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [-] `clear_database_backup_schedule` | not applicable | - |
| [-] `create_database` | not applicable | - |
| [-] `create_database_backup` | not applicable | - |
| [x] `create_project` | present | `create_project` |
| [-] `deploy_template` | not applicable | - |
| [-] `disable_database_public` | not applicable | - |
| [-] `enable_database_public` | not applicable | - |
| [-] `expand_database_storage` | not applicable | - |
| [-] `get_database_backup_schedule` | not applicable | - |
| [-] `get_database_connection` | not applicable | - |
| [-] `get_database_limits` | not applicable | - |
| [-] `get_database_query_stats` | not applicable | - |
| [-] `get_database_settings` | not applicable | - |
| [-] `install_database_extension` | not applicable | - |
| [-] `list_database_backups` | not applicable | - |
| [-] `list_database_extensions` | not applicable | - |
| [-] `rename_database` | not applicable | - |
| [-] `reset_database_query_stats` | not applicable | - |
| [-] `restart_database` | not applicable | - |
| [-] `scale_database` | not applicable | - |
| [-] `set_database_backup_schedule` | not applicable | - |
| [-] `start_database` | not applicable | - |
| [-] `stop_database` | not applicable | - |
| [-] `uninstall_database_extension` | not applicable | - |
| [-] `update_database_resources` | not applicable | - |
| [-] `update_database_settings` | not applicable | - |
| [x] `update_project` | present | `update_project` |

## apps/server/src/mcp/tools/notifications.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [x] `create_notification_channel` | present | `create_notification_channel` |
| [x] `create_notification_rule` | present | `create_notification_rule` |
| [x] `delete_notification_rule` | present | `delete_notification_rule` |
| [x] `list_notification_channels` | present | `list_notification_channels` |
| [x] `list_notification_deliveries` | present | `list_notification_deliveries` |
| [x] `list_notification_rules` | present | `list_notification_rules` |
| [x] `replay_notification_channel` | present | `replay_notification_channel` |
| [x] `test_notification_channel` | present | `test_notification_channel` |
| [x] `update_notification_channel` | present | `update_notification_channel` |
| [x] `update_notification_rule` | present | `update_notification_rule` |

## grafts/greenhouse/mcp/src/tools.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [-] `create_sandbox_session` | not applicable | - |
| [-] `create_sandbox_session_pr` | not applicable | - |
| [-] `get_sandbox` | not applicable | - |
| [-] `get_sandbox_session_diff` | not applicable | - |
| [-] `get_sandbox_session_transcript` | not applicable | - |
| [-] `list_sandbox_sessions` | not applicable | - |
| [-] `prompt_sandbox_session` | not applicable | - |
| [-] `start_sandbox` | not applicable | - |
| [-] `stop_sandbox` | not applicable | - |

## apps/server/src/mcp/tools/dangerous.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [-] `delete_database` | not applicable | - |
| [~] `delete_deploy_webhook_token` | partial | `revoke_deploy_hook` |
| [x] `delete_deployment` | present | `delete_deployment` |
| [x] `delete_env_vars` | present | `delete_env_vars` |
| [x] `delete_environment` | present | `delete_environment` |
| [~] `delete_ingress` | partial | `remove_domain` |
| [x] `delete_notification_channel` | present | `delete_notification_channel` |
| [x] `delete_project` | present | `delete_project` |
| [x] `delete_service` | present | `delete_service` |
| [-] `delete_template_instance` | not applicable | - |
| [-] `disable_database_deletion_protection` | not applicable | - |
| [-] `restore_checkpoint` | not applicable | - |
| [-] `restore_database` | not applicable | - |
| [-] `undo_database_restore` | not applicable | - |
| [-] `upgrade_database` | not applicable | - |

## apps/server/src/mcp/tools/observability.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [x] `diagnose_deployment` | present | `diagnose_deployment` |
| [x] `get_alert_states` | present | `get_alerts` |
| [x] `get_anomalies` | present | `get_anomalies` |
| [x] `get_attack_signals` | present | `get_attack_signals` |
| [x] `get_build_history` | present | `get_build_history` |
| [x] `get_changes` | present | `get_changes` |
| [x] `get_deploy_verdict` | present | `get_deploy_verdict` |
| [x] `get_log_context` | present | `get_log_context` |
| [x] `get_observability_link` | present | `get_observability_link` |
| [~] `get_pod_health` | partial | `get_project_health` |
| [x] `get_request_stats` | present | `get_request_stats` |
| [x] `get_resource_recommendation` | present | `get_resource_recommendation` |
| [x] `get_timeline` | present | `get_activity` |
| [x] `get_volumes` | present | `get_volumes` |
| [x] `search_logs` | present | `search_logs` |

## apps/server/src/mcp/tools/compose.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [x] `get_compose_stack` | present | `get_compose_stack` |
| [x] `list_compose_stacks` | present | `list_compose_stacks` |
| [x] `redeploy_compose_stack` | present | `redeploy_compose_stack` |

## apps/server/src/mcp/tools/rollout.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [x] `get_deployment_rollout` | present | `get_rollout` |
| [x] `list_build_runs` | present | `list_build_runs` |
| [x] `list_releases` | present | `list_releases` |
| [x] `rollback_to_previous` | present | `rollback_deployment` |

## apps/server/test/grafts.test.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [-] `list_sandboxes` | not applicable | - |

## Ours only (no Orchard equivalent)

`delete_env_var`, `delete_file`, `deploy_branch`, `download_file`, `get_analytics`, `get_container_inventory`, `get_crash_report`, `get_logs`, `get_notification_channel`, `get_notifications`, `get_organization`, `get_project_resources`, `get_resource_history`, `get_server_usage`, `get_status_page`, `list_compose_releases`, `list_crash_reports`, `list_env_vars`, `list_files`, `list_servers`, `make_folder`, `read_file`, `rename_file`, `restart_service`, `set_env_var`, `set_env_var_secret`, `terminal_close`, `terminal_open`, `terminal_read`, `terminal_resize`, `terminal_send`, `terminal_status`, `test_notification`, `write_file`

## Not in the MCP list (ported or not, tracked separately)

- CLI: Orchard has 421 command definitions in Go (`apps/cli/cmd`, cobra `Use:` strings, including group nodes and subcommands). Egg has 153 commands: the base set in `web/scripts/egg-cli.mjs` and one module per Orchard group in `web/scripts/egg-cli-groups`. The per-group checklist is `web/src/server/parity/cli/*.json`, checked by `cli-checklist.test.ts`; its not-applicable entries for infrastructure are in `infra.json`.
- API routes: Orchard has 73 controllers. Egg has 171 route files under `web/src/app/api`.
- Database migrations: Orchard has 145 SQL files. Egg has 56.
- Grafts (extension system): Orchard has 3 (greenhouse, forum, announcements). Egg has a first-party grafts registry with Announcements (`web/src/server/grafts`). Greenhouse is not built: it needs cloud sandboxes.
- Managed Postgres (backups, checkpoints, replicas, pooler, extensions, users): Orchard has about 42 database tools. Egg has none, by decision (Phase 5 reduced to `pg_dump` backups).
- Templates registry and template instances: Orchard has 6 tools. Egg has none.
- Infrastructure (Kubernetes, Helm, Terraform, Tailscale, Firecracker builds, gateway, S3 gateway): not ported. Out of scope for one Nest container, by decision.
- OAuth for MCP clients: built. Consent page at `web/src/app/(app)/oauth/consent`, authorization-server metadata at `web/src/app/.well-known/oauth-authorization-server`, protected-resource metadata at `web/src/app/.well-known/oauth-protected-resource`.
