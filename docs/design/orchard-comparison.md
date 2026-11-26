# Egg and Hack Club Orchard

Written 2026-11-13. Orchard is Hack Club's own app platform. This note records what could be confirmed about it, how it differs from Egg, and what is worth borrowing.

## What could be confirmed

- **It is live.** The dashboard is at `orchard.infra.hackclub.com` (page title "Orchard Dashboard"). The page loads three add-ons it calls grafts: Greenhouse (cloud dev sandboxes), Announcements, and The Grove.
- **It has a GitHub App.** "Hack Club Orchard" (`github.com/apps/hack-club-orchard`), created 2026-05-13, with read access to contents, write access to checks and deployments, and a subscription to push events. That is the shape of push-to-deploy.
- **Hack Club projects are moving to it.** [hackclub/lapse#316](https://github.com/hackclub/lapse/pull/316) moves Lapse from Coolify to Orchard. It shows two things about how Orchard builds: apps are built from a Dockerfile, and runtime environment variables are not available during the image build, so database migrations and `NEXT_PUBLIC_*` values had to be handled differently.

## What could not be confirmed

- **The official source repository.** Nothing named Orchard is public under `github.com/hackclub` or under the GitHub App's owner. If Orchard is open source, the link is needed to compare code.
- **A lookalike exists.** `github.com/evanxdsouza/wackcluborchard` ("Wack Club Orchard") describes a self-hosted Kubernetes platform with the same feature names as the live dashboard (Greenhouse, The Grove). It is probably a renamed copy of Orchard's source, but it is not from Hack Club and that link is a guess. The feature list below is from that README, so treat it as likely, not certain.

## How they differ

| | Egg | Orchard (per the lookalike README) |
| --- | --- | --- |
| Where apps run | The person's own Nest container, over SSH | A Kubernetes cluster run by the platform |
| How an app runs | A systemd service, releases in `~/.egg/<project>` | A container built from a Dockerfile or an image |
| Build | On the container, or in GitHub Actions | On the cluster with BuildKit |
| Who it is for | Any Nest user, for their own container | Organisations and projects with members and roles |
| Database | None managed; the app brings its own | Managed PostgreSQL with backups and a query console |
| Scheduled work | systemd timers per project (5 jobs, cron form) | Cron schedules and multi-step pipelines |
| Access | One owner per project, API tokens, MCP | Owner/admin/member/viewer, passkeys, SSO |
| Written in | TypeScript, Next.js, SQLite | Go standard library, a hand-rolled TypeScript dashboard |

They do not compete. Orchard hosts apps on Hack Club's infrastructure for teams that have access to it. Egg gives a Nest user a deploy flow on the machine they already have, without a cluster, and nothing leaves their container.

## Worth borrowing

1. **A simulated runtime for demos.** Orchard's server fakes pods, builds and logs when there is no cluster, and seeds a demo project. Egg's demo data is a seed script with a fake server key, so anything that touches the container fails in a demo. A fake container driver (the test suite already has a mock SSH server) would make the whole dashboard usable without a Nest account.
2. **Crash reports.** Orchard captures what a container printed before it died. Egg shows the journal, but a crashed service's last lines are not kept with the deployment that crashed.
3. **Warnings in plain words.** Orchard rewrites Kubernetes warnings for people. Egg could do the same for the common systemd and Node failures (port in use, out of memory, missing module).
4. **Templates.** One-click starters for common apps. Egg lists this in its roadmap already.
5. **Build-time and run-time variables kept apart.** The Lapse pull request shows the confusion this causes. Egg should say on the environment variables card which values exist at build time and which only at run time.

## Not worth copying

- Kubernetes, BuildKit and managed PostgreSQL. They need a cluster, which is the thing Egg exists to avoid.
- Organisations, SSO and SCIM. Nest containers are personal. Project sharing with a few roles is the most Egg needs.
