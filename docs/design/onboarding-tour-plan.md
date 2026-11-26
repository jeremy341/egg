# Plan: a guided first project (spotlight onboarding)

Status (2026-11-13): planned. The accessibility spike is done and confirms Driver.js behind our own wrapper; see `onboarding-spike-results.md`. The product itself is not built yet.

A new user who wants to put a project on their Nest container is walked through it. Each step darkens the rest of the screen and points at the one thing to use, with a short sentence beside it.

## Who it is for, and what it is not

- **For:** someone who has just signed in, owns a Nest container and a GitHub repository, and has no server and no project in Egg yet.
- **Goal:** from first sign-in to "my app answers at an address I can open" without leaving the tour to read docs. Egg's own steps take about five minutes; the two parts on the Nest dashboard (adding the key, and pointing a domain at the app's port) are the slow ones.
- **A fact the tour has to respect:** Egg does not route traffic. Nest does, on its own dashboard, and that step has no API (see `web/src/server/domains.ts`). So when the first deployment is ready, the app is running on a port inside the container but has no address yet. The tour must not say "live" until an address works.
- **Not for:** anyone who already has a server or a project. They never see it unasked. A replay link is the only way in for them.
- **Not in the first version:** a checklist panel, videos, tours of settings pages, analytics, domains, environment variables. Those come up as "what next" links at the end.

## What the research says

Checked directly (npm registry, bundlephobia, the libraries' own docs):

| Library | License | Version | Gzipped | Notes |
| --- | --- | --- | --- | --- |
| [Driver.js](https://driverjs.com/docs/configuration) | MIT | 1.12.1, updated 2026-11-12 | about 14 KB | No dependencies. Has action steps (advance when the user does the thing), waits for an element to appear, handles an element that goes missing, keyboard control, a labelled close button. Docs do not say how it handles focus trapping, focus return or reduced motion. |
| [React Joyride](https://www.npmjs.com/package/react-joyride) | MIT | 3.2.0 | about 26 KB | Peer range covers React 19. React only. |
| [Shepherd.js](https://www.npmjs.com/package/shepherd.js) | **AGPL-3.0** | 16.0.0 | about 11 KB | Praised for accessibility, but AGPL needs a commercial license for non-AGPL use. Ruled out. |
| [Intro.js](https://www.npmjs.com/package/intro.js) | **AGPL-3.0** | 8.6.0 | n/a | Same problem. Ruled out. |
| [Reactour](https://www.npmjs.com/package/@reactour/tour) | MIT | 3.8.0, last updated 2025-05 | n/a | Less recently maintained. |

Several comparison articles say Driver.js is about 4 KB. The measured figure is about 14 KB gzipped, so those articles are out of date or count something else. The articles are mostly written by vendors of competing tools, so only the registry and the docs were used for facts.

Practitioner advice (vendor blogs, so anecdotal, no controlled studies): [3 to 5 steps per tour](https://www.appcues.com/blog/user-onboarding-guide); a visible skip on every step that stays in the same place; let people leave and come back; [tie steps to what the user does](https://chameleon.io/blog/ux-onboarding-examples) rather than to page load; a checklist suits products with several goals, a tour suits one goal. Egg has one goal for this audience, so a tour fits.

How the competitors start people: [Vercel's flow](https://getperspective.ai/blog/vercel-ai-native-customer-onboarding-developer-teams) asks the user to point at something they already own (a repository) and ends on a shareable URL, with no tour at all. [Railway](https://docs.railway.com/platform/compare-to-vercel) and Render also start from "pick a repository". Egg's flow is the same shape, with one extra stage first (connect the container), so the tour mostly points out an existing flow and does not replace it. (Secondhand sources; no screen-level teardown of those products was found.)

Accessibility: [WCAG 2.2 criterion 2.4.11](https://www.tabnav.com/academy/wcag/success-criterion-2.4.11) (AA) fails when a focused control is entirely hidden by author-created content, so the dimming layer must never cover the control that has focus. Dialog focus rules (move focus in, return it on close, no trap that cannot be left) come from the ARIA Authoring Practices dialog pattern, which was **not** retrieved in this research and must be read before building. Driver.js is not documented as handling them, so the plan includes a spike.

Hack Club's own platform [Orchard](https://orchard.infra.hackclub.com) lists a `/tour/greenhouse` screen in its page data, so it has a tour for at least one feature. Its content is rendered by script and was not read.

## Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Shape | Four short chapters, each 2 to 6 steps, started by where the person is and not by a fixed sequence. | Fits the 3 to 5 guidance, survives leaving for the Nest dashboard, and works across two page layouts. |
| Where is progress kept | Not kept. The current step is worked out from the data: servers, their status, projects, deployments. Only "done" and "skipped" per chapter are stored. | A stored step number can disagree with reality (the key was removed, the project deleted). Data cannot. Closing the tab, or coming back tomorrow, just works. |
| Library | Driver.js, loaded only when a chapter starts, behind a thin wrapper of our own. | Smallest of the permissive options, and its action steps do the hard part (wait for the person to act). Our wrapper adds focus, labels and reduced motion, and keeps a swap possible. If the spike shows the gaps cannot be patched, build the overlay ourselves (about 250 lines: one SVG mask and a Base UI popover). |
| Where progress is stored | A new `onboarding` text column on `user_preferences` (a JSON object), with its own small route. | Follows the person across browsers; clearing site data does not restart the tour. |
| Automatic start | Chapter 1 starts once for a user with no server. Chapters 2 and 3 start by themselves only if the chapter before was completed, not skipped. | Skipping means "leave me alone". A quiet "Take the tour" link stays in the empty states. |
| Tracking | None. | Egg's privacy stance is no tracking of its own users. The funnel (has a server, has a project, has a ready deployment) can be counted from existing tables on the admin page. |
| Existing users | Never started for them. | They already know the product. |

## The journey

Prerequisite outside Egg: a Nest account. The Nest dashboard cannot be dimmed or highlighted, so that step is text and a link, and the tour waits.

Anchors are `data-tour="..."` attributes added to existing elements, never ids or classes, so restyling cannot break a step. Copy follows the app's rules: sentence case, plain words, no exclamation marks.

### Chapter 1: connect your container (pages `/projects` then `/connect`)

Starts when the user has no server. Done when a server reaches "connected".

| # | Anchor | Title and text | Moves on when |
| --- | --- | --- | --- |
| 1 | none (centred) | **Put your app on Nest.** Egg builds your GitHub repository and runs it on your Nest container. It takes about five minutes. We will point at each thing to press. Buttons: Start, Not now. | Start |
| 2 | `connect-server` (the button in the empty projects page) | **Connect your container first.** Egg needs a way in. This sets it up. | The person presses it, which opens `/connect` |
| 3 | `nest-username` | **Your Nest username.** The name you log in with, as in `ssh username@hackclub.app`. Then press Create key. | A key appears for that server |
| 4 | `public-key` | **Add the key in Nest.** Copy it, open the Nest dashboard with the link below, and paste it on the SSH Keys page. Then come back. We will wait here. | Next. If they leave, the chapter resumes here because the server exists and is not connected |
| 5 | `test-connection` | **Test the connection.** Egg connects once and checks what your container can run. | The server shows as connected |
| 5b | `host-key` (only if the first connection asks to confirm) | **Check the fingerprint.** Compare it with the one Nest shows for your server. Confirm only if they match. Egg refuses any other key afterwards. | The person confirms by themselves. The tour highlights the fingerprint text and never the Confirm button, and never advances on a click it did not see |
| 6 | none (centred, short) | **Connected.** Next, pick a repository. Button: Continue (goes to `/new`, which begins chapter 2). | Continue or Close |

If the test fails, the tour does not advance. The failure message that Egg already shows stays on screen, and step 5 changes to **That did not work.** with the one-line reason and a link to the connecting guide.

### Chapter 2: import a repository (page `/new`)

Starts when a server is connected and there are no projects. Done when a project is created.

| # | Anchor | Title and text | Moves on when |
| --- | --- | --- | --- |
| 1 | `repo-source` (one of three, depending on the state) | A: GitHub App installed. **Pick your repository.** Search, then press one. B: App configured, not installed. **Connect GitHub.** This lets Egg read your repositories and deploy on every push. C: No GitHub App (local mode or a self-hosted instance). **Paste a repository URL.** A public one works without any setup. | A repository is chosen, or Continue is pressed on a URL |
| 2 | `project-settings` | **Check what Egg found.** It guessed the name, runtime and port from your repository. Change anything that is wrong. | Next |
| 3 | `container-conflicts` (only when conflicts are listed) | **Something is already on your container.** Items marked as blocking stop the deploy until you deal with them. Egg never changes anything it did not create. | Next |
| 4 | `deploy` | **Deploy.** Egg builds on your container and starts the app. You can watch it happen. | The person presses Deploy, which opens the deployment page |

### Chapter 3: the first deployment (page `/projects/<slug>/deployments/<id>`)

Starts on arriving from chapter 2 for a project with one deployment. Done when that deployment is ready, or when the person closes it.

| # | Anchor | Title and text | Moves on when |
| --- | --- | --- | --- |
| 1 | `build-logs` | **Watch it build.** This is the live output from your container. A first build usually takes a few minutes. You can leave this page; the tour will not block you. Button: Got it. | Got it |
| 2 | `deployment-status` (when the state turns ready) | **Your app is running.** It listens on port {port} inside your container. It has no web address yet. The next step gives it one. Button: Give it an address (opens `/domains`, which begins chapter 4). | The button, or Close |

If the build fails, step 2 is replaced by **The build failed.** pointing at the error summary, with "read the last lines of the log" and a link to the troubleshooting page. The chapter is then marked paused, not done, so a later successful deploy can finish it.

### Chapter 4: give it an address (page `/domains`)

Starts after chapter 3 was completed, or on its own for a person with a ready deployment and no domain. Done when a domain for the project shows as active. The two parts that happen on Nest's own dashboard cannot be dimmed, so they are text and a link, and the chapter waits for the person to return.

| # | Anchor | Title and text | Moves on when |
| --- | --- | --- | --- |
| 1 | `domain-form` | **Choose an address.** Use `your-nest-name.hackclub.app` (or a subdomain of it), which Nest hands out with no DNS setup, or a domain you own. Pick this project; the port is the one it listens on. | The domain is saved |
| 2 | `domain-steps` | **Do this in Nest.** Egg cannot change Nest's routing, so this one step is yours. The steps below are exact: open the Domains page in the Nest dashboard and enter the same domain and port. Then come back and press Check. | Next. The chapter resumes here if they leave |
| 3 | `domain-check` | **Check it.** Egg looks at DNS and tells you whether it points here. | The domain shows as active |
| end | `visit` (on the deployment page) | A small card: **Your app is live at the address you chose.** Button: Open it. Below it, **What next**: add environment variables, set up a deploy hook, turn on analytics. | Closed |

If the check does not pass, the tour does not advance. The status the domains page already shows ("Waiting for DNS", "Needs attention") stays visible and the step says the same thing in one line, with the link to the domains guide.

Counts: 7 + 4 + 2 + 3 steps with 3 conditional ones, so a typical person sees about 14 steps in four short sittings, never more than 6 in one. Each sitting stays inside the 3 to 6 guidance.

## Rules of behaviour

- Every step has Skip tour (same place, same label), Back where it makes sense, and Escape closes. Closing a chapter marks it skipped and shows nothing again until replayed.
- "Show me again" appears in the empty states, in the account menu and on the docs page for getting started. It clears that chapter's mark and starts it from wherever the data says the person is.
- A step whose target is missing waits up to two seconds, then is skipped quietly. A tour never blocks the page behind it.
- Steps that ask the person to act leave the target clickable. Steps that explain do not.
- Moving to another page ends the current segment cleanly. The host component on the next page works out the segment again from the data. No tour state lives in memory across pages.
- Nothing starts while a dialog is open, on a page that is still loading, or within the first second after a page loads.

## Look and feel

- The dimming layer uses the theme's own tokens so it reads right in all 21 themes and in custom ones. It is about 60% opaque in light themes and a little stronger in dark ones. The cut-out has the target's corner radius plus 6 px of padding.
- The popover is a normal Egg card: the same radius, the `shadow-border-small` edge, `text-title-3` for the title, body text at the app's default size, a small "2 of 5" at the left of the buttons. No new colours, no illustrations in the first version.
- Layer: above the top bar (30) and menus (50), below dialogs (300) and toasts (350). One new token between them, for example `--z-tour: 200`, added next to the existing scale in `globals.css`.
- Motion: the cut-out slides between steps in about 250 ms. With "reduce motion" on (the app's own setting or the system one) it jumps, and the popover fades in without moving.
- Phones: the popover docks to the bottom of the screen instead of floating next to the target, and the target is scrolled into the upper half. No step points at the sidebar, which phones do not show.

## Accessibility

- The popover is a non-modal dialog (`role="dialog"`, `aria-modal="false"`) with its title as its label and its text as its description. It is not a focus trap, because the person has to be able to reach the highlighted control.
- Focus: on a step that explains, focus goes to the popover's primary button. On a step that asks for an action, focus goes to the target control and the instruction is announced through a polite live region. Tab moves through the popover buttons and the target and then on to the page. Closing returns focus to the element that had it before the tour started, or to the page heading if that is gone.
- The dimmed area never covers the focused control (WCAG 2.4.11). The overlay does not intercept the keyboard.
- A screen reader hears the step title and text and "step 2 of 5" when a step changes. The overlay itself is hidden from the accessibility tree.
- Reduced motion, contrast of the popover in every theme, and touch targets of at least 44 px for the buttons on phones are checked as part of the work.
- These behaviours are designed here, not yet tested. The spike below tests them with the keyboard only, with VoiceOver or NVDA, and at 200% zoom before any chapter is built on top.

## Technical design

### Files

- `web/src/lib/onboarding.ts`: pure code, no React. The chapter and step definitions (copy, anchor names, conditions), `selectSegment(path, facts, saved)` that returns which segment should run or nothing, and the types. This is the testable core.
- `web/src/components/onboarding/host.tsx`: the client component mounted once in the dashboard layout and once in the new-project layout (they are separate layouts, so it is mounted twice). It reads the facts from props, watches the route, and starts the segment the pure function returns.
- `web/src/components/onboarding/tour.ts`: the wrapper around Driver.js. It loads the library on demand, applies the theme and motion settings, sets the dialog roles and labels, handles focus, and exposes `start(segment)`, `stop()`.
- `web/src/components/onboarding/onboarding.css`: the popover and overlay styling with tokens.
- `web/src/server/onboarding.ts`: reads and writes the saved marks, and computes the facts (server count and status, project count, whether the first deployment is ready). One small query each.
- `web/src/app/api/onboarding/route.ts`: `PUT { chapter, status }` and `DELETE { chapter }`. Same-origin check and validation like the other routes.
- `web/drizzle/0036_onboarding.sql`: one column, `onboarding text not null default '{}'` on `user_preferences`. It holds a mark for each of `connect`, `import`, `deploy` and `address`.
- One small product change the tour needs: in the domains form, choosing a project fills in its port (today the field is empty with "3000" as a placeholder), so a first-timer does not have to find it.
- Small edits to existing components to add `data-tour` attributes: the projects empty state, the connect form, the key field, the new-project flow, the deployment page, the domains form and its steps.

### The facts the host needs

```
{ servers: [{ status }], projectCount, firstDeployment: { projectSlug, state } | null }
```

plus `domains: [{ status }]` for the project in question, for chapter 4. They come from the layouts' existing server queries. After the person creates a key, tests a connection or saves a domain, the page already calls `router.refresh()`, which re-sends the facts, and the host picks the next step without extra code. Creating a project navigates to the deployment page, which sends fresh facts too.

### Keeping steps from rotting

A test reads every anchor name used in `lib/onboarding.ts` and fails unless a `data-tour` attribute with that name exists in the components. Renaming or deleting a button then breaks a test, not the tour.

### Tests

- Pure: `selectSegment` for every combination of facts, saved marks and path, including "skipped chapter does not start the next one by itself" and "existing users never start".
- Route: validation, same-origin refusal, ownership (a person can only write their own marks), reset.
- Anchors: the check above.
- The wrapper's motion and focus behaviour is checked in a real browser with screenshots, not by unit tests.

## Edge cases

| If this happens | The tour does this |
| --- | --- |
| The person closes the tab mid-chapter | Resumes from the data next visit |
| They are sent to the Nest dashboard and come back | Resumes at the key or at the test step |
| The key test fails | Stays on the step, shows the failure and a link, never advances |
| The host key needs confirming | Highlights the fingerprint, never the Confirm button |
| The target is not on the page | Waits two seconds, then skips the step |
| The person already has a server in another browser | Chapter 1 does not start |
| They have two servers | Highlights the first one that is not connected |
| There is no GitHub App on this instance | Variant C of chapter 2, no mention of installing it |
| Local mode (no Hack Club sign-in) | Same flow, no copy that mentions Hack Club sign-in |
| The container is not ready (conflicts or missing tools) | The conflicts step explains blocking items in the words the page already uses |
| A build takes ten minutes | The tour does not wait on it; chapter 3 step 2 appears when the page shows ready |
| The build fails | A failure step with the error summary; chapter marked paused, finished by a later ready deployment |
| The app is ready but has no address | Never says "live". Chapter 4 explains the Nest dashboard step |
| Nest's pages change from what the steps describe | The steps point at the Nest dashboard by link and say what to enter, not where to click inside it |
| The domain check keeps failing (DNS takes time) | The step says so, offers Check again, and the chapter stays open; nothing is marked done |
| The person deletes the project and starts again | Chapter 2 starts again only if its mark is not set |
| A dialog, toast or the find palette is open | The tour waits and does not draw over it |
| Keyboard only, screen reader, 200% zoom | Covered by the spike and the final check |
| Phone | Docked popover, target scrolled up |
| Custom theme with unusual colours | Overlay and popover use tokens, checked in the theme editor's presets |
| Reduced motion | No slide, instant cut-out |

## Build plan

Order, with who does it (the rule used this round: Haiku for backend, Sonnet for UI, Fable plans, reviews and checks screenshots):

1. **Spike (done 2026-11-13).** Driver.js kept, with a wrapper that adds the fixes listed in `onboarding-spike-results.md`. A real screen reader, Firefox and Safari are still to be tried before release.
2. **Backend (Haiku).** Migration `0036`, `server/onboarding.ts`, the route, the facts query, tests. No UI.
3. **Core logic (Sonnet).** `lib/onboarding.ts` with the copy above and its tests, including the anchor check.
4. **Chapter 1 (Sonnet).** Host, wrapper, CSS, anchors on the projects and connect pages, replay link. Review with screenshots in light, dark, a custom theme and a phone width.
5. **Chapters 2, 3 and 4 (Sonnet).** Anchors on the new-project flow, the deployment page and the domains page, the three variants, the failure step, the "What next" card.
6. **Docs (Sonnet).** A "Getting started" page in the in-app docs that mirrors the three chapters in text, and the replay entry in the account menu.
7. **Review (Fable).** Read every diff, run the whole suite, and walk the real flow once against the mock container with screenshots of each step.

Acceptance: a person with no server and no project can get from sign-in to an address that opens their app using only the tour (the two steps on the Nest dashboard being the person's own); skipping at any step leaves the app normal; the tour never covers the focused control; nothing is stored or sent except the three marks; all tests and lint pass.

Risks: Driver.js focus handling may need more patching than expected (the spike answers that); a step's anchor can disappear in a redesign (the anchor test catches it); the Nest dashboard step is outside our control, so its copy depends on Nest's pages staying as described.

## Questions for the owner

1. Driver.js behind our wrapper (recommended), or build the overlay ourselves from the start?
2. Should chapter 2 start by itself when someone already has a connected server but no project, even though they never saw chapter 1? Recommended: yes, once, because they are in the same position as someone who finished chapter 1.
3. Is a persistent "Getting started" checklist wanted later? Recommended: not in the first version. The empty states and the replay link cover the same ground.
