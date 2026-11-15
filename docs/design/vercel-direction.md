# Vercel direction (home page and docs)

Status: for review. Replaces the layout, docs and component parts of `public-site-direction.md`; its mechanism, palette and fact rules still apply. The product is **Egg**. Copy says "Egg connects to your Nest", never "Egg is part of Nest". Repo: `jeremy341/egg`. "Nest Deploy" stays only where it names existing code.

**Evidence.** Structure and copy come from text extracts of vercel.com, /docs, /docs/instant-rollback, /docs/cli and /docs/environment-variables. Type tokens, docs chrome, notes, tabs and prev/next were read from Vercel's served HTML and CSS (`text-heading-48` is 48/56, -2.88px, 600; tab underline 2px). Nothing was checked in a browser.

## What we take from Vercel

- **Docs home, "Ship anything with Vercel" (/docs):** three headed terminal blocks, then groups of bold name, one sentence, link.
- **Docs chrome (/docs/environment-variables):** 13px muted group labels; "On this page" on a 1px rail with a foreground segment at the current item; a breadcrumb row above the h1; Previous and Next as plain links under a hairline.
- **Home, "Recently shipped" (vercel.com):** parallel items, each an h3, a description, a link. Used once, uneven.
- **Home, proof sections (vercel.com):** an h2, one claim line, a short list of named capabilities.
- **Command reference (/docs/cli):** an h3 per command, real invocations, a link. Ours: token scopes and API calls.
- **Tabs (/docs/cli):** pnpm, yarn, npm, bun over the same command. Equal variants only.
- **Notes (/docs/environment-variables):** a one-to-two-sentence block that opens "Note:", at the point of risk. We use a Phosphor icon where Vercel uses an emoji.
- **Page shape and copy:** a lead that defines the thing, plain-claim h2s, limits with numbers, sentence case, UI labels in bold.

**Not copied:** the triangle, wordmark, Geist Pixel, pills, rounded cards, glows, customer logos, "Learn more →", "Deploy now".

## What we keep

- The hero as is: copy, board readout, sample push readout, layout.
- White surface and the 30px grid behind every page. Only app views, code and the one card section cover the grid.
- Pixelify on every heading. The square mark and square corners.
- Lit readout cells only in the hero, the failure section and token scopes.

## Type

- **Pixelify Sans 500, headings only** (h1 to h3, wordmark), tracking 0, never under 20px. Home h2 48/60 (32 on phones). Docs h1 40/60, h2 24/30, all h3 20/30.
- **Geist Sans:** body 17/30, leads 20/30, labels 14, group labels 13. Weights 400, 500, h4 600. Tracking -0.02em from 20px up.
- **Geist Mono:** code, commands, paths, commits, scopes, ports and code captions only. 13px in blocks.

## Home page below the hero

1. **Setup** (`#start`). Job: what it needs. Form: three columns, each with an h3, one sentence, one exact item. From: "Ship anything" blocks.
2. **What a push does** (`#product`). Job: how it works. Form: h2 left, live `DeploymentsView` across 8 columns, a rail with a two-tone sentence and four steps.
3. **When a deploy fails** (`#rollback`). Job: safety. Form: full-width log frame, then the release cells in one row beneath. Differs from section 2.
4. **Runtimes** (`#runtimes`). Job: will my app run. Form: a table, header row filled. From: Environments table.
5. **After it is live** (`#track`). Job: what is watched. Form: five uneven items; the status page is large, four are small. From: "Recently shipped". The page's only card section.
6. **Scripts and agents** (`#agents`). Job: automation. Form: scope readout left, tabbed code (curl, MCP config) right. From: CLI tabs.
7. **What it can touch** (`#security`). Job: trust. Form: a note stating the key's reach, then term and text rows. From: Note pattern.
8. **Questions** (`#faq`). Job: doubts. Form: native `details`, 760px. Vercel's home has no FAQ.
9. **Close.** Job: next step. Form: one centred block: h2, "Read the quick start", source link.

Spacing: 120px between sections, 60px on phones. One hairline per group, never per row.

## Docs

- **Sidebar:** `DOCS_NAV` groups as 13px muted labels, 30px rows, current page weight 500 on a light fill (replaces the lit cell). Filter field with a `/` hint, labelled "Find a page" until full-text search exists.
- **Breadcrumbs:** "Docs / Use it" above the h1 from 1024px, with `BreadcrumbList` JSON-LD. **Reading column:** 780px. **Right rail** from 1280px: "On this page", h3s indented.
- **Notes:** note, tip, warning, each opening with a bold word. Prerequisites are notes.
- **Code:** header with "Terminal" or a file name, and Copy. Tabs only for equal variants; with scripts off every panel shows.
- **Troubleshooting:** a Symptom, Cause, Fix table on every feature page. **Previous and next:** plain links under a hairline.
- **Index:** three first-step blocks, then every group with its `SUMMARIES` lines.

## Risks

- **Reads as a Vercel clone.** Our tokens are already Geist's. Pixelify, grid, readouts and square corners must carry the difference.
- **Pixelify at 20px on long h3s** ("It built, but the app never answered"). Check wrapping at 375px. It also resembles Geist Pixel.
- **Cards versus "no generic card grids".** One card section, uneven, real content in each.
- **Grid alignment.** 12-column offsets miss 30px lines; snap readout edges with `round(down, …, 30px)`; check 1280, 1440, 375.
- **The rename.** Swap "Nest Deploy" for Egg in one change (metadata, wordmark, footer, docs, `REPO_URL`). Next to "Nest", "Egg" invites bird pictures: keep them off the page.
- **"Find a page" is not search.** Readers expect full-text search.
