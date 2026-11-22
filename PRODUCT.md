# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Hack Club Nest members, mostly students, who want to put a web app or bot online on their own Nest container and keep it running. They are comfortable with a terminal at a basic level but do not want to run a server by hand. They are deciding whether Nest Deploy is worth connecting, so the public pages must show what it can do before asking for anything.

Confirmed: the primary reader is a Nest student deciding whether to deploy with it.

## Product Purpose

Nest Deploy is a self-hosted deploy dashboard for Hack Club Nest containers. A person connects their Nest container once, links a GitHub repository, and every push to the production branch builds and runs the app on the container. Other branches become previews on their own ports. The dashboard shows builds, logs, resource use, domains, alerts and status.

Success for a visitor: they understand what Nest Deploy does, see the features it has, and know what it needs from them before they sign in.

## Positioning

An add-on for Hack Club Nest. It connects to a Nest container a person already owns and deploys their apps to it on every push. It is an independent project by a Hack Club member, not an official Hack Club product, and it never presents itself as part of Nest. The product name is Egg. It is an add-on that connects to a Nest container, so the copy says "Egg connects to your Nest", never "Egg is part of Nest".

## Primary Actions

Confirmed: the homepage should show what Nest Deploy can do. Sign-up is required to use it, but it is not the first thing a visitor should be asked for.

Inferred (labelled): the primary button on the homepage leads to the feature overview and the docs. Sign-in is a secondary action.

## Capabilities

Confirmed from the codebase and the existing docs:

- Deploy on push to the production branch, and previews for other branches on their own ports.
- Build output (streamed and searchable, but no download) and runtime logs with level filters, a time range and a download.
- Rollback to a previous release, and redeploy, cancel and remove old previews in bulk.
- Domains with DNS and app checks, and environment variables (values are write-only).
- Runtimes: Node.js, Bun, Python, Go, Rust, Ruby, PHP, Java, Static site and Custom command (`web/src/components/hosting-options.tsx`). Workloads are Web or worker. Deployment mode is native (systemd) by default; Dockerfile and Docker Compose modes are offered only when the container's capability probe enables them and are unverified on a real container.
- Alerts for down, memory, CPU and disk, and deploy results, sent to Discord or Slack.
- A public status page per project, and page-view analytics that is opt-in.
- Access tokens with scopes, and an API and MCP endpoint for scripts and AI agents.
- Container permissions: the terminal and file changes are off until a person turns them on with a recent Hack Club sign-in.
- Adoption checks for a container that already runs apps, so a first deploy does not clash with them, plus an import API that can move an existing app onto Egg after a health check and an explicit confirmation.
- Signed outbound webhooks with a one-time secret, delivery history and retry status, sent through an address guard that blocks private and redirected destinations (`web/src/components/webhooks-card.tsx`, `web/src/server/webhooks.ts`).
- A private security-report inbox for senders and an administrator-only reader, with anonymous reporting and database-backed rate limits (`web/src/components/security-report-{form,inbox}.tsx`).
- Project teams: invitations by email with a one-time link, and Viewer, Developer and Owner roles (`web/src/components/project-team.tsx`, `web/src/lib/team.ts`).
- Scheduled jobs on the container as systemd timers, with run now, output, pause and resume.

## Constraints

- Nest containers have fixed limits (2 vCPU, 2 GB memory and 16 GB disk by default, per the existing FAQ).
- Nest is a free service run by Hack Club; this project is not part of it.
- Claims about speed (for example, rollbacks in seconds) must be checked against the code before they appear on a page.

## Voice

Plain and direct, written for a student. Short sentences. No hype words. Say what a thing does, then what it needs. Use the product's own terms (container, release, preview, token) and define them once.

## Accessibility

Keyboard operable, visible focus, readable contrast in light and dark, reduced motion respected, and layouts that work at 375px wide.

## Evidence

- The existing docs in web/src/app/(marketing)/docs and the FAQ on the homepage.
- The code that enforces each limit (for example, the release count, the preview port range, the token limits, the permission defaults).

## Assumptions (Inferred, Labelled)

- The docs should cover every feature with a worked example, not only the core ones. This is inferred from the owner asking for far more detail than the current docs have.
- The homepage's main job is to show capabilities. Sign-up comes after the visitor understands the product.
- Hero and background: the owner asked for a full redesign and kept the grid and the white surface. The hero may change in layout, but must keep the pixel identity.

## Brand Commitments

Confirmed by the owner:

- The white surface and the pixel grid in the background stay. The grid runs behind the whole public site.
- The pixel identity stays: the Pixelify display headings and the square mark.
- The public site is for Nest students first. It must show what Nest Deploy can do before any sign-up. Sign-up comes later.
- Everything on the public home page and docs must be checked against the code. No invented numbers or capabilities.
- The public site must not look or sound AI-made: no generic card grids, gradient glows, filler headings, or stock marketing phrases.

- The pixel display font (Pixelify) stays on headings across the public site, not only in the hero.
- The product is an add-on for Nest, named Egg. The public copy says it connects to a Nest container, and does not sound like part of Nest. The earlier note that the name was pending was stale.

- The product is named Egg. The GitHub repository is renamed to egg (old links redirect). Renaming code identifiers that are already on people's containers (the nd- systemd unit prefix, the ~/.nest-deploy folder, NEST_DEPLOY env names, and the ownership markers) needs a migration first, so those stay until a migration is written.
