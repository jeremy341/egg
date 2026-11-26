# Public site direction (home page and docs)

Owner: design lead. Status: direction for review. Scope: `web/src/app/(marketing)/` (home page, docs, the shared top bar and footer). The dashboard is out of scope.

Inputs: `PRODUCT.md`, the current marketing and docs code, `web/src/app/globals.css`, `docs/design/ui-spec.md`, the deploy code in `web/src/server/deploy/`, and the reference sites listed at the end.

Process notes, stated plainly:

- The roll and the five challengers were supplied by the brief, so the impeccable `concept-seed` script was not run and no decision page was served. The brief pins the roll (build candidate 6), so it binds.
- Nothing here was checked in a browser. Every visual judgement is from code. Items marked **[visual]** need a real render.
- No surface brief or direction contract file was written, because this task allows only two files. The build section below holds the same content.

---

## 1. Mechanism, scene, rut

**Mechanism, in one sentence.** A push to the production branch is built and started as a new release folder on the student's own Nest container, and it only goes live (the `current` link points at it) once the app answers on its port. The last five releases stay on disk, so a rollback is a switch, and nothing else on the container is touched until the student turns it on.

Checked in code: `KEEP_RELEASES = 5` and `KEEP_PREVIEWS = 2` (`server/deploy/layout.ts`), release folders are UUIDs under `~/.nest-deploy/<slug>/releases/`, `current` is a link, each app is `nd-<slug>.service`, the health check waits up to `healthTimeoutSeconds: 45` by default (`server/deploy/pipeline.ts`), and a failed check puts the previous release back.

**Audience scene.** A 16-year-old has a Discord bot that runs in a `tmux` session on their Nest, or a small site they started with `npm start` over SSH. It dies when the process crashes or when they change something, and they find out at lunch when a friend says the bot is offline. They have a GitHub repo, a laptop at home, and a phone at school. They have read the #nest channel and want the bot to come back on its own after a push, without learning systemd tonight. They are deciding whether to hand an SSH key to a project made by another Hack Club member.

**Cultural home.** Hack Club: Slack, You Ship We Ship programs, hackathons, stickers, hardware kits. Nest itself is a tilde-style shared Linux box (the Nest guides say so). GitHub and its contribution graph, the terminal, Discord bot tutorials, itch.io game jams, pixel art.

**What the first surface must prove (one viewport, 1280x800 and 375x812).**

1. What it does: a push to your production branch runs on your own Nest container.
2. That it is real: the product's own nouns (commit, release, `current`, port, service) shown in a working state, labelled as sample data.
3. What it needs: one key and one repo. Sign-in is offered, never pushed first.
4. A way forward that is not sign-up: the docs.

**The rut (what this category always ships).** The Vercel-style deploy landing: a centred giant headline, two pill buttons, a framed product screenshot with crosshair corners, then alternating sections with a big headline on the left and a small paragraph on the right, each topped by a small mono label, an FAQ accordion, a closing CTA. The current home page is mostly this page (see section 8).

**Its opposite (also the rut).** The hacker terminal page: black ground, green monospace, an ASCII logo, a blinking cursor typing `$ nest deploy`.

**Literal readings, kept off the list.** A bird's nest or eggs. The pixel grid as a game world.

---

## 2. Seven visual systems the audience knows, ranked by resonance

Scoring: how surely a Nest student recognises it at a glance (1 to 5) plus how directly it can carry the mechanism (1 to 5). Ties go to the one most specific to Hack Club. Families: Unix text, screen data graphic, game interface, school paper, die-cut print, electronic display hardware, engineering print.

| # | System | Family | Score | Why it resonates and how it carries the mechanism |
| --- | --- | --- | --- | --- |
| 1 | The home directory listing on a shared box (`ls -l` on a tilde server) | Unix text | 4+5 | Nest is a tilde server and every user has typed `ls`. `current -> releases/<id>` is the mechanism itself. |
| 2 | The GitHub contribution graph | Screen data graphic | 5+4 | Every student checks theirs. A grid of squares is already their picture of "I pushed". |
| 3 | The game save-slot screen | Game interface | 5+4 | Fixed slots, the oldest overwritten, load an older save: that is five releases, pruning and rollback. |
| 4 | The quad-ruled exercise book | School paper | 5+3 | Everyone has filled one. Worked examples, a boxed answer and a crossed-out line map to steps, state and a failed deploy. |
| 5 | The laptop-lid sticker sheet | Die-cut print | 5+2 | Hack Club's badge of belonging. Carries the mechanism weakly. |
| 6 | The LED dot matrix on a maker board (micro:bit 5x5, Arduino UNO R4 12x8, hackathon matrices) | Electronic display hardware | 3+4 | Lit cells are state. The page's own pixel grid and Pixelify are already a matrix. |
| 7 | The PCB assembly drawing (Hack Club's PCB programs) | Engineering print | 2+4 | A push's route through build, check and switch is a signal path. Few readers know it. |

Three of seven are screen systems (1, 2, 3), so the list spans more than three families.

### 2.1 The seven as directions

All seven keep the brand commitments: white surface, the 30px pixel grid behind every page, Pixelify headings, the square mark. Palette roles below use tokens from `globals.css`.

**1. Directory listing.** World: each page is a long `ls -l` of `~/.nest-deploy/<project>/`, each section an entry (folder, file, link), with real sizes and modes where they exist. Palette: `--background`, `--foreground`, `--muted-foreground`, `--brand` only on the link target of `current`. Type: Geist Mono dominant, Pixelify for entry names at display size. Composition: one left column of rows. Navigation: a path crumb (`~/`, `~/docs/`) as the top bar. Controls: links styled as paths. Responsive: rows wrap, paths break anywhere. First surface: the project folder listed, with `current` switching to the new release on a push. Risk: mono everywhere is the terminal rut's cousin and breaks the "mono is for code and data" rule across a whole page; long docs in mono read badly.

**2. Contribution graph.** World: the page grid read as a calendar, columns are weeks, rows are days, lit cells are pushes that became releases. Palette: ink steps of `--foreground` (no green), `--brand` for the live one. Type: Pixelify display, Geist body. Composition: a year strip across the hero, sections dated. Navigation: top bar plus month labels. Controls: a cell shows its commit on focus or hover. Responsive: the strip scrolls inside its own frame. First surface: a sample year of pushes with the newest lit as current. Risk: invites fake activity data and reads as a GitHub imitation; a day's count is not a release, so the metaphor bends the truth.

**3. Save slots.** World: releases as save files with commit, time and branch. Palette: tokens, `--brand` on the loaded slot. Type: Pixelify slot titles, Geist metadata. Composition: a slot list in the hero; menus as navigation (Continue, Load, Options). Controls: arrow keys move between slots, Enter loads. Responsive: slots stack full width. First surface: five slots, newest selected; "Load" on an older one demonstrates rollback. Risk: makes a tool that holds a root-reach SSH key feel like a toy; menu navigation hurts wayfinding in docs.

**4. Exercise book.** World: a margin rule, margin notes that define each product term once, worked examples, a boxed answer for the live state, a struck line for a failed deploy. Palette: white, `--grid-line` as ruling, ink `--foreground`, `--brand` as the one pen mark. Type: Pixelify headings, Geist as the pencil, no handwriting faces. Composition: margin column plus main column. Navigation: a contents page as the docs index. Controls: boxed buttons. Responsive: margin notes fall inline under their paragraph. First surface: "Example: put pixel-garden online" worked through to a boxed answer. Risk: reads as homework; any teacher mark (ticks, grades, "well done") patronises.

**5. Sticker sheet.** World: a kiss-cut sheet; each capability a die-cut sticker; the backing keeps the outline of peeled ones. Palette: tokens, ink outlines, one `--brand` sticker. Type: Pixelify on stickers. Composition: stickers scattered across the grid around the headline. Navigation: top bar. Controls: stickers are links that lift on hover. Responsive: the sheet reflows to one column. First surface: a sheet of feature stickers around the headline. Risk: a card grid in costume, and Hack Club's own sticker style is Hack Club's identity, which this independent project must not borrow.

**6. LED dot matrix.** The build. Full direction in section 3.

**7. PCB assembly drawing.** World: a white fabrication drawing, outlined parts with designators, traces between them; the push route as the energised trace. Palette: ink on white, `--brand` on the live trace. Type: Geist Mono designators, Pixelify headlines. Composition: one large drawing in the hero, sections as callouts off it. Navigation: top bar plus a legend. Controls: focusing a part highlights its trace. Responsive: the drawing scrolls in its frame; a parts list replaces it on phones. First surface: the push route drawn as a circuit. Risk: few Nest users read PCBs; a dense drawing hides the offer; designators would be invented labels.

---

## 3. The build: candidate 6, "the board readout"

**Thesis.** The public site is a dot-matrix panel on a white board. The 30px hairline grid behind every page is the unlit matrix. Nest Deploy's state is drawn by lighting cells of that same grid: which release is live, which permissions are on, which scopes a token holds, what happened to a push. The page refuses the rut's framed screenshot and its label-headline-paragraph sections; it shows the product by switching cells on.

**White-surface translation (named).** An LED glows on a dark board. The owner rejected dark-heavy looks, so the panel is read as a reflective display: a lit cell is an ink-filled square, an unlit cell is the hairline cell itself (the ghost). This is how a calculator LCD or an e-paper badge shows state on a pale ground.

### 3.1 World

- **Cell.** 30px, the existing `GRID_CELL`. A lit cell is a filled square inset 3px on every side (24px), as `PixelField` already draws one at full swell (`max = cell - 6`).
- **Three cell states, never colour alone.** Ghost (hairline only), ink-lit (`--pixel-lit`), accent-lit (`--brand`). A failed cell is a 2px ink outline with an empty middle. Every readout carries text labels; colour is never the only signal.
- **One accent cell per viewport.** Accent-lit means "live now": the current release, the step in progress. Nothing else on the page uses `--brand` except the focus ring and in-text links.
- **Readout cell counts come from the code.** A readout's length is a constant the code enforces, named in its source and read from it, never typed:
  - release row: 5 cells (`KEEP_RELEASES`)
  - token scopes: 18 cells (`TOKEN_SCOPES.length`), ticked ones ink-lit
  - container permissions: terminal and file changes, ghost by default (they start off)
  - status page: 30 cells for the 30-day window (`statusWindowDays`); **verify** the status page's real granularity before drawing one cell per day
  - previews: `KEEP_PREVIEWS = 2`; **verify** what it counts before drawing it
- **Readouts sit on the page grid, not on a card.** Their cells align with the background ruling, so the background is the display.

### 3.2 First viewport (home)

Desktop, 1280 to 1440 wide, top bar 60px:

- Left, starting on a ruling line two cells below the bar: the h1 in Pixelify, two lines at most, line-height 90px (3 cells). Proposed copy: "Push to GitHub. It runs on your Nest." Alternatives: "Your Nest runs every push." / "Deploy to your Nest." (the current line).
- Under it, one sentence, 20 words at most, Geist 18px: "Every push to your production branch is built and started on your own Hack Club Nest container."
- Under that, two buttons on one line: primary "Read the quick start" (to `/docs/quickstart`), secondary "Sign in". Nothing below the buttons.
- Right, about 40% of the column: the push readout, drawn on the grid with no frame. Rows, each with a Geist label to its left: `git push origin main` with the short commit (sample `a08c6f1`); Build (a scanning cell while it runs); Port check (waits for the app to answer); Releases (five cells, the new one accent-lit, the four older ink-lit). Under it a mono caption: `current -> releases/…` and a plain line: "Sample data. The last five releases stay on your Nest."
- Phones (375): h1 at 48px on 60px lines, then the sentence, then the buttons (full width, stacked), then the readout below at the same 30px cell. The release row (5 cells, 150px) fits; labels sit above their row instead of beside it.

### 3.3 Signature interaction

The release row in the hero is a real control: a radio group named "Live release (sample)". Picking an older cell moves the accent to it, the caption updates to point `current` at that release, and one line explains: "Rolling back points current at an older release and restarts the service." Arrow keys move the choice; each option's name is its short commit and age. It changes nothing real and says so.

### 3.4 Visitor path (home sections, one idea each)

The sections follow the life of one push, then the things a careful student asks before connecting.

1. Hero: what it does (above).
2. Setup (`#start`): one key and one repo, three numbered steps (the sequence is real): Sign in, Add the key, Import the repo.
3. What a push does (`#product`): build in a sandbox off the container, wait for the port, switch `current`, keep five. The real `DeploymentsView` with sample data, captioned.
4. When a deploy fails: the real `BuildLogs` sample in the error state, the failed cell, the previous release still lit.
5. Runtimes (`#runtimes`): Node.js, Python, static, any command. A plain table on the ruling.
6. After it is live: logs, alerts to Discord or Slack, the public status page (30-cell sample row), page views (opt-in, the four privacy rules).
7. Scripts and agents: the 18-cell scope readout for the example `deploy-bot` token, the curl and MCP snippets.
8. What it can touch (`#security`): the key's reach said first, then permissions as ghost cells that start off, then the time limits (5, 10, 60 minutes) as plain sentences with their numbers.
9. Questions (`#faq`).
10. Close: one headline, the quick start button, the source link.

### 3.5 Palette, materials, type, composition

See sections 5 and 6 for values. Materials: white board, hairline ruling, ink cells, one blue cell. No shadows on the page itself; real app components keep their own product styling inside their figure. Composition: one page column whose edges land on ruling lines; a left rail on desktop for the route spine (raise line below); content blocks start on ruling lines.

### 3.6 Topology and navigation

Top bar 60px (2 cells): mark and wordmark left; section links; Docs; Stats; Source; theme button and "Sign in" right. Docs: the same bar, a left sidebar with the lit-cell marker on its rail, a right "On this page" rail, and one docs index. Full rules in `public-site-guidelines.md`.

### 3.7 Controls and states

- Buttons: square corners (one shape rule for the public site: radius 0 for frames and buttons, 3px for inline code), 45px tall (1.5 cells) at every width. Primary: ink fill, white text; hover mixes to 86% ink; active moves down 1px. Secondary: hairline border, ink text; hover fills `--ds-gray-100`. Focus: `--ds-focus-ring`. Disabled: `--subtle-foreground` text, ghost border. Loading: the existing 2x2 `PixelLoader`, label ends with "…".
- Readout cells: ghost, ink-lit, accent-lit, scanning (in progress), failed (outline). Each state has a text equivalent in the label or caption.
- Links: underline with 3px offset in `--border`, ink on hover.

### 3.8 Responsive behaviour

- The cell stays 30px at every width (it is the brand grid).
- Readouts wrap to rows of at most 10 cells (300px fits a 343px column at 375). 18 scopes become two rows of 9; 30 status cells become three rows of 10.
- The route spine is desktop only; below 1024px sections stack in one column.
- On phones only vertical alignment to the ruling is required; horizontal alignment is relaxed.

### 3.9 Cross-surface reach

Docs keep the panel quiet: Pixelify h1 and h2, the lit-cell nav marker, square bullets, and a readout only where a page explains a state with a limit (Deployments shows the 5-cell release row, Access tokens the 18-cell scope row, Security the permission cells). Login, status page and 404 already use the pixel identity and can adopt the cell states.

### 3.10 Raise lines (from the declined challengers)

- **Cephalopod raise.** The readouts are not boxes placed on the grid. They are drawn on the page's own ruling cells, in place, with no frame, so the background is the display. Each viewport holds one accent cell at most: the live one.
- **Fold raise.** One line organises the home page: the route spine. A single column of cells in the desktop left rail starts at the hero's commit and runs down through sections 3 to 6, with one ink-lit cell where each section's h2 begins, in the order a push lives (push, build, port check, live, failure, watched). It ends after section 6. It is static: no scroll-linked motion.
- **Specimen raise.** Type and display are one system. The h1 sits on whole cells (line-height 90px desktop, 60px phone), its top and baseline on ruling lines, and the Pixelify size is chosen so a font pixel divides the cell evenly. **[visual]** Measure Pixelify's pixel unit at the chosen size before locking it.
- **Catalog raise.** Every product object on the public site carries its real identifier, in Geist Mono, in the same position: a release by its short commit, a service by its unit name (`nd-pixel-garden.service`), a page by its path, a scope by its literal string, a port by its number. Releases are UUID folders, so never number them ("release 4") on a page.

### 3.11 Honest risks

- On white, a lit cell is just a black square. Without labels and a live state the readouts read as pixel art, not a display.
- It sits close to the incumbent "Lit hairlines" identity. The redesign must show up as composition and the readout grammar (no eyebrows, no split headers, no per-section reveal, no crosshair frames), or visitors will see the same page.
- Alignment is fragile. The grid is drawn from the layout wrapper's top-left and `PixelField` counts cells from x=0. Readout cells must use the same origin, or they will sit a few pixels off the ruling, which looks broken. **[visual]** at 1280, 1440 and 375.
- The one-accent rule is easy to break once status colours from real app components share a viewport. Status colours stay inside the captioned app figures.
- Candidate 6 ranked low on recognition (3 of 5). Not every Nest student has held a micro:bit; the identity leans on the pixel look they already know from games.
- The interactive rollback demo could be taken for the real thing. It must say "sample" in its name and its caption.
- The grid behind docs prose (owner commitment) costs some legibility. Mitigation in section 6.

DFII: impact 4, fit 5, feasibility 4, performance 5, consistency risk 3, so 15.

---

## 4. Challengers, fused and judged

Each was fused first (its form, the product's facts), then weighed against the build on two axes only.

**(a) Cephalopod skin as a living display.** Fused: the whole page ground is skin; a push is one blue-green signal that travels across it to the release that goes live. Audience identification: lower, cephalopods are not this audience's world. Product clarity: lower, a signal roaming under the content is harder to read than labelled rows. **Verdict: declined.** Discipline the build lacked: the surface itself is the display, not a panel placed on it. Kept: the cephalopod raise (3.10). The blue-green is not taken; the accent stays `--brand`.

**(b) A circular sheet folded along one curved crease.** Fused: a white (not cream) sheet, one charcoal arc carrying the push route, labels in Geist (not a geometer's serif), figures numbered like plates. Audience identification: lower, it reads as an art book. Product clarity: lower, a curve explains nothing about deploys that a straight route does not. **Verdict: declined.** Discipline the build lacked: one organising stroke that the whole page hangs on. Kept: the fold raise (3.10). Plate numbers are not taken; real app views get captions, not numbers.

**(c) A Wim Crouwel gridded type specimen.** Fused: the construction grid is the page grid, Pixelify set monumental on it, one diagonal rebellion. Audience identification: lower, the specimen tradition is unknown to students (the pixel letters they know, the build already has). Product clarity: lower, monumental letters do not explain the product. **Verdict: declined.** Discipline the build lacked: letterforms built on the same grid as the layout. Kept: the specimen raise (3.10). The diagonal is not taken; no product fact calls for it.

**(d) A Saville-style catalog sleeve.** Translated to white (the black sleeve is out): every artifact catalogued, a pulsar-style stack of resource lines, colour blocks for words. Audience identification: lower, the sleeve is a parent's record. Product clarity: lower, colour standing in for words fails readers and contrast rules. **Verdict: declined.** Discipline the build lacked: total cataloguing, every object named by its real identifier. Kept: the catalog raise (3.10). The pulsar plot and colour blocks are not taken.

**(e) Seven-segment display instruments.** Fused: every readout a rigid mask with ghost segments; the real constants (5 releases, 7 days, 5, 10 and 60 minutes, port 20000) set as segment digits. Audience identification: holds, clocks, calculators and Arduino kits are as familiar as an LED matrix. Product clarity: lower, digits pull the page toward numeric readouts and the product's story is mostly states, not numbers. **Verdict: competitive.** It stays a full alternate. Case line: choose it if the owner wants the security and limits sections to lead with the real numbers. Kept in the build: nothing borrowed. The build's fixed cell counts come from the code (3.1), not from this challenger.

No challenger wins.

---

## 5. Palette

Restrained: neutrals plus one accent. Every value below already exists in `web/src/app/globals.css`. Light is the default; the dark values that exist under `.dark` stay for visitors who pick dark, and the site never defaults to dark.

```css
/* Surface and ink */
--background: var(--ds-background-100);          /* hsl(0 0% 100%), the white board */
--background-subtle: var(--ds-background-200);   /* hsl(0 0% 98%), top bar */
--foreground: var(--ds-gray-1000);               /* hsl(0 0% 9%), text and ink-lit cells */
--pixel-lit: var(--foreground);                  /* ink-lit cell */
--prose: color-mix(in oklab, var(--foreground) 84%, var(--background)); /* reading text */
--muted-foreground: var(--ds-gray-900);          /* hsl(0 0% 30%), secondary text */
--subtle-foreground: hsl(0 0% 43%);              /* captions, labels; about 5.1:1 on white */
--grid-line: color-mix(in srgb, var(--foreground) 8%, transparent); /* the unlit matrix */
--border: var(--ds-gray-alpha-400);              /* #00000014, hairlines */
--code-bg: var(--ds-background-200);             /* hsl(0 0% 98%) */

/* The one accent */
--brand: var(--ds-blue-700);                     /* hsl(212 100% 48%), accent-lit cell; about 4.4:1, non-text and large text only */
--brand-text: var(--ds-blue-900);                /* hsl(211 100% 42%), accent text; about 5.3:1 */
--ring: var(--ds-focus-color);                   /* focus */
```

One neutral may be added, if the docs need it: a reading-strength ruling, `color-mix(in srgb, var(--foreground) 5%, transparent)`, used only behind docs prose. It is a grey, not a brand colour.

Status colours (`--status-ready`, `--status-building`, `--status-error`) appear only inside the real app components shown as captioned figures.

---

## 6. Type system

- **Display: Pixelify Sans**, hosted with the app (`lib/fonts.ts`, `pixel.variable`, the `font-pixel` utility), weight 500. Only for h1, h2 and the wordmark. Never below 24px, never for body, buttons, labels or data. Home h1 at most 6rem (96px) on a 90px line; h2 `clamp(2rem, 3.5vw, 3rem)` on a 60px line. Docs keep `text-docs-h1` and `text-docs-h2`.
- **Body: Geist Sans** (`next/font/google`, `--font-geist-sans`, `font-sans`). h3 and below are Geist semibold. Home body 16px. Docs prose 17px on a 30px line, so one line of text sits in one row of the ruling; at most 68ch.
- **Mono: Geist Mono** (`--font-geist-mono`, `font-mono`). Only for code, commands, paths, commits, unit names, scopes and ports. Never for labels, kickers or decoration.

---

## 7. Motion

- **One entrance.** The hero readout runs once on load: the commit cell lights, the build cell scans, the port check passes, the new release cell turns accent and the oldest goes ghost. Stepped timing (`steps()`), 1.6 seconds at most, starting within 300ms. The final state is what the server renders, so the page is complete with scripts off; the animation plays only under `prefers-reduced-motion: no-preference` and fills backwards, like the existing `hero-rise`.
- **No other entrances.** Remove the `Reveal` wrapper from every section.
- **Few hover states.** Links (underline colour), buttons (fill), the docs nav marker glide (`--dur-base`, `--ease-move`), the copy button swap. Hover uses `--dur-fast`.
- **The click ripple stays.** `PixelField` lights cells when the visitor clicks the background. It is the visitor's act, it never starts by itself, and it is off under reduced motion.
- **Reduced motion.** No entrance, no ripple, no marker glide, no smooth scroll; every state shown at once.

---

## 8. The current site, code-only critique

**[CODE-ONLY REVIEW: visual issues not assessed.]** Lenses: anti-slop, hierarchy, clarity, signature.

| Now | Change | Why |
| --- | --- | --- |
| Every section opens with `Label` (a lit square and a mono word) above the h2 | Delete the labels; the h2 carries the section | An eyebrow on every section is the template rhythm |
| Six sections use the same `head` grid (big h2 left, small lead right) | Stack the h2 and its sentence; vary the section forms | Split headers repeated are one layout family six times |
| `Reveal` wraps every section | One entrance, in the hero only | One identical entrance everywhere is not authored motion |
| Hero: centred h1 up to 11rem, two pills, no product in the first viewport | Left-aligned h1 at most 6rem, the push readout beside it | The first viewport claims instead of showing; display is past the craft floor's 6rem |
| Primary CTA "Start deploying" goes to `/projects` (sign-in) | Primary goes to the quick start; "Sign in" is secondary | PRODUCT.md: show what it does before asking for anything |
| Top bar has both "Log in" and "Dashboard", and the hero repeats sign-in intent | One "Sign in" in the bar | Duplicate intent |
| Docs sit in an opaque `bg-background` band | Let the grid run behind docs at reading strength | Owner commitment: the grid runs behind the whole public site |
| `Plus` crosshair corners "as on vercel.com" | Remove | Decorative crosshairs, and a borrowed signature |
| Mono used for labels (`stepLabel`, `Label`, `dt` in Security) | Geist for labels; mono only for code and identifiers | Mono as costume |
| Rollback copy says it "takes seconds" | Say what it does: points `current` back and waits for the port | The health check waits up to 45s by default; the speed claim is unverified |
| Security time limits as giant mono figures | Plain sentences with the numbers, or permission cells | Hero-metric template |
| Seven-row and five-row lists with a rule under every row | Group, or use the cell readouts | Rule-under-every-row spec sheet |

Passed: real app components with labelled sample data, facts tied to code by `home-facts.test.ts`, native `details` for the FAQ, skip link, 40px touch rules, no em dashes found in copy.

---

## 9. Sources read

Pages fetched with WebFetch, and the concrete patterns taken from each:

- hackclub.com: "Where teens make cool stuff."; projects shown with the maker's name, age and country and two links, "Try it out" and "View source code"; a postcard addressed "TO: you, a teenager anywhere on Earth"; "free for every teenager, forever"; informal second person.
- guides.hackclub.app/index.php/Limitations: 2 cores, 2GB memory, 16GB storage by default, more on request; no public IPv4, a reverse proxy for HTTP(S), public IPv6; no SLA; `/dev/net/tun` disabled. (nest.hackclub.app returned 404; a WebSearch found the guides and `github.com/hackclub/nest`.)
- tailwindcss.com/docs/installation/using-vite: a crumb above the h1, a one-sentence lead, numbered steps each with a title, one paragraph and one code block, code captioned by kind ("Terminal", a file name, "CSS"), an "Are you stuck?" callout at the end.
- vercel.com/docs/deployments/rollback-production-deployment: a summary and a prerequisite note at the top, a "Quick reference" block with the whole command sequence, numbered steps, the plan limit stated as a note exactly where it applies, related links at the end.
- docs.fly.io: the landing gives a two-step quick start with the real commands, then an index by feature, then by language, then "How does Fly.io work?", then where to get help.
- resend.com/docs/introduction: a one-line lead ("Resend is the email API for developers."), prerequisites as a numbered list, quick start links per language, then a short "Explore" index.
- plausible.io: the hero pairs "Start free trial" with "View live demo"; claims carried by specifics ("54 times smaller").
- linear.app: product UI at full scale in the hero; figures labelled "Fig 0.1" to "0.3"; a dated changelog as proof the product moves.
- vercel.com: "Deploy now"; a way to try without logging in (`vercel deploy --temporary`).
- raycast.com: one physical object (keyboard keys) as the motif across every section; each section is a headline, one line, then content.
- github.com/vercel-labs/web-interface-guidelines (command.md): focus, forms, typography, touch, animation and theming rules used in the guidelines file.

Fetched but not representative: railway.com served an agent briefing instead of its home page (one fact used: auto-deploy on every push to the configured branch); cal.com/docs served an API reference page; docs.stripe.com/payments/quickstart came back in German and too large to read for layout, so no Stripe pattern is claimed.

---

## 10. Not verified

- Every visual judgement (no browser render). Marked **[visual]** where it matters.
- Pixelify's pixel unit at display sizes.
- What `KEEP_PREVIEWS = 2` counts, and the status page's per-day granularity.
- How long a rollback takes in practice (the code allows a 45s health check).
- Whether the background grid and `PixelField` can share an origin with a centred page column without changing `PixelField`.
