# Plan: more themes, and custom themes people build themselves

Status (2026-11-13): built. The app now ships the larger theme set, a custom theme editor with import and export (`web/src/components/theme-editor.tsx`, migration `0028_custom_themes`), and "match my device" pairs. The text below is the original plan, kept for the reasoning; where it says "we have eight themes" it describes the starting point. The public site keeps the Egg look (owner rule); everything below applies to the signed-in app and signed-in docs.

## Where we are

- Eight themes: Egg Light and Egg Dark (the defaults), GitHub Light and Dark, VS Code Light+ and Dark+, Nord and Gruvbox Dark. Each theme is one fixed light or dark scheme. "Match my device" picks one light and one dark theme.
- Each theme is a CSS block with one colour per token, keyed by `data-theme-preset`.
- The choice is stored in the `egg_prefs` cookie (read before first paint) and in `user_preferences`.
- Other settings: density (comfortable, compact) and reduced motion. Nothing else is customisable.

## Part 1: more built-in themes

Add roughly ten well-known palettes, each with a light or dark scheme:

- Dark: Dracula, One Dark, Tokyo Night, Catppuccin Mocha, Rosé Pine, Monokai, Ayu Dark, Solarized Dark.
- Light: Catppuccin Latte, Rosé Pine Dawn, Solarized Light, Ayu Light, One Light.

Notes:
- Colours are not copyrightable, but several names are brands or trademarks in their own right (GitHub, VS Code). Label new themes as "inspired by" where a name is a brand, and keep the existing ones as they are unless you want them renamed.
- Every new palette must pass the same contrast tests as the existing ones (body text 4.5:1, danger text on muted and card, focus ring 3:1). The test already runs over every preset, so a new palette cannot ship if it fails.
- Each new palette is a CSS block plus one entry in `PRESETS`. No database change is needed.

Effort: Sonnet 5.5, medium (the contrast fixes need care, the rest is mechanical).

## Part 2: custom themes (the main idea)

### What a custom theme is

A named set of colours, plus an optional light or dark scheme. It saves to the account, so it follows the person to every device, like the built-in themes.

### Three levels, so people are not overwhelmed

1. **Quick theme (default).** Pick eight colours with colour pickers: page background, card surface, border, text, muted text, primary (buttons), link, and status (danger). A live preview shows a sample page with a sidebar, a card, a button, a link and a status badge. Egg derives everything else (grey steps, tints, the focus ring, hover states) from those eight, the same way the built-in themes are built.
2. **Full editor (advanced).** Every token is editable, grouped (surfaces, text, actions, borders, status, focus), with the derived values shown and overridable.
3. **Import and export.** A theme is a small JSON file. People can export, import, and copy a short share code.

### Contrast guard (the safety rule)

- Every save runs the same contrast checks as the built-in tests.
- Body text below 4.5:1 blocks the save, with the failing pair named and a suggested nearby colour that passes.
- Lower-priority pairs (for example a decorative tint) warn but allow saving.
- The preview shows each pair's ratio as the person edits.

Without this guard a custom theme could make the app unreadable. This is the part most worth getting right.

### Storage

- New table `user_themes`: id, owner (user id), name (max 40 characters), scheme (light or dark), tokens (JSON, validated), created and updated times. Limit: 20 custom themes per account.
- The preference stores `preset = "custom:<theme id>"`. An unknown or deleted theme falls back to the default for that scheme.

### Pre-paint and security

The custom colours must apply before the page paints, so they travel in the cookie, which the pre-paint script reads.

- Only colours that pass a strict check are written: `#` followed by 3, 4, 6 or 8 hex digits. No other text, no CSS, no URLs.
- The server validates the same rule when saving, and the pre-paint script validates again before setting any value. It never inserts raw CSS.
- The cookie stays small: about 40 tokens of 7 characters each is well under the 4 KB cookie limit. If the set is larger, the theme is loaded from the account after first paint, with the default shown first.
- Custom themes are private by default. Sharing is an explicit action (see Part 4).

Effort for storage and validation: Sonnet 5.5, high (security-sensitive: cookie, pre-paint script, server validation).

## Part 3: other customisation

These are cheap to add and make the app feel personal:

- **Corner radius:** sharp, default, rounded. One token drives the whole app.
- **Font scale:** 90%, 100%, 110%, 125%. Keeps touch targets at 44 px (the UX rule still holds).
- **UI font:** Geist (default) or the system font. The pixel headings stay, since they are part of the identity; a setting can turn them off if a person wants plain headings.
- **Sidebar:** expanded or collapsed by default.
- **Density:** comfortable or compact (exists).

Each is a token or a small CSS switch, with a test that the setting reaches the page.

Effort: Sonnet 5.5, high, with `project-frontend`.

## Part 4: sharing (later)

- **Export and share code:** done in Part 2.
- **Public gallery:** only after there is moderation, a report button, and a rule for names. Not before launch. It is the one part that needs a person to review content, so it waits.

## Part 5: the builder UI

- Settings, Appearance: a "Themes" section that lists built-in and custom themes in the same picker, with a "New theme" button.
- The editor opens in a dialog (quick mode first), with the live preview at the top and the contrast results below.
- Keyboard: every control reachable, arrow keys in pickers, visible focus, labels for every colour input (the colour value is shown as text too, not only as a swatch).
- Mobile: the editor is a full-screen sheet below 640 px.

Effort: Sonnet 5.5, high, with `project-frontend` and `web-design-guidelines`.

## Suggested order

1. Part 1: the new built-in themes (Sonnet medium).
2. Part 2 storage, validation and the contrast guard, with the cookie and pre-paint path (Sonnet high).
3. Part 2 quick editor and preview (Sonnet high).
4. Part 3: radius, font scale, UI font, sidebar default (Sonnet high).
5. Part 2 import and export (Haiku, once the file format is fixed).
6. Full editor (Sonnet high), after the quick editor is used and checked.
7. Gallery (only after moderation is designed; not now).

## Questions for you

1. **Built-in additions:** which of the listed palettes do you want? Any others?
2. **Custom themes:** start with the quick editor (eight colours) and add the full editor later, or build both now?
3. **Limit:** 20 custom themes per account is my suggestion. Is that right?
4. **Other customisation:** do you want corner radius, font scale, the UI font choice, and the sidebar default in the first round, or only themes?
5. **Gallery:** later, or never? It needs moderation, so I'd leave it out of the first release.

Once you've answered, I'd start with Part 1 and the storage and contrast guard, since those are needed by everything else.
