# Research: developer-tool and deploy-platform homepages

Purpose: inform the Egg homepage redesign (students, first visit, must grasp the product fast).

## Method and limits

WebFetch returned agent-facing markdown, not rendered pages. Section order and copy are from those fetches. Type, colour and motion notes are marked (recalled) and need a browser check.

- Railway returned an agents doc, not the marketing page.
- HCB returned the sign-in page.
- Cloudflare Pages returned a stub.

## Per site

**Railway.** Fetched: only a deploy doc whose core is one command, `railway up -y`, with the output described in words (project, dashboard link, URL). Recalled: dark canvas, a node-graph of services behind the hero. Take: the deploy is one line and one result. Avoid: a purple-on-dark hero, a canvas that needs a minute to decode.

**Fly.io.** Fetched order: hero, compute, sandboxes, storage, frameworks, data, agents, scale (stats table), customers, enterprise, testimonials, get started (two terminal snippets), link index. First screen names nouns (Machines, Sprites) but not the outcome. Take: the closing section shows the real commands (`fly launch`), and the code block is the demo. Avoid: repeated "X without Y" headings, unsourced stats (18+ regions, 99.9%), anonymous job-title testimonials.

**Render.** Fetched: announcement bar, mega-menu nav, one-line hero, link lists, status footer. Take: a live "All Systems Operational" footer link reads as honesty. Avoid: a launch banner instead of the core job, generic "Learn more" CTAs, identical mega-menu cards.

**Cloudflare Pages.** Fetched: "Build & deploy frontend sites", one sentence, three links. It never says git-push, never shows a repo connecting. Lesson: a category label is not an explanation.

**Supabase.** Fetched: "Build in a weekend. Scale to millions." then a plain-language "use it as just a Postgres database", six products, key differentiators, a "What do you want to do?" goal-to-link table. Take: the goal-to-answer table routes a newcomer by intent; "just Postgres" removes lock-in fear. Avoid: the six-bullet product list and a slogan that fits any tool.

**Hack Club.** Fetched order: skip link, collage hero with stickers, "Where teens make cool stuff." plus Join!, a sticker-mailer card ("TO: you, a teenager anywhere on Earth"), project showcase with maker name, age and country, events, recaps, join pitch, donors and open finances, membership cards, closing "Ready?". Voice: second person, "Imagine a world where you made this", "no catch, no cost". Take: peer proof (screenshot, name, age, source link), eligibility stated early, one repeated verb. Avoid: copying the sticker art; rhyme with it, do not wear it.

**HCB.** Sign-in card, a plain "What's HCB?" link, a "Last built" footer linked to the commit, open-source and API links. Take: a footer linking the exact commit proves it is real and open.

## Patterns worth taking

- One concrete verb in the headline, one in the subhead. The reader should be able to say what happens when they push.
- A real artefact above the fold: a command, a URL, a release, not a picture of a dashboard.
- Intent routing (Supabase table) instead of a feature list.
- Peer proof with names and links (Hack Club), not logo walls. Egg has no customers to show; show real projects of real members when they exist, never invented.
- Footer honesty: status link, commit link, open source link.
- Left-aligned text, mono only for commands and paths, one accent, hairlines instead of cards. Body 17-18px, 65ch, contrast 4.5:1, visible focus, reduced-motion safe.

## Things to avoid (all seen or standard in this set)

Centred giant headline plus two pills; div-built fake dashboards; round-number stat rows; a mono eyebrow over every section; split headline/paragraph headers; three equal cards; same-intent CTA labels; generic slogans; invented testimonials.

## Ten homepage section ideas for Egg

Facts from `public-site-direction.md`: 5 releases kept, 2 previews, health check up to 45 s, `current` link, `egg-<slug>.service`, three switches off by default.

1. **Push to live timeline.** A real-time-scaled strip: push, build, new release folder, health check, `current` switches. Proves a release only goes live once the app answers on its port.
2. **Rollback you can press.** Five release chips; click an older one and `current` moves. Proves the last five releases stay on disk and rollback is a switch.
3. **Failed deploy that does not hurt.** The same timeline with the health check failing and the old release staying live. Proves a bad push never replaces a working app.
4. **What it touches table.** Two columns: "Egg changes" (one release folder, one service, a `current` link) and "Egg never touches" (everything else on your container until you flip a switch). Proves least-touch and the default-off permissions.
5. **Three switches, all off.** Terminal, File changes, Removing leftovers as real toggles with one sentence each on what turning it on allows. Proves the student stays in control.
6. **Before and after the tmux bot.** Left: `tmux` session dies at lunch. Right: same bot, restarts after a push. Proves the problem in the visitor's own terms.
7. **Where does it run: your Nest.** A path diagram `~/.egg/<slug>/releases/<id>`, then `current`, then `egg-<slug>.service`. Proves it runs on your container, not a hosted platform.
8. **Preview before production.** A branch push becomes a preview, two kept. Proves previews exist and are capped.
9. **Goal-to-answer table (from Supabase).** "I have a bot", "I have a static site", "I want to roll back", "I want to leave", each linking to a docs page. Proves the docs answer first questions.
10. **Open and leaveable footer.** Commit link, source link, status link, plus "remove Egg" steps. Proves it is inspectable and you can walk away without losing the app.

Label sample data as sample. No invented numbers, names or quotes.
