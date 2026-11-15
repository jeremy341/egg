# Docs layout inside the app

The docs use the app's own background and card surfaces. The homepage pixel grid is gone.

## Options

1. Two full sidebars: the app sidebar plus a docs sidebar with its own surface and border. They fight for the left edge and leave about 700px for the page at 1280px.
2. One shell, docs navigation in the content area (chosen). The app sidebar stays the only full-height sidebar. The docs page list is a light column on the app background, with no panel of its own.

I chose option 2 because the reader keeps one stable frame, and the docs list reads as part of the page, like a settings page with tabs.

## Layout

From 1280px the docs are a two-column frame that fills the content area edge to edge (`DocsFrame` measures the shell's column, so it also holds on screens wider than the shell's centred page column):

1. Page list: 224px, flush against the app sidebar like a second sidebar. Full height, sticky under the top bar, hairline on its right, app background. Filter field on top, groups with small labels, rows styled like the app's own nav, a tinted row and a small square on the current page, `aria-current="page"`. Plain links, so Tab and Enter work.
2. Reading area, left aligned right after the list: the card (`bg-card`, hairline border, 8px corners, at most 840px wide) and, on pages, the "On this page" rail (144px, sticky, the heading in view marked with a square). Text is capped at 33em of 17px type (about 68 characters). Code, tables, steps and callouts use the card's width. Pixel face stays on the page title and section headings.

All docs text is left aligned (no centred or right aligned text, including previous and next links and the page count).

Under 1280px the list and rail are gone. A bar under the top bar names the current page and opens the page list and the headings of this page.
