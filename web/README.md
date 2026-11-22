# Egg web app

A Vercel-style dashboard and the backend behind it: Hack Club or local sign-in, SSH to a deploy target, builds on the target or in GitHub Actions, releases, rollbacks, provider integrations, webhooks and the in-app docs. See [docs/selfhost/README.md](../docs/selfhost/README.md) for running your own copy and [docs/backend-setup.md](../docs/backend-setup.md) for setup, security notes and the API.

## Run it

```bash
pnpm install
pnpm run setup  # creates .env.local (random APP_SECRET and LOCAL_MODE_SECRET)
pnpm dev       # http://localhost:3000, deployment worker included
```

Other commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm worker` (standalone worker), `pnpm fake-nest` (a stand-in Nest container for local trials), `pnpm audit:prod` (production dependency audit). CI runs the typecheck, lint, tests and `pnpm audit:prod` on Linux and macOS; a high-severity advisory fails the Linux job and is only reported on macOS.

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router, Cache Components) | Same framework Vercel's own dashboard style comes from, with server components by default. |
| Language | TypeScript | Strict mode, typed props for every component. |
| Styling | Tailwind CSS v4 | Design tokens live as CSS variables in `src/app/globals.css`. |
| Components | shadcn/ui (Base UI primitives) | The components are copied into `src/components/ui`, so they can be restyled freely. |
| Font | Geist Sans and Geist Mono via `next/font/google` | The same typeface Vercel uses. Self-hosted at build time, SIL Open Font License. |
| Icons | Phosphor (`@phosphor-icons/react`) | One icon family. Server components import from `/dist/ssr`. |
| Theming | `next-themes` plus colour themes | Light, dark and system, with no flash on load; built-in presets and per-account custom themes. |

Vercel's Geist docs name a component package (`@vercel/geistcn`), but it is not on the public npm registry, and the dashboard's code is not published either. The colors, spacing, shadows and motion timing in `src/app/globals.css` (the `--ds-*` variables) are values read from the custom properties Vercel serves to every browser; dark-mode hue scales that could not be read are estimates and marked `est.`. Everything else is built from public tools, not copied from Vercel code.

## Design rules

- **Layout:** a 256px left sidebar and a 56px top bar on desktop (switching to project links inside a project). Below 1024px the sidebar becomes a floating Find / menu pill and a full-screen menu. Import (`/new`) has no sidebar, as on Vercel.
- **Colour themes:** every theme sets the same CSS variables, including `--brand` for focus, links and the current-production pill. `PRESETS` in `src/lib/preferences.ts` lists the built-in light and dark themes; each person picks one of each on Settings (or "Match my device"), and can build a custom theme from eight colours in the theme editor. Primary buttons follow the theme, and status colours are used only for real state.
- **Pixel grid:** `components/pixel-field.tsx`, a quiet monochrome grid used on the homepage hero, login and 404. Hover lights pixels, click drops a ring of light. It sleeps when idle or offscreen and has a static mode for reduced motion.
- **Shape lock:** controls 6px, cards and menus 8px, badges and avatars fully round.
- **Borders are box-shadows:** `shadow-border`, `shadow-border-small`, `shadow-menu` and `shadow-modal` utilities wrap the `--ds-shadow-*` tokens. Rows in a list share one hairline.
- **Type:** 14px / 20px UI text at weight 500 with -0.02em tracking, 13px secondary text, Geist Mono for ids, ports, and logs.
- **Motion:** menus and the Find palette use Vercel's `cubic-bezier(.175, .885, .32, 1.1)` at .2 to .3s, skeletons use a sweep, and the "Building" dot pulses. All motion respects `prefers-reduced-motion`.
- **Copy:** no em-dashes anywhere in the UI.
- **Accessibility:** every input has a visible label, errors sit under the field, and status is never shown by color alone.

## Routes

| Route | Screen |
| --- | --- |
| `/` | Public homepage, modelled on vercel.com's, with the real dashboard components shown with sample data and a feed of opted-in public deployments |
| `/stats` | Public usage figures |
| `/nest-status` | Nest status: Egg's own reachability check plus Hack Club's official status at status.hackclub.app |
| `/security` | Security policy and the public vulnerability report form |
| `/privacy` | Privacy policy |
| `/status/[key]` | A project's published public status page |
| `/login` | Sign-in: Hack Club, local password, email password or development sign-in, depending on settings |
| `/projects` | Dashboard home: projects, alerts and recent deployments |
| `/new` | Import a repository or public URL, choose the runtime and hosting mode, then deploy it for real |
| `/deployments` | All deployments with a status filter |
| `/activity` | An audit log of changes to projects, domains and servers |
| `/domains` | Add and verify domains (follows Nest's domain and port rules) |
| `/logs` | Runtime log viewer with a level filter |
| `/connect` | The SSH key flow for connecting a server |
| `/container` | Per-server container settings: build memory and CPU, and the Terminal, File changes and Removing leftovers switches |
| `/resources` | CPU, memory and disk use of your servers |
| `/settings` | Appearance (themes, density, motion) and account defaults |
| `/account` | Profile, GitHub connections, sign-in methods and recovery keys |
| `/developer` | Access tokens, API and MCP examples |
| `/admin` | Instance administration and maintenance (only the configured administrator) |
| `/security/reports` | The administrator's private vulnerability inbox |
| `/docs` | In-app guides |
| `/projects/[slug]` | Project overview: production deployment, service card, domains, container usage and active branches |
| `/projects/[slug]/deployments` | Deployments for one project |
| `/projects/[slug]/deployments/[id]` | Deployment detail with build logs and runtime logs |
| `/projects/[slug]/settings` | Project settings: deploys, environment variables, build location, notifications, status page and cleanup |
| `/projects/[slug]/analytics` | Traffic analytics, enabled switch by switch |
| `/projects/[slug]/terminal` | A live shell on the deploy target (permission switch, owner only) |
| `/projects/[slug]/files` | Browse and download files in a project's folder on the deploy target (permission switch, owner only) |

## Backend layout

| Path | What it holds |
| --- | --- |
| `src/server/db` | Drizzle schema and SQLite (libsql) connection; migrations in `drizzle/` |
| `src/server/auth` | Hack Club OAuth, local and development sign-in, hashed sessions, current user |
| `src/server/ssh` | ed25519 keys, SSH session wrapper, target probe and capability probe |
| `src/server/deploy` | Build runner, container probe, Docker target contracts, release scripts, pipeline (deploy, revert, rollback, prune) |
| `src/server/jobs.ts` | Durable queue and worker loop |
| `src/server/github` | GitHub App auth, repository listing, webhook intake and replay protection |
| `src/server/providers` | Git provider adapters (GitHub, GitLab, Forgejo, Codeberg and public HTTPS URLs) |
| `src/server/analytics*` | Switch-based analytics collection, retention and reports |
| `src/server/projects.ts`, `servers.ts`, `domains.ts` | Services used by the API and the pages |
| `src/server/queries.ts` | Read models for the dashboard |
| `src/app/api` | REST routes, including the public `/api/v1` API and `/api/mcp` |
| `worker/`, `scripts/` | Standalone worker, setup, CLI, fake Nest and the GitHub App helper |

## Monitoring

- **Service card.** On a project's overview: whether the production service is running or crashed, how long it has been up, its memory, how many times systemd restarted it, and one real request to the health path with its response time. Read over SSH when the page opens, every 30 seconds while the tab is visible, and on demand. The card itself is a live reading with a 30-second cache and keeps no series, but Egg does store deployment history and logs, analytics page views (up to 90 days), and 30 days of daily incidents for a published status page.

## Automation

- **Deploy hooks.** A secret URL per project that starts a deployment on POST, for CI and scripts. Set up under a project's Settings.
- **Notifications.** A Discord or Slack incoming webhook message when a deployment finishes, for every deployment or failures only.
- **Outbound webhooks.** Project webhooks send deployment events with a signed payload; each delivery's status, attempts and short error code are kept for 30 days.
- **GitHub builds.** A project can build in GitHub Actions and upload a finished release; the four build credentials are shown once when created.
- **Scheduled jobs.** Cron-style jobs can deploy or restart a project, at most one run every 5 minutes and at most five jobs per project.

## Still open

- Project screenshots on the overview. It shows live deployment details instead.
- Domain mapping inside Nest is manual, because Nest has no API for it. Egg records the intent, shows exact steps and checks DNS.
- The built-in Nest status page reads Hack Club's official status, which says nothing about a server you own.
- Without Hack Club an instance has exactly one account: there is no sign-up or invitation path that works for an account that cannot sign in.
- Native runtime profiles and the capability-gated Docker modes have not been verified end to end on a real Nest container or on arbitrary Linux hosts; see [docs/design/self-host-gaps.md](../docs/design/self-host-gaps.md).
