# Public site guidelines

Checkable rules for the home page, docs, top bar and footer. Reasons: `vercel-direction.md` (layout, type, docs), `public-site-direction.md` (mechanism, facts).

**Changed:** layout and docs follow Vercel's patterns. Pixelify is on every heading, not only the hero. Lit squares are no longer the main device (hero, failure section, token scopes only). The product is Egg, an add-on that connects to a Nest container.

## 1. Grid and columns

- The 30px hairline grid (`--grid-line`) runs behind every public page, docs included. No opaque band covers it.
- Page column at most 1380px. Gutters 16px on phones, 24px from 640px. Above 640px every block starts on a ruling line (check at 1280 and 1440); on phones only vertical alignment.
- Readout cells align exactly with the background cells (ghost, `--pixel-lit`, `--brand`, inset 3px). Readouts appear only in the hero, the failure section and token scopes.
- A readout's cell count comes from a code constant (`TOKEN_SCOPES`), never a typed number.
- One accent cell at most per viewport. Square corners on frames and buttons; inline code 3px.
- One column below 1024px. Code, tables and logs scroll inside their own frame, never the page.

## 2. Section rhythm

- 4 cells (120px) between sections on desktop, 2 (60px) on phones. More space above a heading than below.
- No two adjacent sections share a layout; at least four forms. Section h2s start at column 1 or column 5 of a 12-column grid, snapped to a ruling line. One hairline per group, never per row.
- A product view may take 8 columns plus a 3-column rail. One uneven card section per page.
- No section sets its own background. Only app views, code and the one card section get a surface.

## 3. Headings and copy

- Sentence case everywhere.
- One idea per section. The h2 states it plainly ("A failed deploy puts the old release back").
- No filler headings ("Features", "Everything you need").
- Headings are plain claims of 5 to 9 words, no final period. No eyebrow or kicker above a heading. No section numbers unless the order is a real sequence (setup steps).
- The sentence under a heading at most 25 words (20 in the hero).
- Say what a thing does, then what it needs. Define each product term once.
- Every number and limit is read from the code that enforces it and covered by a test like `home-facts.test.ts`. No unbounded speed claims.
- Releases are named by short commit. Sample data says "Sample data" in its caption.
- No em or en dashes in visible copy. Ranges use a hyphen. Curly quotes.
- Banned words: powerful, seamless, effortless, unlock, supercharge, journey, elevate, built for, revolutionize, streamline.
- Buttons name their action ("Read the quick start", "Sign in", "Copy"). Never "Learn more", "Get started" or "Submit". One label per intent across the site.
- No exclamation marks. Copy says "Egg connects to your Nest", never that Egg is part of Nest. State once, near setup and in the footer, that it is an independent project, not an official Hack Club product.

## 4. Top bar

- 60px, `bg-background-subtle`, sticky, hairline only after scrolling. Left: the square mark (24px) and Egg in Pixelify.
- Links in order: Setup (`/#start`), Security (`/#security`), Docs, Stats, Source (external, hidden "(opens in a new tab)"). Docs has `aria-current="page"` on `/docs/*`.
- Right: theme button, then "Sign in" as a secondary button. No filled button.
- Below 768px the links move into a 40x40 "Menu" button (`aria-expanded`) with rows at least 45px tall; Esc closes it and returns focus.
- Skip link targets `#top`. Anchors survive: `#product #start #runtimes #security #faq #top`.

## 5. Docs

- **One index.** `/docs` shows the first steps, then every page grouped like the sidebar with its `SUMMARIES` line.
- **Left sidebar** (1024px and up): sticky, groups from `DOCS_NAV` as 13px muted labels, 30px rows, the current page filled and weight 500. A "Find a page" field (`/` focuses, Esc clears); not "Search" until full-text exists. Below 1024px, a sticky "On this page" bar.
- **Breadcrumbs** above the h1 from 1024px, with `BreadcrumbList` data.
- **Right rail** (1280px and up): "On this page" on a 1px rail, h3s indented, current one marked.
- **Previous and next:** a hairline, then two plain links with a chevron.
- **Every feature page, in order:**
  1. A lead that defines the feature in one sentence.
  2. A prerequisite note if needed (a connected server, a token scope). Notes are one or two sentences, open with a bold word (Note, Tip, Warning), use a Phosphor icon, and sit at the risk.
  3. **Steps**, numbered: a short title, one paragraph, at most one code block or one exact UI path ("Project, Settings, Domains").
  4. **Limits**, read from code constants, each with its number and what happens at it.
  5. **Troubleshooting**: a Symptom, Cause, Fix table, one row per failure the code reports, quoting the exact message or state.
  6. Related pages.
- **Worked example**, marked "Example": *Given* (sample names), *Do* (steps), *Result* (UI text quoted exactly).
- Prose 17/30, at most 68ch, in `--prose`; code and tables use 760px. Behind prose the grid may drop to 5% ink, never disappear.
- Code blocks have a header ("Terminal" or a file name) and Copy, which announces "Copied". Wide frames are keyboard scrollable.
- Tabs only for equal variants of one result (package managers, curl or MCP). With scripts off every panel shows, labelled. Steps that differ get separate h3s.

## 6. Type

- **Pixelify Sans 500:** every h1, h2, h3 and the wordmark. Tracking 0, never below 20px. Home h2 48/60 (32 on phones); docs h1 40/60, h2 24/30; h3 20/30.
- **Geist Sans:** body 17/30, leads 20/30, labels 14, group labels 13. Weights 400 and 500, h4 600. Tracking -0.02em from 20px, never below -0.04em.
- **Geist Mono:** code, commands, paths, commits, scopes and ports only.

## 7. AI tells to avoid

- Same-size icon, heading and text cards as page structure. Uneven cards with real content are allowed once per page.
- Gradient text, glows, glass, blur, coloured side borders, hard offset shadows, grid lines beyond the brand grid.
- The hero-metric template. Mono for labels. A rule under every row.
- Scroll cues, version stamps, locale strips, decorative dots.
- Div-built fake screenshots, invented numbers, testimonials, user counts.
- One entrance repeated on every section.
- Emoji or Unicode glyphs as icons (Phosphor only).

## 8. Accessibility

- Text contrast at least 4.5:1 (large text 3:1) in light and dark. Cells that carry meaning, borders and focus rings at least 3:1.
- `--brand` never sets small text; use `--brand-text`.
- Colour is never the only signal: readouts have text labels, failed cells an outline.
- Focus uses `--ds-focus-ring` on `:focus-visible`; the sticky bar never hides it. Touch targets at least 40x40px below 640px. The release demo is a native radio group with "sample" in its name.
- One h1 per page, headings in order, landmarks present. Reduced motion: no entrance or smooth scroll. Works at 200% zoom and with scripts off.

## 9. Review checklist

- [ ] Grid behind every page; readout cells aligned at 1280, 1440 and 375; no sideways scroll at 375.
- [ ] First viewport: what it does, a sample readout, a way to the docs.
- [ ] One accent cell per viewport at most. No item from section 7. Pixelify on every heading; Geist elsewhere.
- [ ] Every number traces to a code constant and a test. No em or en dashes or banned words.
- [ ] Every docs feature page has all six parts, with breadcrumbs and previous and next.
- [ ] `npx vitest run`, `npx tsc --noEmit`, `npx eslint src` clean.
