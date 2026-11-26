import { ENDPOINTS } from "../src/server/api-v1";
import { Egg } from "../src/lib/sdk/egg";
const proto = Egg.prototype as unknown as Record<string, unknown>;
const known = new Set([
  "get_me","list_projects","get_project","create_project","update_project","delete_project",
  "list_deployments","get_deployment","deploy_branch","redeploy","cancel_deployment","rollback_deployment",
  "get_rollout","restart_service","get_logs","get_deployment_logs","list_domains","add_domain","verify_domain",
  "remove_domain","rotate_deploy_hook","revoke_deploy_hook","get_notifications","test_notification",
  "list_env_vars","set_env_var","delete_env_var","get_analytics","get_usage","get_project_resources",
  "get_container_inventory","get_alerts","get_activity","terminal_status","terminal_open","terminal_send",
  "terminal_read","terminal_resize","terminal_close","list_files","read_file","write_file","delete_file",
  "make_folder","get_status_page","enable_status_page","disable_status_page","list_servers","add_server",
  "remove_server","test_server","create_webhook","list_webhooks","delete_webhook","get_deployment_page",
]);
for (const e of ENDPOINTS) {
  const method = e.id.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const has = typeof proto[method] === "function";
  if (!has) console.log(`${e.id}\t${e.method}\t${e.path}\t${method}`);
}
