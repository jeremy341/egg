# Plan: make Egg fast and light

Status: plan only. Nothing here is built. Numbers marked "measured" come from earlier checks in this repo; numbers marked "to measure" need a baseline first.

## Where the time and resources go

1. **Deploys (the slowest thing a user waits for).** Install and build run on the user's container, which is small (2 vCPU, 2 GB). Every deploy currently runs a full `npm ci` or `pnpm install` from scratch. That is most of the deploy time and most of the memory peak. To measure: time each step of one deploy (clone, upload, install, build, unpack, switch, health check).
2. **Dashboard page weight.** The projects page ships about 1.0 MB of JavaScript before compression (measured). The largest chunk is about 235 KB. Browsers on slow connections pay for all of it.
3. **Database queries per page.** Dashboard pages run several queries each for the account, the servers and the projects. Some are repeated (`React cache()` helps within one request, not across pages). To measure: count queries per page load.
4. **SSH sessions.** Each status check, deploy and terminal opens an SSH connection. Connections are not reused across operations. To measure: connections per deploy and per five-minute monitor pass.
5. **Background work.** The monitor checks every server every five minutes (`MONITOR_INTERVAL_MS`). Each check runs a short command per project. For many projects this grows linearly.
6. **Static and public pages.** Public pages are already cacheable (status page cache, stats ETag). The homepage and docs are mostly static but are rendered through the app's full stack.

## Plan, in order of payoff

### 1. Keep dependencies between deploys (biggest win for users)
- Store a cache folder on the container keyed by the lockfile hash (for example `~/.egg/cache/<project>/<lockfile-sha256>/node_modules`).
- When the lockfile is unchanged, copy or hard-link the cached `node_modules` into the new release instead of installing. Fall back to a full install when the hash differs.
- Keep the cache to the two newest lockfile hashes per project, and clear it when the project is deleted (the cleanup code already has the ownership marker rules).
- Expected effect: most deploys skip the install step. To measure first: install time on a typical project across five deploys.
- Risk: a corrupted cache. Mitigation: verify the lockfile hash and run a quick `node -e "require(...)"`-style smoke check before use, or fall back to a clean install on any error.

### 2. Use the package manager's own cache
- Point the container's npm and pnpm stores at a folder under `~/.egg/cache` so a changed lockfile still reuses downloaded packages.
- Pass `--prefer-offline` for npm and the pnpm store setting on the container.
- Expected effect: faster installs when a lockfile changes but most packages do not. Lower network use.

### 3. Shrink the source we upload
- Exclude what the build never needs before packing: `.git`, `node_modules`, `.next`, `dist` and test caches. Check the archive size on a few real repositories first.
- Keep the 500 MB limit; a smaller archive also means a faster upload on the container's link.

### 4. Make the dashboard's first load smaller
- Measure the bundle with the Next.js analyzer for the projects page, the project page and the settings page.
- Move rarely used panels (the terminal, the analytics charts, the developer docs panel, the security inbox) behind dynamic imports, so they load only when opened. The terminal is already split; check the rest.
- Remove any client component that only renders static text (make it a server component).
- Target: the projects page's first-load JavaScript under 500 KB before compression. To measure first.

### 5. Fewer database queries per page
- Measure the query count per page with a simple counter in development (wrap the Drizzle driver, log the count per request).
- Combine repeated lookups (account, servers, projects) into one query per page where they are read together, and keep `React cache()` for the rest.
- Check the indexes on the columns the dashboard filters by (the 22 existing indexes cover the main paths; confirm with `EXPLAIN QUERY PLAN` for the three busiest pages).

### 6. Reuse SSH connections
- Keep one SSH session per server for a short idle time (for example 60 seconds) and share it across the status check, the deploy steps and the logs view.
- The existing `lastKnownServiceStatus` already shares one session between concurrent callers; extend the same idea to deploy steps, with a clear close when the job ends or a server is disconnected.
- Expected effect: fewer handshakes per deploy and per monitor pass.

### 7. Monitor scaling
- Stagger the monitor checks across the five minutes instead of running every server at once.
- Skip servers whose last check is recent enough when a deploy has just run.
- Keep the failure rule (two failed checks before an alert) unchanged.

### 8. Public pages
- Keep the status page cache (60 seconds). Add `Cache-Control` headers for the docs and the homepage static assets, and check that the images and fonts are served with long cache lifetimes.

## What not to do
- Do not cache anything that shows a user's private data outside their session.
- Do not skip the health check or the rollback to make deploys faster.
- Do not share caches between different users' projects. The cache key always includes the project.

## How to measure (before changing anything)
1. Time one full deploy on a real container, step by step, and save the log.
2. Record the bundle sizes for the three main pages (`next build` output).
3. Count the queries on the projects, project and settings pages.
4. Count SSH connections during one deploy and one monitor pass.

With those four numbers the plan can be ranked by real gain. Right now, the deploy install cache (item 1) is most likely the largest improvement for users, and the bundle work (item 4) is the largest for first visits.

## Models and effort
- Measurements and the query counter: Sonnet 5.5, medium.
- Dependency cache and package manager cache (items 1 and 2): Sonnet 5.5, high. It touches the deploy path and needs care with cleanup and corruption.
- Upload size (item 3): Haiku 5.5 for the exclude list once measured.
- Bundle split and server components (item 4): Sonnet 5.5, high, with `project-frontend`.
- Query combining and SSH reuse (items 5 and 6): Sonnet 5.5, high.
- Monitor scaling and public caching (items 7 and 8): Sonnet 5.5, medium.
