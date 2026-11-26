# Egg and Hack Club Orchard

Updated 2026-11-25. Orchard is Hack Club’s app platform; Egg deploys apps to a user’s existing Nest server. The [feature comparison](../feature-comparison.md) and [217-tool parity checklist](../../web/src/server/parity/orchard-parity.json) use the current registry assembled in [`api-v1.ts`](../../web/src/server/api-v1.ts#L471), which drives REST, OpenAPI, and MCP.

## Product boundary

Orchard provides a cluster-managed platform for projects and teams. Egg provides a deployment and operations API for one owner’s projects on their own Nest server. Features built around cluster resources—managed PostgreSQL and its replicas, pods, node pools, sandboxes, templates, Terraform, and Tailscale—are outside Egg’s target. These are marked not applicable where represented in the Orchard tool manifest, with a reason on each row.

## Current API parity

| Status | Tools | Count |
| --- | --- | ---: |
| Present | Projects, service port and internal-domain configuration, deployments and lifecycle, GitHub repository and branch configuration, project and shared environment variables, named shared environments, GitHub discovery, domains, diagnostics/logs/rollout, scheduled jobs, notifications, resource usage, and DNS validation | 121 |
| Partial | Branch deploy, domains/ingress, service restart, resource history/quota, hook rotation, activity, deployment cancellation | 10 |
| Not applicable | Cluster-only database, pod/container, node-pool, sandbox and template features | 82 |
| Missing | No matching or nearby endpoint in the current registry | 4 |

The status totals are counted from the manifest, with exact baselines enforced by [`orchard-parity.test.ts`](../../web/src/server/parity/orchard-parity.test.ts). The [feature comparison](../feature-comparison.md) lists the mapping groups and definitions.

## What may be worth borrowing

- **A simulated runtime for demos.** A mock Nest driver could make container-dependent flows usable without an account.
- **Crash reports.** Keep the last service output with the deployment that failed.
- **Plain-language warnings.** Explain common systemd and Node failures in terms users can act on.
- **Build-time and run-time variable clarity.** Label when environment values become available.

These ideas fit Egg’s single-server model. Cluster provisioning, managed PostgreSQL, organization-wide infrastructure controls, Terraform, and Tailscale integration do not.
