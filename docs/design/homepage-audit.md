# Homepage audit (6 Nov 2026)

Captured the nine-section page (commit d9d2217) at 1440x900 and 375x800, light and dark. Detector on the live page: 4 findings at 1440, 12 at 375.

## What made it look AI-made and weak

1. **No shared column.** Three sections had no page wrapper, so they started at x=0 while others started at 30 or 55px. On a phone eight paragraphs touched the screen edge.
2. **One heading size.** The hero headline was 56px and every section heading 52px. Nothing led; the page read as nine equal Pixelify slabs, each followed by the same grey paragraph.
3. **One template, nine times.** Heading, grey paragraph, artefact, repeated. The staggered start column left 480px of bare grid beside runtimes, uptime and switches.
4. **Decoration standing in for meaning.** A black square sat beside every hero log line, reading as redactions. The first screen also held a bullet list, two "Sample" captions and a release picker: seven competing pieces.
5. **No spacing rule.** Two sections sat 15px apart and collided; later gaps jumped to 150 and 180px.
6. **Weak reading.** 16px muted body, 13px grey labels, the same fact three times, and internal terms ("current", "nd-") with no reason a student should care.
7. **Data dumps.** All 20 token scopes in two mono columns to say one thing: a token can be narrow.
8. **Footer repeated the nav** in three thin columns, with the theme switch alone on a row.

## What changed

- Every section uses `board-col` and one rhythm: 150px between sections on desktop, 90px on phones.
- A real scale: display 88px (hero only), section 48px, item 19px, body 17px on 28px in near-black, small 14px.
- Six sections, five layouts: hero; how a push goes live (rail, then the answers or not fork with rollback); runtimes (heading beside a table that stacks on phones); once it is live (status strip beside a short list); the three switches in one strip; setup beside questions.
- The hero log marks only the line that matters. Sign in is the one filled button, in the bar, the hero and the close.
- Every number comes from `home-facts.ts`; the sample port is now pinned and tested.

## Result

Detector on the live page: 2 findings per width. The questions frame (padding sits on each summary) and Geist at 80% of text (the body face the brief keeps).
