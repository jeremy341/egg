# Orchard feature comparison

The checklist compares Orchard’s 217 product tools with Egg’s current 109 registered public API endpoints. Status counts cover all Orchard tools; cluster-only tools marked not applicable are excluded from the missing count. The [machine-readable checklist](../web/src/server/parity/orchard-parity.json) is validated against [the endpoint registry](../web/src/server/api-v1.ts#L440). The newer deployment (11 IDs), Compose (4), organization (2), image (3), verdict (6), and service (5) modules declare 31 endpoint IDs that are not aggregated into `ENDPOINTS`; they are therefore not counted as exposed API operations in this snapshot.

| Status | Coverage | Evidence |
| --- | --- | --- |
| Present (74) | Projects, deployments and lifecycle, environment variables, auto-deploy, domains and ingress protection, registry credentials, GitHub discovery, jobs and run status, notifications and delivery history, audit/activity, logs and diagnostics, resource usage, current user, and DNS verification. | [Core API](../web/src/server/api-v1.ts#L440), [expanded API](../web/src/server/api-v1-more.ts), [Orchard API additions](../web/src/server/api-v1-orchard.ts), [endpoint modules](../web/src/server/) |
| Partial (11) | Deploy-from-GitHub variants, ingress overlap, deployment metrics and resource quota, webhook-token lifecycle, activity/change history, and deployment/build cancellation. Each row records why behavior or data shape is narrower. | [Checklist reasons](../web/src/server/parity/orchard-parity.json) |
| Not applicable (79 tools) | Managed PostgreSQL, pods/containers and node pools, Greenhouse sandboxes, and Orchard’s cluster-managed template registry/instances require infrastructure outside this single-Nest-server API. | [Checklist reasons](../web/src/server/parity/orchard-parity.json) |
| Missing (53 tools) | No corresponding registered public endpoint implements the remaining Orchard operation. | [Checklist](../web/src/server/parity/orchard-parity.json) |

“Present” means an equivalent operation is implemented by the mapped endpoint; “partial” means the endpoint covers only part of it; “missing” means there is no sufficiently close endpoint; and “not applicable” means the feature depends on Orchard’s cluster or managed infrastructure. Endpoints without an Orchard mapping are listed as ours_only in the checklist.
