# Research: Linear, Stripe, Resend, Raycast homepages

Fetched 6 Nov 2026 (WebFetch for structure and copy, raw HTML and CSS for type facts). Stripe was served in German. Rendered hero sizes were not measurable; where I give a size it comes from CSS tokens.

## Linear

**Sequence**
1. Announcement bar: one small link ("NewLoops").
2. Hero: headline, subline, large issue-view product shot.
3. Logo strip: one line of customers.
4. Intro statement with three "Fig 0.1 to 0.3" points: three-column row.
5. Four feature blocks (intake, planning, AI, build/review/ship): each a small label, short headline, two sentences, "Learn more" link, one real-looking UI shot (kanban, review list).
6. Before/after code diff: full-width snippet.
7. Changelog: dated entries, "View all".
8. Two testimonials: large quotes, name and company.
9. Count line: "over 50,000 product teams".
10. Closing CTA: "Get started" and "Contact sales".

**Hero.** "The product development system for teams and agents". Subline: "Purpose-built for planning and building products. Designed for the AI era." Product UI sits directly under it.
**Type.** Inter Variable (cv01, ss03), Berkeley Mono for IDs and code. Body 15px at 1.6. Titles step 24, 32, 40, 48, 56, 64, 72px, tracking -0.022em, line-height 1.0 to 1.1, weight 590. Optional Tiempos serif exists in tokens.
**Product UI.** Real density: ticket IDs ("DRV-8852"), counts, dates, avatars. Shown as authentic screens, not illustrations.
**Copy.** Noun-phrase headlines, sentence case. "Purpose-built", "Powered by agents", "Designed for speed", "Built for the future. Available today."
**Template feel.** The three "Fig" cards and the label-headline-body-link repeat identically in every feature block.

**Steal**
1. Show real, dense product data, not abstractions.
2. A tight type ramp with negative tracking on display sizes only.
3. Mono font for identifiers (IDs, commit SHAs).
4. A changelog on the homepage as proof of motion.
5. Two testimonials only, large.

## Stripe

**Sequence.** Nav with mega-menus, hero, bento of six imagery tiles, stats band (four big numbers), four case-study cards with metrics, services trio, startup grid, platform quotes, developer section (API metrics), news carousel, closing CTA ("Sind Sie startklar?") plus two quick-link cards, footer directory.

**Hero.** "Die Finanzinfrastruktur für mehr Umsatz." (English tagline not fetched). Lead-in above: "Globales BIP, das über Stripe abgewickelt wird:" with a live-style figure. Two buttons: "Jetzt starten" (primary), "Mit Google anmelden" (secondary, OAuth). Logo marquee of about 12 brands below, wave graphic behind.
**Type.** sohne-var, light 300 hero, size scales with viewport height (6lvh), line-height 1.03.
**Product UI.** Mostly photography and gradients. One small billing card (plan, price per 1,000 tokens, usage counter) inside a tile.
**Copy.** Imperative outcome headlines. "Aktivieren Sie das passende Abrechnungsmodell". Customer headlines carry a number: "Decagon senkt die Supportkosten um 65 %".
**Template feel.** Long. Every section is heading plus card grid.

**Steal**
1. Sign-in shortcut beside the primary button (we already have GitHub sign-in).
2. A live number as the first thing in the hero.
3. Headlines that carry a figure.
4. A stats band of four honest numbers.
5. Weight 300 display type for calm authority.

## Resend

**Sequence.** Nav (Features, Company, Enterprise, Help, Docs, AI, Pricing, Log in, Get started), hero, "Integrate" (language tabs plus live code block), "First-class developer experience" (email list with HTTP 200 responses), "Test mode", "Modular webhooks", editor, contacts and analytics pair, React email code with file tabs, deliverability list of nine small items, "Everything in your control", closing "Email reimagined. Available today."

**Hero.** H1 "Email for developers" in Domaine serif, 4rem mobile and 6rem desktop, tracking -0.01em, line-height 100%, gradient fill, left-aligned. Subline: "The best way to reach humans instead of spam folders. Deliver transactional and marketing emails at scale." Buttons: "Get started" then "Documentation"; trust line beside them.
**Type.** Display serif (Domaine), ABC Favorit, Inter body, Commit Mono for code and labels.
**Product UI.** Real code blocks with tab switchers (Node.js, Ruby, Python, cURL, SMTP), a working-looking send log, a real editor. Code is the hero image.
**Copy.** One sentence per feature. "Test mode", "Modular webhooks". Plain nouns.
**Template feel.** Gradient headline text; dark glow cards.

**Steal**
1. Code with language tabs as the central visual (our equivalent: a push-to-live log).
2. A response log (HTTP 200 IDs) instead of a mockup.
3. Serif display with sans body, used once.
4. Short noun-phrase feature names.
5. Primary then docs button, no third action.

## Raycast

**Sequence.** Nav, hero, keyboard graphic, extension grid with category tabs, AI assistant mockup with three sub-features, creator wall (about 24 avatars), automation trio with screenshots, one-paragraph feature list, Notes gallery, community (Slack, X, videos), developers (four cards, "Get started"), closing "Download and use Raycast for free", footer with newsletter.

**Hero.** "Your shortcut to everything." Subline: "A collection of powerful productivity tools all within an extendable launcher. Fast, ergonomic and reliable." One text link, no big button in the extract (unconfirmed visually).
**Type.** Inter plus Geist Mono, Instrument Serif present in tokens.
**Product UI.** Actual app windows, per-feature screenshots, icon cards.
**Copy.** Full-stop headlines, fragments. "It's not about saving time.", "There's an extension for that.", "Don't repeat yourself.", "Take the short way."
**Template feel.** The creator wall and 14-video grid are padding.

**Steal**
1. Full-stop headlines, three to five words.
2. Reaction-to-objection headline ("It's not about saving time.").
3. Real app screenshots per feature, labeled by feature name.
4. A single closing CTA line naming the price: free.
5. A paragraph-form feature list for breadth instead of more cards.

## Five ideas for Egg (across all four)
1. Hero visual is a real push-to-live log (commit, build, status, URL), not a mockup.
2. Headline of three to six words, sentence case, one subline under 20 words.
3. Primary button, then one quiet secondary; GitHub sign-in as the primary.
4. Mono for repo names, SHAs and URLs; one sans for everything else; weights 400 and 590.
5. Vary section forms: log, code, a stats line, a changelog, one closing line.
