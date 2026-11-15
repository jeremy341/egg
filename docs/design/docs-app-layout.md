# Docs layout inside the app

The docs use the app's own background and card surfaces. The homepage pixel grid is gone.

## Options

1. Two full sidebars: the app sidebar plus a docs sidebar with its own surface and border. They fight for the left edge and leave about 700px for the page at 1280px.
2. One shell, docs navigation in the content area (chosen). The app sidebar stays the only full-height sidebar. The docs page list is a light column on the app background, with no panel of its own.

I chose option 2 because the reader keeps one stable frame, and the docs list reads as part of the page, like a settings page with tabs.

## Layout

- Background: the app's `background-subtle`. The article is the app's card (`bg-card`, hairline border, 8px corners).
- Page list, from 1280px: 176px column. Groups with small labels, rows styled like the app's own nav, a tinted row and a small square on the current page, `aria-current="page"`. A filter field on top. Plain links, so Tab and Enter work.
- Reading column: the card, with text capped at 33em of 17px type (about 68 characters). Code, tables, steps and callouts use the card's width. Pixel face stays on the page title and section headings.
- "On this page" rail, from 1280px: 144px, sticky, the heading in view marked with a square.
- Under 1280px: the rail is gone. A bar under the top bar names the current page and opens the page list and the headings of this page.
- At 1280px: 176 + 24 + 608 (card, 24px padding) + 24 + 144 fills the 976px content area, so the measure holds.

