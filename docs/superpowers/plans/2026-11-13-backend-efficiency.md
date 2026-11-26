# Backend efficiency and operations implementation plan

**Goal:** Implement the backend improvements authorized in the performance review, without changing product UI or unrelated onboarding/marketing work.

**Architecture:** Preserve the existing Nest/SSH and SQLite design. Reduce redundant work, bound streams and caches, record deployment stages, and expose operational features through authenticated backend APIs. Never weaken ownership, isolation, health checks, checksum verification, or rollback.

**Spec:** The user's request to build all backend items from the immediately preceding performance review.

## Constraints and rulings

- Work on the existing local branch and preserve the initial dirty files. Terra 6.1, high reasoning, implements delegated work.
- No frontend components/pages. Backend APIs may be added. No remote deployment, server migration, real credential change, or destructive live operation.
- No dependency/runtime caches shared across owners or trust contexts. Prefer package-manager download caches to mutable node_modules reuse; retain clean-install fallback and bounded disk usage.
- Measure local synthetic behavior and operation counts; do not claim real Nest speedups without real measurements.
- Only the root agent edits the shared migration journal/schema; delegates request exact new schema needs.
- Regression tests must exercise failure, authorization, concurrency, pagination and resource bounds.

## Work packages

- [x] Data reads: bounded latest deployment query, grouped domain lookup, complete analytics aggregates, fewer public-stats scans, deterministic performance fixtures.
- [x] Streams: drain full finished-log backlogs, pull/backpressure, wall-clock and idle bounds, session revocation checks, streaming SSH output with bounded line/tail memory.
- [x] Builds: incremental archive hashing, nonblocking clone-size guard, bounded scoped download caches, deployment-stage timings and diagnosis API.
- [x] Monitoring/maintenance: batched eligibility and service probes, bounded concurrency, shared maintenance leases, log byte/retention budgets, diagnostic baseline metrics.
- [x] GitHub reconciliation: detect missed production commits with explicit authorized recovery, immutable commit selection, duplicate suppression.
- [x] Project roles: expiring invitations, viewer/developer/owner checks applied consistently to dashboard backend, API/MCP and operations; retain owner-only server/root/account actions. **Superseded 2026-11-22:** project collaboration was removed; every project is single-owner and a forward migration drops the member/invitation tables.
- [x] Existing-app import: read-only discovery and expiring verified plan, explicit cutover confirmation, ownership and persistent-data protection, health check and rollback; no automatic live execution during development.
- [x] Operator recovery: admin-only inspection and confirmed remote-stop verification before clearing stale guards; audit every action.
- [x] Verification: focused tests per package, independent review, full suite, typecheck, changed backend lint, diff/scope audit.

## Review focus

1. Revoked credentials must never inherit server-root authority; project access is owner-only.
2. Slow clients, giant logs, large repos and cache corruption stay bounded.
3. Duplicate/reordered events and concurrent jobs cannot corrupt or activate unintended releases.
4. Adoption/recovery must fail closed if remote state or ownership cannot be verified.
5. Maintenance locks and telemetry must survive restarts without collecting secrets or blocking deployment recovery.

## Execution ledger

Initial baseline: d3fd449 on local/egg-2026-11-13. Existing dirty work includes onboarding schema/migration/API and marketing redesign; preserve it.

Final verification: 223 test files / 3,634 tests passed on the integrated tree; typecheck and changed-backend lint passed. Real Nest cutovers and production speedups were not measured. Terra 6.1 high subagents implemented the main work packages; final integration continued after their quota was exhausted. Existing marketing and onboarding edits remain preserved and uncommitted.
