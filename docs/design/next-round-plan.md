# Next round: performance, security, customisation

Status: plan only. Nothing here is built yet. Open questions are at the end and need an answer before the build step.

## What the code does today (checked)

- Caching: `api/stats` sends `public, max-age=300`; `stats-cache.ts` uses `"use cache"` with a 300 s revalidate; `api/v1/openapi.json` is cached 300 s. Authenticated JSON routes send `no-store`. Nothing caches per-project status or the public status page.
- Open security items from the audits (`docs/design/security-audit-auth.md`, `security-audit-exec.md`):
  - CSP keeps `'unsafe-inline'` for scripts (needs a per-request nonce in `proxy.ts`).
  - Authenticated JSON routes (`projects`, `env`, `domains`, `account`) read the body with no cap of their own.
  - Deploy dedupe and the per-project job lock are check-then-act. Two workers could race; a unique index closes it.
  - First-use SSH host pinning cannot see a man in the middle on the first connection.
  - Rate limits are per process and trust `X-Forwarded-For` without an explicit proxy setting.
  - Secrets shorter than 4 characters, or base64 or URL-encoded, are not masked in logs.
  - The sign-in page has no message for `error=rate_limited`.
- Domains: `server/domains.ts` records the domain, tells the user what to enter in the Nest dashboard (Nest has no API for it), and checks DNS. Egg does not route traffic itself.

## 1. Performance and caching

1. **Cache the public status page** per project with a 60 s revalidate, tagged so a monitor state change invalidates it. Public pages should not hit the database on every view.
2. **Per-request dedupe** with React `cache()` for the project, server and session lookups that each dashboard page repeats.
3. **Last-known status with a TTL** for the runtime check, so opening a project does not run an SSH check every time. The monitor job already runs every 5 minutes; the page reads its last result.
4. **Conditional responses** (ETag and `304`) on the status JSON and the stats JSON.
5. **Pagination** (in progress) replaces the 100-row load, which also cuts query cost.
6. **Bundle check**: measure the client bundle for the dashboard and the docs; split heavy client-only components (charts, the terminal) behind dynamic imports.

## 2. Security hardening

Priority order:

1. **CSP nonce** in `proxy.ts`, removing `'unsafe-inline'` for scripts (High: reduces XSS impact).
2. **Global body cap** for authenticated JSON routes (High: denial of service through large bodies).
3. **Unique index** on the deploy dedupe key and the per-project job lock, in a migration (High: a race can start two builds).
4. **Explicit trusted-proxy setting** for client addresses. Without it the rate limits trust a header anyone can send (Medium).
5. **Secret masking** for short, base64 and URL-encoded values (Medium: secrets can leak into logs).
6. **Host key confirmation** on first SSH connection: show the fingerprint and ask the user to confirm (Medium).
7. **Rate-limited message** on the sign-in page (Low, UX).
8. **Dependency audit in CI** (`npm audit --omit=dev`, failing on high). The deps audit exists; this makes it repeat.

Each item gets a test, and the security page numbers are checked against the code by the existing tests.

## 3. Customisation and settings

- **Preferences table** (one row per user, migration): theme, accent, density, reduced-motion override, default deploy branch, display name, character.
- **Themes**: light, dark, and system already exist (`ThemeSwitch`). Add a small set of accent palettes built from the existing `--ds-*` tokens, so contrast stays checked. The choice is set on `<html>` from a cookie before first paint, so there is no flash.
- **Username and character**: an editable display name (not unique, not used in URLs) and a character picked from a fixed set of pixel avatars in SVG. No uploads, which avoids image moderation and storage costs.
- **Density**: comfortable (default) or compact, for the project and deployment lists.
- **Settings page**: grouped as Profile, Appearance, Deploys, Notifications. Changes save on the server and apply without a reload.

## 4. Domains and URLs

Egg cannot stop someone routing any domain at a Nest container. That routing happens in the Nest dashboard, and this repo has no part in it. What Egg controls is what it records and tells people to do. Options are in the questions below.

## Questions to answer before building

1. **Domain policy.** What does Nest allow today: any domain a person points at their container, or only names Nest issues? Egg can match Nest, or go further:
   - (a) Match Nest exactly: Egg only records names the user owns, verified through the existing CNAME check.
   - (b) Stricter: also block reserved names (for example `nest`, `hackclub`, `egg`, `admin`) and require the DNS check to pass before the domain is shown as active.
   - (c) Keep it open and rely on the terms of use.
   My recommendation is (b). It stops the easiest impersonation of Nest or Hack Club names without blocking real custom domains.
2. **"Add a url".** Do you mean showing each app's live URL on the project card and deployment rows (the Nest container address and port), or something else?
3. **Username.** Unique handle, or a display name only? A unique handle needs a rename and a reserved-name list.
4. **Themes.** Accent palettes only, or full palettes (different surfaces too)? Accent palettes are cheaper and keep the white surface and pixel identity.

## Build order (once answered)

1. Security items 1 to 3 and the preferences migration (one migration file, reviewed).
2. Caching items 1 to 3.
3. Settings page and themes.
4. Username, character and domain policy.
5. Remaining security items and the bundle check.

Implementation uses Sonnet 5.5 agents at high effort, each with the frontend skills loaded for UI work and a test and browser check before reporting.
