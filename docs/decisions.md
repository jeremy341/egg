# Decision log

Newest decisions are at the bottom. Each entry says what was decided and why. When a decision changes, add a new entry rather than rewriting the old one.

1. **Website, not a CLI.** The first version is a website where users sign in, connect a Nest server and GitHub, and deploy and manage projects. The CLI-first plan from the original idea was dropped.
2. **Version 1 is the full scope in `planning/02-decided-feature-scope.md`.** It includes traffic analytics, previews, custom domain automation, multiple runtimes, team access, and advanced monitoring. The user chose to keep everything in Version 1 after we suggested a pilot-first cut.
3. **Sign-in with Hack Club Auth.** Hack Club Auth identifies the user only. It doesn't grant access to their Nest container. Hackatime OAuth is a later option for hours tracking.
4. **Connect Nest with a dedicated SSH key.** The site generates an ed25519 key. The user pastes the public key into the Nest dashboard's SSH Keys page and clicks Test connection. The site then runs `ssh <nest-username>@hackclub.app`.
5. **The stored key grants root.** The bastion logs in to the container as root, so the site's key is effectively root on the user's container. The user accepted this. Users can revoke the key in the Nest dashboard at any time. The Decided Feature Scope documents this.
6. **Manual key paste for now.** No public API exists for SSH keys, and we decided not to reverse-engineer the dashboard's requests. The paste stays manual until Nest offers an API.
7. **Build outside Nest.** Nest containers are small (2 vCPUs, 2 GB RAM). Builds should run on our own workers, and only the finished artifact goes to Nest. This is planned, not yet tested. **Superseded:** builds now run on the user's own container under a memory and CPU cap, or in GitHub Actions, and never on Egg's host (see `docs/design/build-on-container-plan.md` and `build-in-github-actions-plan.md`).
8. **Docker considered, not decided.** A Docker image pins the runtime and dependencies. Rootless Docker inside a Nest container is unverified, so Docker versus plain release directories is still open.
9. **Repo created and made public.** The repo is `jeremy341/egg`. The folder name has a space, but the repo name uses a hyphen because GitHub doesn't allow spaces.

## Superseded or inconsistent text in the planning docs

- `planning/01-original-idea.md` still describes an agent running in each user's container in its architecture section. Decision 4 replaces it with the SSH key flow. Update that section when the architecture is finalized.
- The planning documents keep their original `[[wiki links]]`. They don't resolve on GitHub, so treat them as plain references to the notes they name.

## UI stack (added 2026-11-04)

10. **Next.js, TypeScript, Tailwind v4, shadcn/ui, Geist.** There is no official Vercel component library, so the dashboard is built from the public pieces closest to it: shadcn/ui components (copied into the repo and restyled), Geist Sans and Mono, and Geist-style color tokens. Icons come from Phosphor. See `web/README.md` for the design rules.
11. **First UI pass uses sample data only.** Every screen reads from `web/src/lib/mock.ts`. Sign-in, the SSH test, and deploy actions are placeholders until the backend exists.
12. **Second UI pass follows Vercel's current dashboard.** The layout is a left sidebar plus top bar (not top tabs), and the colors, shadows, spacing and motion come from the custom properties Vercel's dashboard serves, so values can be diffed. Dark-mode hue scales were not readable and are estimates. Captures used for this are kept locally and not committed (`reference/` is gitignored).

## Backend (added 2026-11-04)

13. **One Next.js process plus a queue.** API routes, pages and the deployment worker can run in a single process (`RUN_WORKER=1`), with the worker also runnable on its own. State lives in SQLite through libsql (prebuilt binaries; `better-sqlite3` needs a compiler on Windows).
14. **Release folders and a symlink, not Docker, on Nest.** A deploy unpacks to `~/.egg/<project>/releases/<id>`, switches `current`, restarts a systemd unit and health-checks it; failure reverts the symlink. This answers the earlier "Docker or release folders" question with release folders, because rootless Docker inside a Nest container is still unverified.
15. **Builds happen off Nest, in Docker.** The worker clones and builds in a resource-limited container and ships a tarball. Production dependencies are installed on Nest, so native modules match the server.
16. **Uploads use an exec channel, not SFTP.** The bastion's SFTP support is unknown; `cat` over exec works if exec works.
17. **Previews are real services on their own ports.** Newest two kept per project. Mapping a preview to a domain stays manual.
18. **Domains are recorded, not configured.** There is no Nest API for mapping a domain to a port, so Egg tells the user what to enter and checks DNS.
19. **Hack Club Auth for identity only, GitHub App for repositories.** The GitHub App's user authorization is used once, to learn which installations belong to a user, and the user token is not stored.

## Brand and homepage (added 2026-11-04)

20. **Ember orange is the one accent.** Chosen because it is warm, reads as hearth and nest, sits close to Hack Club's red without being error red, and stays legible as a fill on both black and white. Black and white remain the base. A pixel mark (a bowl with one ember pixel) and a pixel face used only for the wordmark and step numerals carry the personality.
21. **The homepage lives at `/`, the dashboard at `/projects`.** The homepage is public; everything else still needs a session.
22. **The homepage is drenched in ember, with authored pixel art.** The first version (dark, one neon accent, tiles, numbered steps, an accordion) read as generated, so it was replaced. The hero is a pixel-art nest with three eggs you can hatch; the page leads with what a manual deploy looks like, shows features as plain rows, and states the SSH key's root access up front. Display face is Bricolage Grotesque; Geist stays the face of the app.
23. **Back to Vercel's look.** The ember-orange accent and the pixel-art homepage were dropped: they still read as generated. The accent is Vercel's blue again, buttons are black, type is Geist only, and the homepage follows vercel.com's current one (light display type, a centred mark, short side notes, product UI as the visuals). The homepage shows the real `DeploymentsView` and `BuildLogs` components with sample data instead of drawings. Decisions 20 to 22 are superseded.

## Automation and homepage motion (added 2026-11-04)

24. **Deploy hooks store a hash, not the token.** The URL is shown once, like a personal access token. That means the settings page can only say that a hook exists; making a new one is how you see a URL again. The trade is worth it: nothing in the database can start a deployment.
25. **Notifications go to Discord and Slack only.** The server posts to a user-supplied URL, so accepting any URL would make it an SSRF tool. A fixed host and path allowlist, no redirects and a short timeout avoid that without needing DNS checks. Other destinations can come later through the deploy hook's mirror image if there is demand.
26. **One authored motion on the homepage.** The headline is scanned in column by column in steps, a wave starts behind it, then the text and buttons rise. It runs only when the visitor allows motion. Elsewhere the page stays still except for the click wave.

## Scheduled jobs (added 2026-11-13)

27. **Jobs are systemd timers on the container, not a scheduler in Egg.** A job is a timer plus a oneshot service next to the app's own service, so it keeps running when Egg is down or being upgraded, and it shows up in `journalctl` like everything else. Egg stores only what the person asked for (name, schedule, command); the last run and its result are read from the container each time, so they cannot go stale.
28. **The schedule is the cron form people know, narrowed on purpose.** Five fields, in UTC. Names (`MON`), `?` and `L` are not accepted, and setting both day-of-month and day-of-week is refused because cron reads it as "either" and systemd as "both". A run closer than every 5 minutes is refused so a job cannot starve the app on a 2 GB machine. Every field is expanded into explicit numbers before it reaches the unit file, so nothing typed by the user is ever written to systemd as text.
29. **A job gives way to the app, and never catches up.** `Nice=10` and `OOMScoreAdjust=500` put it behind the app and first in line for the out-of-memory killer. It stops after 30 minutes. `Persistent=false` means a machine that was off skips the missed runs instead of starting a backlog. A job that is still running when its next time comes is not started a second time (that is how a oneshot service behaves).
30. **Jobs carry the same ownership marker as the app's service.** Both unit files start with `# egg:managed project=<slug> job=<id>`. A unit with the same name that Egg did not write is left alone, and removing a project or cleaning up an account removes its jobs' units, timers first.

## Security and availability fixes (added 2026-11-13)

31. **Turning on a second way to sign in needs a fresh sign-in.** Enabling password sign-in (and getting its recovery key) now requires a Hack Club sign-in within the last 5 minutes, the same rule as the permission switches. Without it, someone holding an old or stolen session could add a password the owner does not know and keep access after that session is revoked. Changing or turning off the password is unchanged, because both already need the current password or the recovery key.
32. **The GitHub webhook refuses what it can before it reads anything.** A request with no `Content-Length`, a declared size over the cap, or a missing or malformed signature header is refused without reading the body. The cap is 5 MiB, not GitHub's 25 MB maximum, because Egg acts on five small events. At most 4 bodies are read at once (503 with `Retry-After` past that), a body must keep arriving (15 s idle limit) and finish within 30 s. The signature still covers the whole body, so a valid delivery is buffered once; the gain is that invalid ones cost almost nothing and the worst case is about 20 MiB in memory. Caddy holds the same size cap as a backstop. Stock Caddy cannot rate-limit, so that part is the operator's firewall or load balancer.
33. **The security-report inbox has limits that survive a restart.** On top of the in-memory limiter, the database is the counter: 12 new reports an hour and 60 a day for everyone together, and one network may use a tenth of the space that is left per day. From 80% full, anonymous traffic gets 2 an hour, so a flood cannot take the last slots, and the administrator sees a warning on the inbox page and once a day in their activity. The per-network count stores a keyed digest of the address for one day, in its own row and never with the report; the privacy page says so.
34. **A build upload cannot hang.** Receiving a build from GitHub Actions stops after 60 s without a byte or 15 minutes in total, and deletes the partial file. At most 4 uploads are received at once, and 2 per project.
35. **Next.js 16.4.5.** It fixes published advisories that affected 16.4.4. Nothing in Egg was shown to be exploitable through them; staying on a version with known advisories was the problem.
36. **A project is reserved before anything on the container is removed.** Deleting a project with "Also stop the service and delete releases" used to remove the app from the container first and check for a running deployment afterwards, so a delete during a build destroyed the app and then failed. Now one transaction checks for running work and writes a cleanup row; every path that starts work already refuses while such a row exists, so nothing can be queued between the check and the removal. The row's lease is renewed while the removal runs. If the removal fails the row is deleted and the project stays usable. The records are deleted only if the reservation is still ours at the end. The REST API and the MCP tool go through the same function.
37. **"Start with automatic deploys off" replaces "Adopt an existing checkout".** The old name promised a takeover that does not exist: Egg does not import, stop or migrate a copy that already runs. The option only starts the project with automatic deploys off until the first manual deploy is confirmed. Importing a running app is a separate, larger feature (see `docs/planning/08-roadmap-status.md`).
