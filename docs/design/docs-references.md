# Docs references

I read eight sites: page text, plus a headless Chrome screenshot at 1440x900 of each. Sizes below are read from the screenshots, so they are approximate.

- **Vercel**: very large tight title, muted lead, two action buttons. Page list left, "On this page" rail right with a thin rule. Text sits on the page background, no card.
- **Tailwind**: small mono eyebrow, 30px title, lead. Steps numbered 01 to 06 with dark code panels beside. No rail.
- **Stripe**: bold title, lead, code panel beside the text. Surfaces only on code and callouts.
- **Supabase**: breadcrumb left and "Updated" date right, title, one-line lead, then body in a column near 700px. Small-caps "On this page" rail. Headings roughly 28px with about 48px above.
- **React**: breadcrumb eyebrow, 40px title, 18px lead. Callouts are the only boxes.
- **Next.js**: breadcrumb row with "Copy page", title, lead. 720px column. "Good to know" is a plain quote. Rail plus feedback links.
- **Radix**: title, muted lead, framed live demo, tables for props, "Quick nav" rail.
- **Linear**: 650px column, 15px type on a 24px line, one hairline, rail without a box.

## What they share

A small row above the title (breadcrumb, sometimes a date), a title of 32 to 40px, a muted 18px lead, then space or one hairline. Body is 15 to 16px on a 24 to 28px line. Paragraphs sit 16 to 24px apart and an h2 has about 48px above it, never 90. Boxes appear only on code, tables and callouts. Calm comes from one rule, one column and a steady beat. The old page had 17px on a 30px line, 30px between paragraphs and 90px above sections, which is why it read as loose.

## Chosen pattern

Supabase and Next.js: a breadcrumb row (place left, position right), the title, a one-line lead, one hairline, then one 680px column with the contents rail beside it. The app sidebar already holds the page list, so the page only has to say where you are and what this is, then let the text run.
