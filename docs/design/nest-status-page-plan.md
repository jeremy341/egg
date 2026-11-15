# Plan: a public Nest and Egg status page

Status (2026-11-13): built. The page is `/nest-status` (`web/src/app/(marketing)/nest-status`) and the probes are stored by migration `0027_status_probes`. The text below is the original plan.

## What we found

- **The official Nest status page is `https://status.hackclub.app`** ("Nest Status: The uptime page for Nest by Hack Club"). Its status is written into the page HTML: an overall summary (for example "Partial System Outage", with a class for the colour) and the list of monitored services by tag: dashboard, nest-website, nest-guides, nephthys, rev-proxy-test, roundcube. When checked on 9 November 2026 it read "Partial System Outage".
- Its JSON API requires an authorisation header, so Egg does not use it. Egg reads the summary from the public page.
- `https://nest.hackclub.com` (HTTP 200) and `https://hackclub.app` (HTTP 200) are also reachable, and Egg's own probes check them.
- `https://status.hackclub.com` is a different, Uptime Kuma page. It is not about Nest.

## Reading the official status

- A worker job reads `https://status.hackclub.app` at most once a minute (with a 10 s timeout and a clear user agent), extracts the overall summary and colour class, and stores them. If the page layout changes and the summary cannot be read, the page says "Official status unavailable" and links to the page, rather than guessing.
- The official summary is shown with its own label and link, and is never merged into Egg's own result.

## What the page says

A public page at `/nest-status` (not `/status`, which is already the per-project status page):

1. **Overall line:** "Nest and Egg are working", "Nest is slow or partly down", or "Nest appears down from Egg's checks", based on the last few checks.
2. **Nest website:** HTTP status and response time for `nest.hackclub.com`, measured every minute.
3. **Nest sign-in and app host:** the same for `hackclub.app`.
4. **Egg:** the web app and database, measured from inside Egg (a query that must answer).
5. **History:** the last 30 days as a strip, one day per cell, with the same up, partial and down rules the project status page uses.
6. **Response times:** median for the last 24 hours and the last 30 days.
7. **Links:** the official Hack Club status page, and Nest's own site.

## Honest labelling (required)

The page says, in plain words:
- "These checks run from Egg's server. They show whether Egg can reach Nest, not whether every Nest container is running."
- "This is not an official Hack Club status page. For the official status, see status.hackclub.com."
- The time of the last check, and the place it ran from.

Nothing on the page may suggest Egg speaks for Hack Club.

## How it works

- **Probes:** a worker job every minute (not the five-minute monitor) makes three HTTP requests with a 10 s timeout and a plain user agent such as `Egg-status-check`. It also runs one database query for Egg itself.
- **Storage:** a new table `status_probes` (target, checked at, ok, status code, latency in ms). Keep 90 days. Prune in the same job.
- **Rules:** a probe fails if it times out, returns a 5xx, or does not answer. Two failures in a row mark the target down (the same two-check rule the project alerts use). A reply slower than 2 s marks it slow.
- **Public read:** `GET /api/status/nest` returns the summary and daily strips, cached for 60 seconds with an ETag. The page reads that endpoint, so it stays fast and has no database load per visitor.
- **No personal data:** the probes do not send any user information, and the public page never shows a project or a user.

## Privacy and abuse

- The page is public and read-only.
- Probe frequency is fixed by the server, so visitors cannot trigger probes.
- Nothing is stored about visitors.

## Checks before it goes live

- Probe logic: a timeout, a 5xx, a slow reply and two failures in a row each produce the right state (unit tests).
- Pruning removes rows older than 90 days.
- The page renders with no data, with partial data and with a down period (tests and screenshots at 1280 and 375 px).
- The honest-labelling text is present (a test that pins it, like the other copy tests).

## Models

- Probe job, table and API: Sonnet 5.5, high (a background job and a public endpoint).
- Page design: Sonnet 5.5, high, with `project-frontend`. It reuses the status strip from the project status page.
- Copy review: Haiku 5.5 once the text is fixed.

## Decisions I made (say if you want them different)

1. The page is `/nest-status`, separate from the per-project `/status/<key>`.
2. Probes run every minute, which is cheap for three requests.
3. The page links to the official Hack Club status page and does not claim to be it.
4. Two failed checks in a row mark a target down, the same rule as the project alerts.
