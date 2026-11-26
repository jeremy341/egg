# Next round: performance, security, customisation

Status (revised 2026-11-22): **mostly built.** This was written as a plan. Much of it has since shipped, so each item below now carries its status. The remaining open questions are at the end. Do not read the imperative wording as a statement of current work.

## What the code does today (checked)

- Caching (revised 2026-11-22): `api/stats` sends `public, max-age=300`; `stats-cache.ts` uses `"use cache"` with a 300 s revalidate; `api/v1/openapi.json` is cached 300 s and uses an ETag. Authenticated JSON routes send `no-store`. The public status page is now cached for 60 s and tagged (`server/status-page-cache.ts`), and the public feed, stats and status JSON use ETags (`server/etag.ts`).
- Security items from the audits (`docs/design/security-audit-auth.md`, `security-audit-exec.md`), revised 2026-11-22:
  - **Still open:** CSP keeps `'unsafe-inline'` for scripts (a per-request nonce in `proxy.ts` is not in place).
  - **Fixed:** authenticated JSON routes use the 256 KB `readJsonLimited` cap (`server/body-limit.ts`).
  - **Fixed:** deploy dedupe and the per-project job lock use unique indexes (`0013_security_prefs.sql`, `0042_job_project_lock`).
  - **Partly fixed:** first-use SSH host pinning is now confirmed by the owner, but there is no earlier key to compare with.
  - **Still open / deployment choice:** rate limits are per process; address limits need `TRUST_PROXY=1` behind a trusted proxy.
  - **Fixed:** `server/deploy/redact.ts` masks base64, URL-encoded and 2 to 3 character standalone secrets; only one-character values remain unmasked on purpose.
  - **Fixed:** the sign-in page shows a message for `error=rate_limited` (`lib/login-errors.ts`).
- Domains: `server/domains.ts` records the domain, tells the user what to enter in the Nest dashboard (Nest has no API for it), and checks DNS. Egg does not route traffic itself.

## 1. Performance and caching

1. **Cache the public status page** per project with a 60 s revalidate, tagged so a monitor state change invalidates it. **Built:** `server/status-page-cache.ts` uses `cacheLife({ stale: 60, revalidate: 60, expire: 3600 })` and `cacheTag(statusTag(key))`; the monitor can drop the tag early.
2. **Per-request dedupe** with React `cache()` for the project, server and session lookups that each dashboard page repeats. **Partly built:** `server/auth/current.ts` wraps `getCurrentUser` in `cache()`; the other lookups were not audited on 2026-11-22.
3. **Last-known status with a TTL** for the runtime check, so opening a project does not run an SSH check every time. **Built:** `server/service-status.ts` (`STATUS_TTL_MS` = 30 s; a reading under 30 s old is reused).
4. **Conditional responses** (ETag and `304`) on the status JSON and the stats JSON. **Built:** `server/etag.ts` is used by `/api/stats`, `/api/status/nest` and `/api/public/deployments`, with tests for `If-None-Match`.
5. **Pagination** replaces the 100-row load, which also cuts query cost. **Built:** deployment lists load 25 at a time with "Load older"; runtime logs load 300 lines at a time with "Load older lines" (`server/deployment-page.ts`, `components/logs-view.tsx`).
6. **Bundle check**: measure the client bundle for the dashboard and the docs; split heavy client-only components (charts, the terminal) behind dynamic imports. **Not verified in this pass; treat as open.**

## 2. Security hardening

Priority order:

1. **CSP nonce** in `proxy.ts`, removing `'unsafe-inline'` for scripts (High: reduces XSS impact). **Still open.**
2. **Global body cap** for authenticated JSON routes (High: denial of service through large bodies). **Built:** 256 KB `readJsonLimited`.
3. **Unique index** on the deploy dedupe key and the per-project job lock, in a migration (High: a race can start two builds). **Built** in migrations `0013_security_prefs.sql` and `0042_job_project_lock`.
4. **Explicit trusted-proxy setting** for client addresses. **Built** as `TRUST_PROXY` (`server/config.ts`, `server/rate-limit.ts`), off by default. Whether a proxy header is trusted is still a deployment decision; see the self-hosting guide.
5. **Secret masking** for short, base64 and URL-encoded values. **Built** in `server/deploy/redact.ts`.
6. **Host key confirmation** on first SSH connection: show the fingerprint and ask the user to confirm. **Built** (`components/connect-flow.tsx`, `server/servers.ts`); still only as good as the owner's comparison.
7. **Rate-limited message** on the sign-in page. **Built** (`lib/login-errors.ts`).
8. **Dependency audit in CI** (`pnpm audit --prod --audit-level high`). **Built** in `.github/workflows/ci.yml` (added 2026-11-15); `shadcn` has since been removed from `package.json`.

Each item gets a test, and the security page numbers are checked against the code by the existing tests.

## 3. Customisation and settings

All five items below were built after this plan was written (verified 2026-11-22):

- **Preferences table** — `user_preferences` in `web/src/server/db/schema.ts`; `lib/preferences.ts` holds the defaults and parses stored values.
- **Themes** — `components/theme-{switch,toggle,editor}.tsx` and `lib/preferences.ts`; light, dark and match-device plus the built-in palettes and a custom theme editor.
- **Username and character** — editable `displayName` and a fixed set of SVG pixel avatars (`AVATARS` in `lib/preferences.ts`, default `pixel-01` / "Egg"). No uploads.
- **Density** — comfortable (default) or compact.
- **Settings page** — the Account page groups Profile, GitHub, Container permissions, Signed-in browsers and Delete Account; preferences are in `lib/preferences.ts` with `PreferencesSync` applying them without a reload. The exact grouping above ("Appearance", "Deploys", "Notifications") was not adopted.

## 4. Domains and URLs

Egg cannot stop someone routing any domain at a Nest container. That routing happens in the Nest dashboard, and this repo has no part in it. What Egg controls is what it records and tells people to do. Options are in the questions below.

## Questions to answer before building

The domain-policy question was resolved: `server/domain-policy.ts` reserves 119 names copied from Nest plus 7 Egg adds (126 total), and `server/domains.ts` checks DNS before a domain reads "Active". The username and theme questions were resolved by the shipped preferences and settings work described above. The "Add a url" question was not re-checked in this pass.

1. **Domain policy.** What does Nest allow today: any domain a person points at their container, or only names Nest issues? Egg can match Nest, or go further:
   - (a) Match Nest exactly: Egg only records names the user owns, verified through the existing CNAME check.
   - (b) Stricter: also block reserved names (for example `nest`, `hackclub`, `egg`, `admin`) and require the DNS check to pass before the domain is shown as active.
   - (c) Keep it open and rely on the terms of use.
   My recommendation is (b). It stops the easiest impersonation of Nest or Hack Club names without blocking real custom domains.
2. **"Add a url".** Do you mean showing each app's live URL on the project card and deployment rows (the Nest container address and port), or something else?
3. **Username.** Unique handle, or a display name only? A unique handle needs a rename and a reserved-name list.
4. **Themes.** Accent palettes only, or full palettes (different surfaces too)? Accent palettes are cheaper and keep the white surface and pixel identity.

## Build order (once answered)

Historical. By 2026-11-22 steps 1 to 4 were built: the body cap and unique indexes, the preferences migration, the status-page cache and ETag work, the settings page and themes, and the display name, avatar and reserved-name policy (`server/domain-policy.ts`, 126 reserved names). The remaining work is the CSP nonce, the per-process/shared-limit question, the bundle check and any decision about a CDN in front of the app. See `docs/design/ddos-and-abuse-plan.md` for the rate-limit layers and `docs/planning/08-roadmap-status.md` for the current status of the earlier roadmap.

Implementation uses Sonnet 5.5 agents at high effort, each with the frontend skills loaded for UI work and a test and browser check before reporting.
