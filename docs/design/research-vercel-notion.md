# Research: Vercel and Notion homepages (fetched 2026-11-06)

Method: WebFetch on all four pages, plus curl of homepage HTML and the linked stylesheets. Type values below are read from the published CSS; section order is from rendered HTML/markdown.

## CSS availability
- Both sites publish plain, unauthenticated `<link rel=stylesheet>` Next.js chunks (HTTP 200).
- Vercel: 3 sheets, 117,137 + 877,144 + 7,374 bytes raw (about 1.0 MB). All CSS in one folder gzips to 158 KB. Tailwind-style utilities plus Geist tokens (`text-heading-64`).
- Notion: 10 sheets linked on the homepage (about 1.27 MB raw; largest 295 KB). CSS modules with hashed names (`KlQGRG_title`) over a `--tatami-*` token layer.
- Both are heavy. Egg needs one small stylesheet, not this.

## Vercel (vercel.com)

**Section sequence**
1. Hero: header block on the left (desktop) over an interactive WebGL "drop to deploy" shader field. Full-bleed.
2. "Build agents on infrastructure that thinks like them": split, headline plus 4 titled features plus one customer proof line (Notion).
3. "Ship apps that scale from zero to millions instantly": same form, proof is Zapier.
4. "Host platforms that serve every customer": same form, proof is Mintlify.
5. "Recently shipped": 3-card grid (Backends, Agents, Sandbox) with "Learn more".
6. "Built by you, or your agents": centred closing CTA, repeats "Deploy now".
7. Brand assets and feedback lines, then a dense link footer.
No logo row, FAQ, quote or table on the page.

**Hero.** H1 "Agentic Infrastructure" (no full stop). 48px/56px on small screens, 64px/64px (line-height 1.0) at the large container breakpoint, letter-spacing -3.84px (-6%), and weight forced to 400 (`font-normal!`) over the 600 token. Header column is capped at 444px wide. Under it, a mono 16px line that scrambles through phrases ("For coding agents"). Buttons: primary "Deploy now" (solid near-black, fully rounded, large form size), then secondary "Talk to sales". Pill buttons, 150ms transitions.

**Type system.** Geist Sans plus Geist Mono, variable. Scale from CSS: heading-72/72, 64/64, 48/56, 40/48, 32/40, 24/32, 20/26 at weight 600, tracking about -6% on big sizes (-4.32px at 72). Section H2s: 32px, 48px, 56px/56px, `text-balance`, `max-width: 18ch`. Body: copy-16/24, 18/28, 20/36. Labels: 14/20 medium.

**Layout detail worth copying.** H2s sit on a 12-column grid and alternate start column (col 1 span 8, then col 5 span 8). The stagger gives rhythm with zero decoration.

**Product UI.** In the markup, the home shows product mostly as live or WebGL visuals and graphics, not static screenshots. The docs home leads with real terminal code blocks (`npm i -g vercel`, `vercel login`, `vercel`; a `curl` call) instead of images.

**Copy.** Imperative, noun-first. H1 is two words. Section headlines are one sentence of 6-9 words with a verb ("Ship apps that scale from zero to millions instantly"). Feature names are Title Case nouns. Proof is a named customer with one metric. Buttons are 2 words.

**Docs layout (/docs).** Title "Vercel Documentation". Opens with "Ship anything with Vercel" and three terminal blocks (Deploy an app, Set up your agent, Call a model), then groups of bold-name plus one-sentence cards: "Build with AI", "Build your app", "Secure your app", "Deploy and operate". A dated "What's new" list sits mid-page (4 items, date, title link, one sentence). Every card ends "Learn more →". Each group has 4-6 items.

**Template-made / avoid:** grid of 3 "Recently shipped" cards with identical "Learn more"; three near-identical split sections in a row; buzz framing ("Agentic", "thinks like them") that says little without the screenshot.

## Notion (notion.com, notion.com/product)

`/product` serves the same content as the homepage in our fetch.

**Section sequence**
1. Hero: centred text over/beside a pile of 7 image tiles and a "Play" control (video).
2. Logo row under heading "The most ambitious companies run on Notion." (OpenAI, Figma, Ramp, Cursor, Vercel; monochrome).
3. "AI where your team works.": full-width section heading.
4. Feature split: label "Capture", H2 "Bring everything into one system of record." with desktop screenshots in a product frame.
5. Feature split: "Find", H2 "Get answers, instantly—with citations." (screenshots incl. chat input).
6. Feature split: "Automate", H2 "Keep work moving 24/7 with agents."
7. "See what Notion can do": row of icon cards, each an outcome with an arrow ("Triage product feedback→", "Resolve support tickets in Slack→").
8. "Trusted by teams that ship.": 3 quote cards with portrait, logo, quote, name and title.
9. Stats band (looping): "100M users in over 50 countries", "Over 50% of YC companies", "62% of Fortune 100 use Notion".
10. Closing pull quote: "We shape our tools, and thereafter our tools shape us." (McLuhan), then footer.
No FAQ.

**Hero.** H1 "Where teams and agents Think together." The word "Think" is an animated pill. Fluid size: `clamp(42px, 11.25vw - 25.5px, 96px)` with line-height `clamp(48px, 10.83vw - 17px, 100px)` (about 1.04), negative tracking from -4.6px to -1.5px, weight semibold, `text-wrap: balance`. Deck (one sentence, wraps with `text-wrap: pretty`): "Capture context, find answers, and automate tasks with AI built for your team." Buttons: primary "Get Notion free", secondary "Request a demo", side by side.

**Type system.** NotionInter (Inter variant) Regular/Medium/Bold; iA Writer Mono for code; Lyon Text serif in places. Every text role is a token (`global-title`, `global-deck`, `card-title`, `global-context`) with breakpoints at 600/840/1080/1280/1440. Card titles use `text-wrap: pretty`.

**Product UI.** Real desktop screenshots in a frame, with smaller inset captures layered on top. No interactive demo. Hero uses illustration and video, not UI.

**Copy.** Three-part feature unit: one-word label, declarative headline ending in a full stop, one benefit line, arrow link. Verbs lead ("Capture", "Find", "Automate"). Social proof is large numbers and named execs.

**Template-made / avoid:** the stats band repeated three times for a carousel; testimonial cards with logo, portrait and quote in a row of three; hero collage that tells nothing about what the product does.

## Five ideas to steal
1. **Show real code, not pictures of it.** The Vercel docs open with three runnable blocks. Egg's hero should show the actual `git push` and a real deploy log from our own product.
2. **Short, balanced headline at 1.0 line-height.** 56-64px, tracking about -6%, `text-wrap: balance`, `max-width: 18ch`, 6-9 words, a verb in it.
3. **Staggered 12-col headings.** Alternate the start column of section H2s instead of centring every one.
4. **Label, headline, one line, arrow link** as the repeated feature unit (Notion), with the label one word ("Push", "Build", "Live").
5. **Two buttons only, primary first, 2-3 words each**, then proof (a named customer plus one real figure) directly below the hero, never inside it.

## Could not confirm
- Rendered pixels, spacing between sections and colours (no browser capture).
- Vercel's product imagery beyond the shader hero (images not in the fetched text).
- `/product` appears identical to the homepage in our fetch; no distinct product-page layout.
