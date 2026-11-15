# UX pass baseline (critique, read-only)

Date: 2026-11-08. Scope: the UX details in `platform-and-ui-plan.md` (Apple UX research, section 5): touch targets, hover and focus, reduced motion, button shapes, tooltips, corner radius. Surface and materials are out of scope.

Pages and sizes: `/` (signed out), `/docs/projects`, `/settings`, `/projects`, at 1280x800 and 375x812. Captured in headless Chrome against the dev server on port 3100. Craft level 5 to 7: Critical and Major findings, Minor ones noted.

Screenshots before the pass: `ux/before/before-<page>-<width>.png` in the session scratchpad (home, docs-projects, settings, projects).

## Findings

| Before | After (what the pass does) | Why |
| --- | --- | --- |
| Buttons are `h-8` (32px), `icon-xs` 24px, nav rows 32px, segmented tabs 28px. The only phone rule is `max-sm:h-10` (40px), keyed to viewport width, so an iPad (coarse pointer, wide viewport) gets 24 to 32px targets. 40px is also short of 44. | One `touch-target` utility on the shared button, nav rows, tabs, links and summaries: on `pointer: coarse` an invisible 44 by 44 `::after` centres on the control. Drawn size is unchanged; fine pointers are not touched. | Apple's hit-region rule is 44 by 44. Compact density only changes padding, so it cannot shrink the hit area now. Major. |
| Hover on the docs previous and next links, the docs Start here list and the usage card arrow slides the arrow 2 to 4px. | Hover changes colour only. | Motion is feedback, not decoration; frequent controls should not move. Major. |
| Press scale (`pressable`, 0.97) is on the range tabs on Resources, the activity row button and the developer summary, which are tab, row and disclosure controls. The segmented control (tabs) also scaled. | Tab-like and row controls keep a 150ms colour change only. Buttons keep the 100ms press scale (feedback for an action). | Rows, tabs and nav items should not scale. Major. |
| Reduced motion is handled well in CSS (`prefers-reduced-motion` and `data-motion`). Four scripts ignored the Settings choice: the scroll reveal, the pixel field, the smooth anchor scroll and the terminal cursor blink read only the device setting. | One helper (`src/lib/motion.ts`) reads `data-motion` first, then the device. All four use it. | `data-motion="reduce"` with a device that allows motion still animated. Major. |
| Three refresh buttons (connection alert, logs, service status) showed busy only by a spinning icon. With reduced motion the icon stops and the only cue is the greyed disabled state. | They use the shared `loading` prop: static pixel pattern, `aria-busy`, disabled. | "Reduced motion must still show the same information." Minor. |
| Button shapes disagree: the marketing header row mixes rounded rectangles (Dashboard, Sign in, theme) while the hero buttons are capsules; the 404 buttons are square. | `shape="capsule"` on the shared button; one rule written above `buttonVariants`. Header row and 404 row are capsules; the 404 phone stack is rounded rectangles. | One shape per group; capsules for single actions and rows, rectangles in stacks. Major. |
| Icon-only buttons (row menu, edit and delete icons, theme toggle, layout and theme segmented controls, GitHub link, toast dismiss, menu toggles) show no name on hover. | An icon-size `Button` with an `aria-label` gets a tooltip with that text after 500ms and on keyboard focus. Same for the segmented icon options, theme button, menu toggles and toast dismiss. | Apple shows a tooltip on icon-only buttons after a short pause. The name stays on the button. Major. |
| Focus: a 2px solid ring at 2px offset on every element Tab reaches on `/settings`, `/projects`, `/docs/projects` and `/`. Dense lists and the segmented frame use an inset ring (-2px) so the frame does not clip it. Colour follows the accent. | No change needed. | Already visible and consistent. See the report for the colour decision. |
| Corner radius: 6px on the Find box, search inputs, buttons, nav rows, segmented frames and tiles on every captured screen; cards are `rounded-lg`. | No change. | No inconsistency to fix on a single screen. |

## Design lens (hierarchy, clarity, signature)

- Home: the pixel headline is the one thing you see first; two CTAs follow. The primary is dark, the second is outlined. Clear at five seconds. At 375 the two capsules stack, which reads as a wrapped row. Fine.
- Projects: one blue accent (New project) on an otherwise grey page, so the primary action is obvious. The status strip and the red dots under "Needs attention" carry the urgency. No anti-slop items found (no gradients, no emoji, no glass).
- Settings: inset grouped cards, left-aligned, one input and a tile grid. The page is calm. The character tiles and accent tiles are the only chunky controls.
- Docs: the sidebar, the page and the "On this page" column keep two levels. Minor: the heading anchor links are 24px and only show on hover or on coarse pointers.
- Signature detail: the lit square in the active nav row, and the pixel grid on public pages. Both stay.

## Craft Report

- Checked: Anti-Slop, Craft Test, Hierarchy, Clarity, Signature, at the 5 to 7 bar. The UX lenses above were checked against the code and in the browser (touch target audit with a coarse pointer, Tab walk, reduced motion).
- Passed: focus visibility, radius consistency, left alignment, the CSS reduced-motion rules, no horizontal scroll at 375.
- Changed: nothing by this critique. The pass that follows records its changes in the report.
- Left alone: dense data controls (filters, table and row actions, search fields, selects), the app empty-state and form buttons, the heading anchor links.
- Verdict: the app was close to the spec on focus, radius and CSS motion; the gaps were touch targets on wide coarse screens, a few hover slides, four scripts that ignored the Settings motion choice, mixed button shapes and missing icon tooltips.
