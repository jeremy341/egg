# Signed-in UI audit

Captured at 1440 and 375 with the demo data: projects, a project overview, deployments, domains, resources, logs, activity, container, developer, account, connect, docs home and a docs page. No page overflows horizontally at 375. Problems, worst first.

## Docs

- No sidebar. The page list hides behind a "Docs / All pages" bar that opens a panel, so a reader cannot see where they are.
- Docs home is a dump: 22 pages, each with up to 14 sub-links (Troubleshooting alone prints 14). Summaries are 14px muted text, so the list has no clear order.
- The pixel face and the page grid are missing. Code comments say "h2 in the pixel face", but every heading renders in Geist.
- Blocks are uneven. Steps use a filled square, "What can go wrong" uses an empty square that reads as a checkbox, and examples use a rule plus a tiny label. Tables, callouts and code use three widths (600, 760, 780px).
- The column is 34em and the "On this page" rail only starts at 1280px, where it leaves little room.
- Limits tables clip their last column.
- Missing from the docs: CSV exports and signed outbound webhooks.
- The docs said "Nest Deploy" 74 times and the public site said Egg. Now both say Egg, and so do the server messages the docs quote.

## Dashboard

- Error state: every container read fails with the same tall pink alert. "Show details" looks like plain text and the two buttons sit far apart. It repeats on overview, logs, container and project pages.
- Empty states: Resources shows three tall blank charts, each with "Collecting data" and "None" under Lowest, Average and Peak. "None" in a Restarts column reads like a value. A four-row table says "No readings" eight times.
- Page frames disagree. Developer is 1120px and centred (8px off every other page at 1440). Connect and Account are 720px and centred. The "Docs" link floats right and wraps to its own row at 375.
- Toolbars at 375: Logs stacks five control rows before content; Deployments stacks three filter rows.
- Account: the signed-in browsers list is unbounded (57 rows, about 3,000px in the demo), and the container permissions intro is one 90-word paragraph.
- Contrast passes (muted about 7:1, subtle about 5:1 in light mode), but chart labels are 11px.
- Copy: "Check" has no object for a screen reader, and "None" stands for a missing reading.

## Plan

Docs get a left sidebar from 1280px, a pixel-face h1 and h2, the grid behind the content, a 68 character column, an "On this page" rail from 1400px and one set of block styles. Docs home becomes a one-line-per-page index. The dashboard gets a calmer error state, shorter empty states, one frame for Developer, grouped log controls, a capped browsers list and clearer labels.
