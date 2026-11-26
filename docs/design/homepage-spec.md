# Egg homepage spec

Kept: the 30px pixel grid (PixelField) behind the page, the white surface, Pixelify on headings. Egg connects to a Nest container; no copy says it is part of Nest. No docs links. The primary action is Sign in, to `/login`.

## 1. Direction

- **Five-second proof:** push to GitHub and the app is live on your own Nest container, checked before it replaces the old one.
- **Visual idea:** the real push-to-live log is the hero (Resend, Vercel docs terminals). Every log line is wording from `pipeline.ts` and `build.ts`.
- **Not AI-made:** left-aligned, no card grids, stat row or eyebrows. Mono only for logs and paths. Every sample says "Sample". One accent cell per viewport. Limits and failures are shown.
- **Form changes each section:** log, rail, failing log, table, strip, tabs, rows, details, steps.

## 2. Sections (all in `web/src/components/home/`)

Format: job. Proves. Form. Research idea. **Headline.** Body. File, export.

1. **Hero** (part 3). Say what Egg does. Proves push to live. Text beside log. Resend. `hero.tsx` `Hero`.
2. **Push steps** (`#product`). Explain a deploy. Proves sandbox build, SSH upload, `current` switch, health wait. Horizontal rail of five stops. Dev-tools push timeline. **What happens after you push.** Egg builds your repository in a sandbox, uploads it to your container over SSH, points `current` at the new release, then waits up to 45 seconds for your app to answer. `push-steps.tsx` `PushSteps`.
3. **Failed deploy** (`#rollback`). Show safety. Proves automatic revert, five releases kept. Full-width failing log, five release cells below, failed one outlined. Dev-tools failed deploy. **A failed deploy puts the old one back.** If the new release does not answer, Egg switches back to the previous one. The last five releases stay on your container, so you can roll back yourself. Database changes are not reversed. `failed-deploy.tsx` `FailedDeploy`.
4. **Runtimes** (`#runtimes`). Answer "will my app run". Proves Node.js, Python, static, custom, others refused. Table, filled header. Vercel environments table. **Node.js, Python and static sites.** Egg picks the install step from your lockfile or requirements file. A custom command covers your own binary. Go, Ruby and Rust are detected and shown as not supported yet. `runtimes-table.tsx` `RuntimesTable`.
5. **After it is live** (`#track`). Show what is watched. Proves uptime checks, alerts, status page. Large 30-day strip left, paragraph list right (logs, opt-in page views kept 90 days). Raycast paragraph list. **Know when your app stops answering.** By default Egg checks every five minutes and alerts Discord or Slack after two failed checks in a row. A project can publish a status page with a 30-day outage strip. `after-live.tsx` `AfterLive`.
6. **Scopes** (`#agents`). Show automation. Proves scoped tokens, REST API, MCP. Scope cells left, tabs (curl, MCP) right. Resend tabs. **Give a script only the scopes it needs.** Tokens hold some of 20 scopes. A deploy bot needs four. AI agents get the same calls over MCP. A token with terminal or file write scope expires within seven days. `token-scopes.tsx` `TokenScopes`.
7. **Switches** (`#security`). Earn trust. Proves three switches off by default, fresh sign-in, key reach. A note, then term and text rows. Vercel Note, dev-tools "what it touches". **Terminal and file changes start switched off.** Egg uses an SSH key that works like your own login. Terminal, file changes and removing leftovers are all off for a new container. Turning on the first two needs a Hack Club sign-in within five minutes. `container-switches.tsx` `ContainerSwitches`.
8. **Questions** (`#faq`). Clear doubts. Proves independence, footprint, exit. Native `details`, 760px. **Questions before you connect.** Answers in part 6. `faq.tsx` `Faq`.
9. **Setup and close** (`#start`). Say what it needs, then ask. Proves three steps, independence. Numbered steps (a real sequence), one Sign in button. Vercel "Ship anything". **Three steps to your first push.** Create a key, import a repository, push. Egg is an independent project, not an official Hack Club product, and it never changes anything it did not create. `setup-steps.tsx` `SetupSteps`.

## 3. Hero

- **Headline (Pixelify):** Push to deploy on your Nest
- **Subline:** Egg connects to your Nest container. Every push to your production branch builds, starts and checks your app.
- **Buttons:** Sign in (primary, filled, `/login`). See how it works (secondary, `#product`).
- **Chips (plain text, no pills):** Node.js, Python and static sites. Last five releases kept. Failed deploys switch back. Independent, not an official Hack Club product.
- **Visual:** `push-log.tsx`, `PushLog`. Square frame on a surface, header "Terminal", caption "Sample". Server-rendered finished; with motion allowed, lines step in once (the page's one entrance). It shows:
  `$ git push origin main  e41b7d2`
  `Deploying recipe-api (production) to sam-r@hackclub.app`
  `Cloning https://github.com/sam-r/recipe-api (branch main)`
  `Building: npm ci && npm run build`
  `Connecting to your Nest container`
  `Waiting for the app to answer on port 3000`
  `Live on port 3000. Map your domain to this port in the Nest dashboard.`
  Below it, the five-cell release radio group from `push-readout.tsx` (legend "Live release (sample)") and `current -> releases/e41b7d2`. Names, hash and repository are sample data. Port 3000 is the form default. No other numbers.

## 4. Top bar and footer

**Top bar** (60px, sticky, hairline after scroll): square mark, Egg in Pixelify. Links: How it works (`/#product`), Runtimes (`/#runtimes`), Security (`/#security`), Questions (`/#faq`), Stats (`/stats`). Right: theme button, Sign in (outline, `/login`). Under 768px the links sit behind a 40px Menu button. Skip link to `#top`.

**Footer:** mark, Egg, and "Egg is an independent project by a Hack Club member. It is not an official Hack Club product, and it connects to your Nest container rather than being part of Nest." Columns: Page (How it works, Runtimes, Security, Questions, Setup), Project (Stats, GitHub in a new tab), Account (Sign in). Theme switch last.

## 5. Layout rules

- **Width:** column at most 1380px, 12 columns, gutters 16px (24px from 640px). Blocks start on grid lines from 640px.
- **Hero:** text columns 1 to 5, log 6 to 12, from 1024px.
- **Heading start column:** 2: 1. 3: 5. 4: 1. 5: 5. 6: 1. 7: 5. 8: 1. 9: 5.
- **Gap above, desktop (phones halve it):** 2: 90px. 3: 30px, a pair with 2. 4: 150. 5: 120. 6: 180. 7: 90. 8: 150. 9: 120.
- **Surfaces:** only logs, tabs, table and the strip. No section background.
- **Mobile order:** headline, subline, buttons, chips, log, then sections 2 to 9, one column. Logs and tables scroll in their own frame. Works at 375px.
- **Type:** Pixelify headings. Geist body 17/30. Geist Mono for logs, paths, scopes.

## 6. Copy

**Headings:** the hero headline and the headline of each section above, verbatim.

**Buttons:** Sign in (hero, top bar, setup, footer). See how it works. Menu. Copy (code frames).

**Step stops:** Clone: shallow, your branch only. Build: in a sandbox, 2 GB memory limit. Upload: over SSH. Switch: `current` points at the new release. Check: up to 45 seconds.

**Runtimes (Runtime, Installs, Starts):** Node.js, `npm ci`, pnpm or yarn by lockfile, `npm start`. Python, `pip install -r requirements.txt` in a venv, `python3 app.py`. Static site, your build, served from the output folder. Custom command, yours, yours.

**Setup:** Create a key: enter your Nest username, paste the public key on the SSH Keys page of the Nest dashboard, press Test connection. Import a repository: pick it, press Deploy. Push: your production branch deploys; other branches become previews from port 20000.

**FAQ:** Is Egg part of Nest? No, it is an independent add-on that reaches your container over SSH. What does it change? A folder per project under `~/.egg`, one `egg-` service, a `current` link; anything without its marker is left alone. Does a preview get an address? Its own port, from 20000; map a domain in the Nest dashboard. Can I leave? Disconnecting removes your projects from Egg and leaves your apps running. Are variables safe? Encrypted and write-only. Private repository? Install the GitHub App.

**Scopes tabs:** curl: `curl -H "Authorization: Bearer egg_..." <site>/api/v1/me`. MCP: `list_projects`, `deploy_branch`, `get_logs`, `get_server_usage`.

**Switch rows:** Terminal: a root shell, closes after 10 minutes idle or 60 in all. File changes: edit files in `shared/` only. Removing leftovers: deletes only what carries the Egg marker.

## 7. Numbers to pin

Already in `home-facts.ts`: releases, port 20000, sign-in, terminal, 90 and 30 days, 7 days, scope counts. Add with tests: health wait 45 s, check every 5 min, 2 failed checks, build memory 2 GB.
