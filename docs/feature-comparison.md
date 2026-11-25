# Orchard feature comparison

The checklist compares Orchard’s 217 product tools with Egg’s current public API registry. Status counts cover all Orchard tools; cluster-only tools marked not applicable are excluded from the missing count. The [machine-readable checklist](../web/src/server/parity/orchard-parity.json) is validated against [the endpoint registry](../web/src/server/api-v1.ts#L440), which also generates the REST, OpenAPI, and MCP surfaces.

| Status | Coverage | Evidence |
| --- | --- | --- |
| Present (121) | Projects, service port and internal-domain configuration, deployments and lifecycle, project and shared environment variables, named shared environments, auto-deploy, domains and ingress protection, registry credentials, GitHub repository configuration and discovery, jobs and run status, notifications and delivery history, audit/activity, logs and diagnostics, resource usage, current user, and DNS verification. | [Core API](../web/src/server/api-v1.ts#L440), [endpoint modules](../web/src/server/) |
| Partial (10) | Deploy-from-GitHub variants, ingress overlap, deployment metrics and resource quota, webhook-token lifecycle, activity/change history, and deployment/build cancellation. Each row records why behavior or data shape is narrower. | [Checklist reasons](../web/src/server/parity/orchard-parity.json) |
| Not applicable (82 tools) | Managed PostgreSQL, pods/containers and node pools, Greenhouse sandboxes, and Orchard’s cluster-managed template registry/instances require infrastructure outside this single-Nest-server API. | [Checklist reasons](../web/src/server/parity/orchard-parity.json) |
| Missing (4 tools) | No corresponding registered public endpoint implements the remaining Orchard operation. | [Checklist](../web/src/server/parity/orchard-parity.json) |

“Present” means an equivalent operation is implemented by the mapped endpoint; “partial” means the endpoint covers only part of it; “missing” means there is no sufficiently close endpoint; and “not applicable” means the feature depends on Orchard’s cluster or managed infrastructure. Endpoints without an Orchard mapping are listed as ours_only in the checklist.

Shared environments are account-wide sets applied to all projects owned by that account on their next deployment. The first set becomes the default; a later set applies only after it is selected. Variables are encrypted at rest and remain write-only: list operations return names and targets, never values. Target-specific values override the set’s `all` value, project variables override shared values, and Egg’s generated variables (`PORT`, `HOST`, `PATH`, `HOME`, `NODE_ENV`, and `EGG`) stay authoritative.
