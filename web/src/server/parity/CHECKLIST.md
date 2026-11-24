# Orchard parity checklist (MCP and API tools)

Generated from hackclub/orchard `apps/server/src/mcp/tools/*.ts` and `grafts/greenhouse/mcp`. Our side: `ENDPOINTS` in `web/src/server/api-v1.ts`. Test-only names are excluded.

Totals: 217 Orchard product tools. Present: 22. Partial: 11. Missing: 184. Ours only: 20.

`present` means an equivalent endpoint exists with the same job. `partial` means it covers part of the job. `missing` means no equivalent yet.

## apps/server/src/mcp/compact/compact-server.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [ ] `call_api` | missing | - |
| [ ] `describe_operation` | missing | - |
| [ ] `search_api` | missing | - |

## apps/server/src/mcp/tools/compose.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [ ] `get_compose_stack` | missing | - |
| [ ] `list_compose_stacks` | missing | - |
| [ ] `redeploy_compose_stack` | missing | - |

## apps/server/src/mcp/tools/configuration.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [~] `add_env_vars` | partial | `set_env_var` |
| [x] `create_ingress` | present | `add_domain` |
| [ ] `create_service` | missing | - |
| [ ] `delete_registry_credential` | missing | - |
| [ ] `get_ingress_protection` | missing | - |
| [ ] `list_registry_credentials` | missing | - |
| [~] `set_env_vars` | partial | `set_env_var` |
| [ ] `set_ingress_protection` | missing | - |
| [ ] `set_registry_credential` | missing | - |
| [ ] `set_service_exposure` | missing | - |
| [ ] `set_service_port_public` | missing | - |
| [ ] `update_deployment_build_config` | missing | - |
| [ ] `update_deployment_health_check` | missing | - |
| [ ] `update_deployment_image` | missing | - |
| [ ] `update_deployment_pull_policy` | missing | - |
| [ ] `update_deployment_strategy` | missing | - |
| [ ] `update_deployment_volumes` | missing | - |
| [ ] `update_ingress` | missing | - |
| [ ] `update_service` | missing | - |

## apps/server/src/mcp/tools/dangerous.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [ ] `delete_database` | missing | - |
| [ ] `delete_deploy_webhook_token` | missing | - |
| [ ] `delete_deployment` | missing | - |
| [x] `delete_env_vars` | present | `delete_env_var` |
| [ ] `delete_environment` | missing | - |
| [x] `delete_ingress` | present | `remove_domain` |
| [ ] `delete_notification_channel` | missing | - |
| [x] `delete_project` | present | `delete_project` |
| [ ] `delete_service` | missing | - |
| [ ] `delete_template_instance` | missing | - |
| [ ] `disable_database_deletion_protection` | missing | - |
| [ ] `restore_checkpoint` | missing | - |
| [ ] `restore_database` | missing | - |
| [ ] `undo_database_restore` | missing | - |
| [ ] `upgrade_database` | missing | - |

## apps/server/src/mcp/tools/database-recovery.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [ ] `cancel_database_operation` | missing | - |
| [ ] `create_checkpoint` | missing | - |
| [ ] `create_database_user` | missing | - |
| [ ] `delete_database_user` | missing | - |
| [ ] `diagnose_database` | missing | - |
| [ ] `fork_database` | missing | - |
| [ ] `get_database_activity` | missing | - |
| [ ] `get_database_operation` | missing | - |
| [ ] `get_database_pooler` | missing | - |
| [ ] `get_database_recovery_window` | missing | - |
| [ ] `get_database_replication` | missing | - |
| [ ] `get_database_security` | missing | - |
| [ ] `get_project_database_security` | missing | - |
| [ ] `list_checkpoints` | missing | - |
| [ ] `list_database_operations` | missing | - |
| [ ] `list_database_restore_tests` | missing | - |
| [ ] `list_database_users` | missing | - |
| [ ] `list_deleted_databases` | missing | - |
| [ ] `list_postgres_versions` | missing | - |
| [ ] `set_database_pooler` | missing | - |
| [ ] `set_database_protection` | missing | - |
| [ ] `set_database_replication` | missing | - |
| [ ] `test_database_backup` | missing | - |
| [ ] `undelete_database` | missing | - |
| [ ] `update_database_minor` | missing | - |

## apps/server/src/mcp/tools/deployments.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [x] `cancel_build` | present | `cancel_deployment` |
| [~] `create_deploy_webhook_token` | partial | `rotate_deploy_hook` |
| [ ] `create_deployment` | missing | - |
| [~] `deploy_from_github` | partial | `deploy_branch` |
| [~] `deploy_from_github_url` | partial | `deploy_branch` |
| [ ] `disable_auto_deploy` | missing | - |
| [ ] `enable_auto_deploy` | missing | - |
| [ ] `get_auto_deploy_status` | missing | - |
| [ ] `get_deployment_next_steps` | missing | - |
| [ ] `list_deploy_webhook_tokens` | missing | - |
| [ ] `list_github_deploy_targets` | missing | - |
| [x] `rebuild_deployment` | present | `redeploy` |
| [ ] `rename_deployment` | missing | - |
| [~] `restart_deployment` | partial | `restart_service` |
| [ ] `retry_deployment_apply` | missing | - |
| [x] `rollback_deployment` | present | `rollback_deployment` |
| [ ] `scale_deployment` | missing | - |
| [ ] `start_deployment` | missing | - |
| [ ] `stop_deployment` | missing | - |
| [ ] `update_deployment_disruption_budget` | missing | - |
| [ ] `update_deployment_github_repo` | missing | - |
| [ ] `update_deployment_placement` | missing | - |
| [ ] `update_deployment_resources` | missing | - |

## apps/server/src/mcp/tools/environments.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [ ] `add_shared_env_vars` | missing | - |
| [ ] `create_environment` | missing | - |
| [ ] `delete_shared_env_vars` | missing | - |
| [ ] `get_shared_env_vars` | missing | - |
| [ ] `list_environments` | missing | - |
| [ ] `rename_environment` | missing | - |
| [ ] `set_default_environment` | missing | - |
| [ ] `set_shared_env_vars` | missing | - |

## apps/server/src/mcp/tools/jobs.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [ ] `cancel_job_run` | missing | - |
| [ ] `create_job` | missing | - |
| [ ] `delete_job` | missing | - |
| [ ] `get_job` | missing | - |
| [ ] `get_job_run` | missing | - |
| [ ] `get_job_run_logs` | missing | - |
| [ ] `list_job_runs` | missing | - |
| [ ] `list_jobs` | missing | - |
| [ ] `replace_job_steps` | missing | - |
| [ ] `run_job` | missing | - |
| [ ] `update_job` | missing | - |

## apps/server/src/mcp/tools/notifications.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [ ] `create_notification_channel` | missing | - |
| [ ] `create_notification_rule` | missing | - |
| [ ] `delete_notification_rule` | missing | - |
| [~] `list_notification_channels` | partial | `get_notifications` |
| [ ] `list_notification_deliveries` | missing | - |
| [ ] `list_notification_rules` | missing | - |
| [ ] `replay_notification_channel` | missing | - |
| [~] `test_notification_channel` | partial | `test_notification` |
| [ ] `update_notification_channel` | missing | - |
| [ ] `update_notification_rule` | missing | - |

## apps/server/src/mcp/tools/observability.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [ ] `diagnose_deployment` | missing | - |
| [x] `get_alert_states` | present | `get_alerts` |
| [ ] `get_anomalies` | missing | - |
| [ ] `get_attack_signals` | missing | - |
| [ ] `get_build_history` | missing | - |
| [~] `get_changes` | partial | `get_activity` |
| [ ] `get_deploy_verdict` | missing | - |
| [ ] `get_log_context` | missing | - |
| [ ] `get_observability_link` | missing | - |
| [ ] `get_pod_health` | missing | - |
| [ ] `get_request_stats` | missing | - |
| [ ] `get_resource_recommendation` | missing | - |
| [x] `get_timeline` | present | `get_activity` |
| [ ] `get_volumes` | missing | - |
| [ ] `search_logs` | missing | - |

## apps/server/src/mcp/tools/query.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [ ] `analyze_deployment_resources` | missing | - |
| [ ] `detect_repo_config` | missing | - |
| [~] `exec_in_pod` | partial | `terminal_send` |
| [ ] `find` | missing | - |
| [ ] `get_audit_log` | missing | - |
| [ ] `get_build_logs` | missing | - |
| [x] `get_current_user` | present | `get_me` |
| [ ] `get_database` | missing | - |
| [ ] `get_database_metrics` | missing | - |
| [x] `get_deployment` | present | `get_deployment` |
| [ ] `get_deployment_http_metrics` | missing | - |
| [x] `get_deployment_logs` | present | `get_logs` |
| [~] `get_deployment_metrics` | partial | `get_resource_history` |
| [ ] `get_deployment_volumes` | missing | - |
| [ ] `get_env_vars` | missing | - |
| [ ] `get_github_status` | missing | - |
| [ ] `get_image_history` | missing | - |
| [ ] `get_ingress` | missing | - |
| [ ] `get_killed_container_logs` | missing | - |
| [ ] `get_pod_details` | missing | - |
| [ ] `get_pod_logs` | missing | - |
| [x] `get_project` | present | `get_project` |
| [ ] `get_repo_branches` | missing | - |
| [ ] `get_repo_contents` | missing | - |
| [ ] `get_repo_dockerfiles` | missing | - |
| [x] `get_resource_quota` | present | `get_project_resources` |
| [ ] `get_template` | missing | - |
| [ ] `get_template_instance` | missing | - |
| [ ] `get_template_yaml_guide` | missing | - |
| [ ] `list_databases` | missing | - |
| [ ] `list_deployment_errors` | missing | - |
| [x] `list_deployments` | present | `list_deployments` |
| [ ] `list_github_repos` | missing | - |
| [x] `list_ingresses` | present | `list_domains` |
| [ ] `list_killed_containers` | missing | - |
| [ ] `list_node_pools` | missing | - |
| [ ] `list_organizations` | missing | - |
| [ ] `list_pods` | missing | - |
| [x] `list_projects` | present | `list_projects` |
| [ ] `list_services` | missing | - |
| [ ] `list_template_instances` | missing | - |
| [ ] `list_templates` | missing | - |
| [ ] `triage_deployment_error` | missing | - |
| [x] `validate_dns` | present | `verify_domain` |

## apps/server/src/mcp/tools/resources.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [ ] `clear_database_backup_schedule` | missing | - |
| [ ] `create_database` | missing | - |
| [ ] `create_database_backup` | missing | - |
| [x] `create_project` | present | `create_project` |
| [ ] `deploy_template` | missing | - |
| [ ] `disable_database_public` | missing | - |
| [ ] `enable_database_public` | missing | - |
| [ ] `expand_database_storage` | missing | - |
| [ ] `get_database_backup_schedule` | missing | - |
| [ ] `get_database_connection` | missing | - |
| [ ] `get_database_limits` | missing | - |
| [ ] `get_database_query_stats` | missing | - |
| [ ] `get_database_settings` | missing | - |
| [ ] `install_database_extension` | missing | - |
| [ ] `list_database_backups` | missing | - |
| [ ] `list_database_extensions` | missing | - |
| [ ] `rename_database` | missing | - |
| [ ] `reset_database_query_stats` | missing | - |
| [ ] `restart_database` | missing | - |
| [ ] `scale_database` | missing | - |
| [ ] `set_database_backup_schedule` | missing | - |
| [ ] `start_database` | missing | - |
| [ ] `stop_database` | missing | - |
| [ ] `uninstall_database_extension` | missing | - |
| [ ] `update_database_resources` | missing | - |
| [ ] `update_database_settings` | missing | - |
| [x] `update_project` | present | `update_project` |

## apps/server/src/mcp/tools/rollout.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [x] `get_deployment_rollout` | present | `get_rollout` |
| [ ] `list_build_runs` | missing | - |
| [ ] `list_releases` | missing | - |
| [x] `rollback_to_previous` | present | `rollback_deployment` |

## apps/server/test/grafts.test.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [ ] `list_sandboxes` | missing | - |

## grafts/greenhouse/mcp/src/tools.ts

| Orchard tool | Status | Our endpoint |
|---|---|---|
| [ ] `create_sandbox_session` | missing | - |
| [ ] `create_sandbox_session_pr` | missing | - |
| [ ] `get_sandbox` | missing | - |
| [ ] `get_sandbox_session_diff` | missing | - |
| [ ] `get_sandbox_session_transcript` | missing | - |
| [ ] `list_sandbox_sessions` | missing | - |
| [ ] `prompt_sandbox_session` | missing | - |
| [ ] `start_sandbox` | missing | - |
| [ ] `stop_sandbox` | missing | - |

## Ours only (no Orchard equivalent)

`delete_file`, `download_file`, `get_analytics`, `get_container_inventory`, `get_deployment_logs`, `get_server_usage`, `get_status_page`, `list_env_vars`, `list_files`, `list_servers`, `make_folder`, `read_file`, `rename_file`, `revoke_deploy_hook`, `terminal_close`, `terminal_open`, `terminal_read`, `terminal_resize`, `terminal_status`, `write_file`

## Not in the MCP list (ported or not, tracked separately)

- CLI: Orchard has about 421 commands in Go (`apps/cli`). Egg has 5 read-only commands in `web/scripts/egg-cli.mjs`.
- API routes: Orchard has 73 controllers. Egg has 171 route files under `web/src/app/api`.
- Database migrations: Orchard has 145 SQL files. Egg has 56.
- Grafts (extension system): Orchard has 3 (greenhouse, forum, announcements). Egg has none. Greenhouse is Phase 6.
- Managed Postgres (backups, checkpoints, replicas, pooler, extensions, users): Orchard has about 42 database tools. Egg has none, by decision (Phase 5 reduced to `pg_dump` backups).
- Templates registry and template instances: Orchard has 6 tools. Egg has none.
- Infrastructure (Kubernetes, Helm, Terraform, Tailscale, Firecracker builds, gateway, S3 gateway): not ported. Out of scope for one Nest container, by decision.
- OAuth for MCP clients: not built.
