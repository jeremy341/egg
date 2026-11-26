# Orchard feature comparison

The checklist compares Orchard’s 217 product tools with Egg’s current 75 public API endpoints. Status counts exclude cluster-only tools marked not applicable. The [machine-readable checklist](../web/src/server/parity/orchard-parity.json) is validated against [`ENDPOINTS`](../web/src/server/api-v1.ts#L471).

| Status | Coverage | Evidence |
| --- | --- | --- |
| Present (42) | Projects, deployments, environment variables, GitHub repository/status, current user, DNS validation, deployment diagnostics/logs/rollout, redeploy/rollback, scheduled jobs, webhook notifications, log search/context. | [Core API](../web/src/server/api-v1.ts#L225), [expanded API](../web/src/server/api-v1-more.ts#L795), [Orchard API additions](../web/src/server/api-v1-orchard.ts#L336) |
| Partial (11) | Deploy from GitHub maps to branch deploy; ingress maps to custom domains; deployment restart maps to service restart; deployment metrics map to resource history; resource quota maps to project resource usage; webhook token creation maps to hook rotation; changes map to activity; build cancellation maps to deployment cancellation. | [Endpoint registry](../web/src/server/api-v1.ts#L471), [full mappings](../web/src/server/parity/orchard-parity.json) |
| Not applicable (80 tools) | Managed PostgreSQL (including replicas), pods/containers, node pools, Greenhouse sandboxes and template registry/instances require Orchard’s cluster. Terraform and Tailscale are also cluster/infrastructure features outside this single-Nest-server API; they have no separate rows in Orchard’s 217-tool manifest. | [Checklist reasons](../web/src/server/parity/orchard-parity.json), [endpoint registry](../web/src/server/api-v1.ts#L471) |

The remaining 84 tools are missing: no endpoint implements them and no sufficiently close endpoint exists. “Present” means the API endpoint implements the tool’s operation; “partial” means a nearby endpoint covers only part of it.
