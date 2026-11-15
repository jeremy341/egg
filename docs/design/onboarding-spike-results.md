# Onboarding spike: results

Run 2026-11-13. Question: can Driver.js carry the guided first-project tour (see `onboarding-tour-plan.md`), or should Egg draw its own overlay?

**Answer: use Driver.js behind a thin wrapper. Nothing needs to be built from scratch.** Every gap found was small and fixed in the wrapper or in CSS, listed below. The spike code is on the branch `spike/onboarding-driverjs` (commit `03caa35`); it is a test harness and should be rebuilt cleanly, not merged.

## What was built

- `web/src/components/onboarding/tour.ts`: the wrapper. Loads Driver.js and the styles only when a tour starts.
- `web/src/components/onboarding/onboarding.css`: popover styles from the app's tokens.
- `web/src/components/onboarding/spike.tsx`: a demo that starts on `?tour=1`: a welcome step, a step on the "Connect a server" button, and a step on the Nest username field of `/connect`.
- `data-tour` attributes on the button and the field.
- Driver.js 1.12.1 added as a dependency (MIT, no dependencies of its own).

## How it was tested

Headless Edge driven over the DevTools protocol: real key presses (Tab, Shift+Tab, Enter, Escape, arrows, Backspace, Space), real typing, the accessibility tree, computed styles, screenshots. Signed in as a brand-new user with no server, so the empty state shows. Screenshots are in `reference/spike-onboarding/` (ignored by git).

## What worked as it is

| Check | Result |
| --- | --- |
| Dim the page and cut out one element | Works. The target stays clickable; the rest cannot be clicked. The cut-out follows the element's shape. |
| Accessibility tree | The popover is exposed as a dialog with its title as the name and its text as the description. The buttons have names. (Driver.js adds the description link itself; we add the role and the label.) |
| Initial focus on an explaining step | Lands on the main button, with the patch below. |
| Tab inside the tour | Cycles through the popover buttons and the highlighted element only. It cannot wander onto the dimmed page. |
| Typing in a highlighted field | Letters, arrow keys, Backspace and Space reach the field. The tour does not move on and the text is intact. |
| Closing with Escape on a normal step | Works, and focus returns to what had it before. |
| Text contrast in five themes | 4.97 to 17.93 for the title, the progress text, the Skip tour button and the main button, in Egg light, Egg dark, Nord, Rosé Pine Dawn and Gruvbox dark. All meet the 4.5 minimum for text. |
| 200% zoom (a 640 by 400 viewport at twice the scale) | The popover fits and does not cover the target. |
| Phone (375 wide, touch emulation) | The popover fits and sits clear of the target. With the touch rule in the CSS the buttons are 44 px tall. |
| Reduced motion, every combination | The app's setting overrides the device setting both ways: app "reduce" on a normal device turns animation off; app "no preference" on a reducing device keeps it; "system" follows the device. Checked with the real preference saved through the API. |
| Size | Library about 14 KB gzipped, styles about 2 KB. Loaded on demand through a dynamic import, so no page pays for it until a tour starts. (The lazy loading is by construction; the built chunk was not measured.) |

## What did not work, and the fix

| Problem found | Fix in the wrapper or CSS |
| --- | --- |
| Escape does nothing while a text field has focus, which is exactly where an action step puts focus. A keyboard user could only leave by tabbing to Skip tour. | Our own Escape listener, in the capture phase, closes the tour from anywhere. Verified: popover and overlay go, focus stays in the field, the text is kept. |
| The tour stays on screen after a client-side page change. After pressing the highlighted link the overlay and popover were still there on the next page. | The host component ends the tour whenever the route changes. Verified in the spike. This is a requirement of the real host. |
| An action step still shows a Done button on its last step, which would end the tour without the action. | Hide the Next/Done button on action steps. Verified. |
| On an action step Driver.js puts focus on the popover box itself, not on the thing the person has to use. | Focus the target on action steps and announce the instruction through a polite live region. Verified: focus lands in the Nest username field and the message is in the region. |
| Close button is a bare cross. | Visible text "Skip tour", which is also its accessible name. |
| The close button overlapped long titles. | Title gets right padding for it. |
| Popover and overlay at the same stacking level: the overlay is later in the page and dimmed the popover (found in a screenshot, not by the checks). | Overlay at 200, popover at 201. Verified in screenshots. |
| Driver.js styles the popover as a white card with `all: unset` on every part, which is wrong in dark and custom themes. | Every part restated with tokens. Verified in five themes. |
| Buttons 24 px tall on a phone. | 44 px under `(pointer: coarse)`. Verified under touch emulation. |

Driver.js itself already does more than its documentation says: it sets the description relation, manages focus when the focused button is disabled, has a polite live region (used for action steps only), cancels pointer events outside the target, and has reduced-motion rules for its own nudge animation. It does not set a dialog role, a label or `aria-modal`, and its `animate` option is JavaScript, not CSS, so the app's reduced-motion rule does not reach it. Both are handled.

## Findings that change the plan

1. **The host must end the tour on every route change** and start the right segment for the new page. This matches the plan, and is now a tested requirement.
2. **Popover placement matters.** On `/connect` the popover sat on top of the helper text under the field. Each step needs a chosen side (`top`, `right`, and so on) checked in a screenshot, not left to the default.
3. **Driver.js draws in the browser's top layer** (its wrapper uses `::backdrop`), so the tour would sit above Egg's dialogs and toasts whatever the z-index. The plan's rule "never start while a dialog is open" is therefore required, not optional.
4. **A centred welcome step traps Tab between two buttons.** That is right for a step with nothing to act on. It is the only trap, and Escape and Skip tour both leave it.

## Not tested, so not claimed

- **No screen reader was run.** VoiceOver or NVDA on a real device has to be tried before release. What was checked is what the accessibility tree contains, which is necessary but not enough.
- **Only Chromium (Edge) was used.** Firefox and Safari were not.
- **No real touch device,** only emulation.
- **Keyboard behaviour on Windows high-contrast mode** and with custom themes using extreme colours was not checked.
- The demo covered three steps on two pages. The multi-step chapters, conditional steps and the waiting behaviour of the real flow are not exercised yet.

## Next

Proceed with step 2 of the build plan (backend), then rebuild the wrapper cleanly from this spike with the fixes above, and add the Escape, route-change, action-step and stacking behaviours as tests where they can be tested without a browser, and as a short browser checklist where they cannot.
