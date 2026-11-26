# Plan: docs and security sync, easy local runs, Linux and macOS, Apple-style UI

Status: plan only. Nothing here is built. Each item lists the model and reasoning effort to use when it is built.

## Current state (checked)

- Self-hosting guide: `docs/selfhost/README.md` and `customising.md`. It covers Docker for builds (default), `BUILD_RUNNER=local` without Docker, and fake-nest for trying everything on one machine. fake-nest "runs commands on Linux (WSL on Windows)".
- Setup: `pnpm setup` writes `.env.local` with a fresh `APP_SECRET` (`web/scripts/setup.mjs`). Then `pnpm dev` (port 3100 by `APP_URL`), `pnpm start` for production.
- Local sign-in: `LOCAL_MODE=1` with a loopback-only route (`api/auth/local`). Refuses a non-localhost `APP_URL` unless `LOCAL_MODE_ALLOW_REMOTE` is set.
- Database: one SQLite file (`DATABASE_URL=file:./data/egg.db`).
- The test setup (`web/src/server/test/global-setup.ts`) keeps one WSL session warm. This is Windows-specific and needs checking before the suite can run on Linux or macOS.
- Docs: the docs pages in `web/src/app/(app)/docs/_content/guide-a.tsx` and `guide-b.tsx`. The selfhost page links to the markdown guide. Security numbers are checked by `security-facts.test.ts`.

## 1. Sync the docs and the security page with the code

Work:
- Re-check every number, default and limit in both guides and in `docs/selfhost/*.md` against the code. Most of this is already pinned by tests (`home-facts.test.ts`, `security-facts.test.ts`, the docs tests); add tests for what is not pinned yet (analytics switches and defaults, domain policy, deployment page size of 25, log page size, body cap of 256 KB, `TRUST_PROXY`, host key confirmation, the migration list).
- Add the new features to the docs: settings page (profile, appearance, defaults), analytics expansion (referrers, speed and errors, custom events, live view, retention with its local-storage note), domain policy (reserved names, Nest name rule, DNS states), deployment and log paging.
- Security page: add the items that are now built (body cap, host key confirmation, masking of encoded secrets, dependency audit, `TRUST_PROXY`), keep "not fixed" honest (the CSP nonce is still open, with the reason). Refresh the audit documents in `docs/design/security-audit-*.md` so each item says fixed, partly fixed or open, with the file.
- Retire or mark the out-of-date `docs/design/homepage-spec.md`.

Model and effort: **Sonnet 5.5, high.** The work needs care to match the code exactly and to keep the docs in the left-aligned style. Split by area if it gets big: docs pages (one agent), security page and audits (one agent). Load `project-frontend` for the page work and `project-code-quality` for the security wording.

## 2. Easier local runs

Goal: one person on their own computer can start Egg, sign in, and keep their data without a server.

Work:
- **One command to start.** A `pnpm egg start` (or a shell script per OS) that runs setup if needed, checks the requirements, starts the app and opens the browser. The CLI already exists (`web/scripts/egg-cli.mjs`); extend it rather than adding another tool.
- **A `doctor` command.** Checks Node version, Docker (or the `BUILD_RUNNER=local` fallback), port 3100 free, `.env.local` present and `APP_SECRET` set, data folder writable, and prints one fix per failure.
- **Start on login (optional).** A background service per OS: launchd (macOS), a systemd user unit (Linux), a scheduled task or a small service wrapper (Windows). Each is an opt-in command, never automatic.
- **"Saving even if the server is off."** This needs a decision (see questions). The facts: the data already lives in one SQLite file, so it survives restarts. What stops when the server is off is the dashboard and the deploys to Nest. Two options:
  - (a) Keep all data on disk and make the app restart quickly on login. Simple and robust. My recommendation.
  - (b) Also keep unsent form drafts in the browser (IndexedDB) and send them when the server is back. Only useful for typed text, not for deploys.

Model and effort: **Sonnet 5.5, high.** It touches setup, the database path, service files and the CLI, and each OS needs care. The `doctor` checks are small enough that Haiku could write them once the design is agreed.

## 3. Running on your own server

Goal: someone with a Linux server (not a Nest container) can run Egg with one command and upgrade it safely.

Work:
- A `compose.yaml` with the app, the worker and a reverse proxy that gets HTTPS certificates automatically. Document the `.env` values the app needs.
- An upgrade path: pull, rebuild, run migrations on start (already how the app works), keep a backup of `data/`.
- A backup command that copies the SQLite file safely (SQLite's online backup, not a plain copy while it is being written).
- A non-Docker option with a systemd unit, for people who do not want Docker.
- Security notes in the guide: `TRUST_PROXY=1` behind the reverse proxy, the body and rate limits, the CSP status.

Model and effort: **Sonnet 5.5, high.** Compose files and proxy setup are where mistakes are easy to miss, so the agent needs to test on a real Linux box or a container. A reviewer pass at medium effort is enough after it is written.

## 4. Linux and macOS support

Current Windows-specific parts to fix:
- The test global setup keeps a WSL session warm. Guard it so Linux and macOS run the suite with the local session.
- fake-nest runs on Linux and needs WSL on Windows. On macOS, document running it in Docker or a Linux VM.
- Path and home folder handling (`~/.egg`, the SSH key location) and file permissions for the key (must be `0600` on Linux and macOS).
- Line endings: the repo has mixed CRLF and LF from Windows editing. Add a `.gitattributes` rule (`* text=auto eol=lf`) and normalise once, in its own commit.

Support matrix to aim for:
- Linux (Ubuntu 24.04 or newer): full support, including Docker builds.
- macOS (Apple silicon and Intel): full support with Docker Desktop, or `BUILD_RUNNER=local`.
- Windows: keep the current WSL path.

CI: a matrix job on `ubuntu-latest` and `macos-latest` that runs typecheck, lint and the test suite. There is no `.github` folder yet, so this also creates the first workflow.

Model and effort: **Sonnet 5.5, high** for the platform code and the CI matrix. **Haiku 5.5** for the line-ending normalisation and the `.gitattributes` change, which is mechanical once decided.

## 5. Apple-style UI refinement

References found (secondhand from search; check the pages directly before building):
- Apple sidebar guidance: no more than two levels of hierarchy in a sidebar, and disclosure controls for lots of content. [developer.apple.com sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars.md) (updated 8 June 2026).
- Apple layout guidance: alignment and indentation to show hierarchy, and text that adapts to size changes. [developer.apple.com layout](https://developer.apple.com/design/human-interface-guidelines/layout.md).
- Apple overview: the HIG hub, with typography and toolbars as separate pages. [developer.apple.com HIG](https://developer.apple.com/design/human-interface-guidelines.md). The Typography and Toolbars pages were not fetched; fetch them directly when building.
- Open-source options (licence and component list not yet checked):
  - `@smart-coder-labs/apple-design-system`, Apple-inspired, Framer Motion, Radix UI, Tailwind: [pkgstats page](https://www.pkgstats.com/pkg:@smart-coder-labs/apple-design-system).
  - Cladd, a React 19 and Tailwind v4 kit for settings panels and dashboards: [listing](https://awesome.ecosyste.ms/projects/github.com%2Fcladd-ui%2Fcladd).
  - Untitled UI React, Tailwind v4.2 components with sidebar navigation: [components](https://untitledui.com/react/components).

Rules for the UI work (from the owner's brief):
- Keep the white surface, the pixel grid on the public site, and the pixel headings. Apple's patterns are for structure and spacing, not for replacing Egg's look.
- Borrow the patterns, do not copy components wholesale, and check each licence before copying any code.
- Targets: the sidebar keeps two levels (groups, then pages); settings use inset grouped lists; primary actions sit at the top trailing edge; Dynamic Type-style sizing respects the browser's text size.

Work:
- Audit the current pages (dashboard, project, deployments, settings, docs) against the Apple guidance above.
- Write a short design note with the changes per page, then build them.

Model and effort: **Sonnet 5.5, high** for the audit and build, with `project-frontend`, `web-design-guidelines` and `critique` loaded. The critique step is read-only, so it can run first.

## Model and effort for this planning round

- **This round (planning and research):** Sonnet 5.5 at **medium** effort. It is research plus judgement, not deep design. Haiku would miss security and accuracy points; Opus is not needed (and is reserved for the homepage).
- **Haiku 5.5** for mechanical tasks: line endings, renaming, copying a settled list into docs, and the `doctor` checks once designed.
- **Sonnet 5.5 at high** for anything that touches setup, deploy, security, migrations, platform code, or UI design.

## Apple UX research (UX-level only: radius, hover, motion, targets)

Source pages (Apple HIG, Markdown, fetched and read):
- Motion: https://developer.apple.com/design/human-interface-guidelines/motion
- Buttons: https://developer.apple.com/design/human-interface-guidelines/buttons
- Layout: https://developer.apple.com/design/human-interface-guidelines/layout
- Sidebars: https://developer.apple.com/design/human-interface-guidelines/sidebars
- Materials: https://developer.apple.com/design/human-interface-guidelines/materials

What the guidance says that applies to Egg:
- **Motion is feedback, not decoration.** Animate only to show status or feedback. Keep feedback brief and precise.
- **Do not animate frequent interactions.** Standard controls already have system animations, so custom motion on every click wastes attention.
- **Let people cancel motion.** Never make people wait for an animation before they can act, especially if they see it often.
- **Make motion optional.** Do not rely on motion as the only way to show important information. Reduced motion must still show the same information.
- **Touch targets of at least 44 by 44 points.** Apple's hit-region rule for buttons. Egg's compact density must keep this on touch screens.
- **Space between buttons.** Keep button centres far enough apart that a hover or focus state does not cover the next button.
- **Button shape.** Prefer capsule buttons on their own, rounded-rectangle buttons in a vertical stack, and capsules in a horizontal row. More rounded shapes are easier to look at steadily.
- **Tooltips on hover** for icon-only buttons (macOS), after a short pause.
- **Sidebar.** At most two levels of hierarchy, and disclosure controls for long lists (already the plan).
- **Materials.** Apple uses translucent materials for layered surfaces. Egg keeps its white surface, so use the material idea only for sheets and popovers, if at all.

What the pages I read do NOT say:
- They do not give a rule for concentric corner radii (inner radius equals outer radius minus padding). I searched the five pages and found nothing. If we want that rule, it needs a different source; I have not checked it.
- They do not give hover durations or easing numbers. Apple states that system easing cannot be changed. Egg's own durations (`--dur-fast` and similar) stay as they are.

UX changes to plan (for the UI build, not done yet):
1. Hover and focus states: brief, no motion on frequent controls (rows, tabs, nav items). Keep colour and background changes.
2. Every touch target at least 44 by 44 points on coarse pointers (`pointer-coarse`), even in compact density.
3. Reduced motion: the same information without motion, checked on each animated feature (the homepage wipe, the 404 wipe, the live view, the speed bars).
4. Button shapes: one shape rule for the app (capsule for single actions, rounded rectangle in stacks) and check every button group against it.
5. Tooltips on icon-only buttons, with the label also in the accessible name.

## Questions to answer before building

1. **"Saving even if the server is off":** do you mean (a) data stays on disk and the app starts again quickly, which I recommend, or (b) unsent form text is kept in the browser and sent later? Or both?
2. **Which platform first:** Linux server (own server), or the local-run experience on Windows and macOS?
3. **Own-server setup:** Docker Compose only, or Docker Compose plus a systemd option?
4. **Apple look:** keep Egg's pixel headings and white surface, with only layout and spacing changed from Apple's guidance? Or move toward a more Apple-like surface as well?
