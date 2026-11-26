# Docs layout research

WebFetch returns text only, so I also loaded one article per site in headless Chrome at 1440x900 and read computed styles.

## What the four sites do

- **Vercel**: text sits directly on the page background (#fafafa). No card. Page list 288px, "On this page" rail 240px, both transparent. Title 56px, tight tracking.
- **Tailwind**: white page, text on the page. 225px sidebar with no rule or fill. Title 30px, weight 500. Code blocks run full width.
- **Stripe**: white page, text on the page, 280px list. Surfaces only on code panels and callouts. Title 32px bold, h2 24px.
- **Linear**: dark page, text on the page, 650px column, 15px on a 24px line (about 87 characters). One 1px rule on the page list's right edge, none on the 250px rail. h2 is 24px with 56px above it.

## What they share

None put prose in a bordered card. The page background is the reading surface. Surfaces are kept for code and callouts. Columns are separated by space and at most one hairline. Headings are large and tightly tracked, with generous space above sections.

## Choice

Follow Linear: text on the app background, one hairline per boundary (page list to article, article to rail), plus space. A card around prose repeats the frame the app shell already draws, which is why it looked boxy.

Applied here: no card. Column up to 720px, text capped near 68 characters, left aligned. Rules on the page list's right edge and the article's right edge, both full height. The rail has no box. Pixel face stays on h1 and h2. Code, worked examples, tables and callouts keep their own surfaces. Previous and next become a plain row under a top hairline.
