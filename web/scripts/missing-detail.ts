import { ENDPOINTS } from "../src/server/api-v1";
const ids = "add_env_vars create_job create_notification_channel create_notification_rule delete_env_vars delete_job diagnose_deployment find get_deployment_next_steps get_github_status get_job get_job_run_logs get_log_context list_deploy_webhook_tokens list_deployment_errors list_github_repos list_job_runs list_jobs list_notification_channels list_notification_rules run_job search_logs set_env_vars test_notification_channel triage_deployment_error update_job".split(" ");
for (const id of ids) {
  const e = ENDPOINTS.find(x => x.id === id)!;
  const body = e.body ? "body" : "-";
  console.log(`${id}|${e.method}|${e.path}|${body}|${e.scope ?? "none"}`);
}
