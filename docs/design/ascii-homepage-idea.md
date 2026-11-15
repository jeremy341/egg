# Interactive ASCII homepage (idea, not built)

Status: idea expanded on 2026-11-14. Nothing is built or decided. It is queued behind the roadmap work in progress.

## Where the idea comes from

The owner saw a short video by another creator of a browser start page where every creature (butterfly, jellyfish, dragonfly, koi, frog, crane, crab) is drawn from keyboard characters, in colour, and reacts to the cursor. The owner works from two screenshots of it, not the video, so the motion described below is inferred from the stills and the caption ("every single one is made of keyboard characters"). What the stills show:

- Pink pixel-block jellyfish, with a trail of small bracket and brace characters behind each one, drifting across a dark grid.
- A cursor among them, so the creatures respond to it.
- A pill-shaped tab row at the top that switches the creature: Butterfly, Jellyfish, Dragonfly, Koi, Frog, Crane, Crab.

This is the other creator's design. Egg must not copy its look, layout, tab row, colours or creature set one to one. The idea we take is the technique and the feeling: a living field of characters that follows the pointer. The creatures, palette and behaviour have to be Egg's own.

## What it could be for Egg

The homepage hero keeps its words and layout (headline, lead, two buttons). Behind and around it, the grid becomes a living canvas of coloured characters instead of a still grid.

### Egg's own subject matter

Instead of animals, the field is made of things Egg does. A push is a small trail of characters that travels across the grid to a lit cell. That makes the art explain the product:

1. **Idle:** a slow drift of dim characters on the grid, almost still.
2. **Cursor:** characters near the pointer light up and bend away from it, then settle.
3. **Click or tap:** a "push": a trail of characters runs from the click to the nearest lit target and the target lights up (a release going live).
4. **The failed deploy:** an occasional trail stops short, the target flashes an outlined cell, and the old target lights again. This is the rollback story in one gesture.
5. **Keyboard:** typing a few letters could spell into the field (for example the letters of "egg" forming from characters), as a small reward for people who try.

Egg's pixel egg (the 5 by 6 pixel mark) could be the one creature: it hatches from the field on click. One recognisable creature is stronger than seven.

### Colour

The owner removed the yellow accent and said the page "screams AI". This idea only works with colour, so the palette needs a deliberate decision before building: a small fixed set (for example one hue for "live", one for "building", one for "failed", ink for everything else) used only on the characters, with the page text staying black and white. The colours must be readable as shapes and state on both the light and dark page, and state must never rely on colour alone (the failed trail also changes shape).

## How it would be built

- **Rendering:** a single `<canvas>` behind the hero, drawing characters in a monospace font on the existing 30px grid cell size so it lines up with the page grid. No new library. A character grid of the hero's size (about 48 by 30 cells on a laptop) is small, so a plain 2D canvas is enough.
- **Simulation:** a tiny particle system (positions, velocity, a character per particle, a colour per state). Pointer and click are the only inputs. Around 150 to 400 particles at most.
- **Loading:** the canvas code is a separate client chunk loaded after the page is interactive, so the headline and buttons paint first. Until it loads, and with JavaScript off, the page shows today's static grid. Nothing is lost.
- **Performance budget:** 60 fps on a mid-range phone, under 20 KB of script, no work while the tab is hidden or the hero is off screen (IntersectionObserver and page visibility), and a lower particle count on small screens and on battery saver where the browser exposes it.
- **Reduced motion:** with the device setting `prefers-reduced-motion: reduce` (and the site's own `data-motion` switch, see the bottom of `home.css`), the field is drawn once as a still frame and does not move. Interaction becomes click to place one static "push" trail, with no animation.
- **Accessibility:** the canvas is decorative (`aria-hidden`), carries no information the text does not also carry, never takes focus, and does not capture scroll or touch gestures (`touch-action` stays default). Text over it keeps its contrast because the field is kept dim behind the text area. The characters are not text for screen readers.
- **Mobile:** touch is the cursor. A tap does the push gesture. No hover-only behaviour.
- **Theme:** two palettes, light and dark, from CSS variables, read by the canvas when the theme changes.

## Risks and open questions

- **Copying.** The reel's look is someone else's work. The creature set, the tab row and the pink jellyfish must not appear. Egg's version is a field of deploy trails and one egg.
- **AI-looking.** The owner already rejected pill toggles and decorative effects. A character field is decorative unless it carries the product story, so every behaviour above ties to a real Egg event (push, live, failed, rollback). If a behaviour does not, cut it.
- **Distraction and trust.** Egg holds an SSH key with root reach. A playful field is fine in the hero, but the trust section and everything below stay plain.
- **Battery and low-end devices.** Needs a hard frame budget and an automatic fallback to the still frame.
- **Colour.** Needs the owner's decision on the palette (see above) before any build.
- **Scope.** The hero's layout stays as the owner likes it. Only the background behind it changes.

## Suggested steps

1. Owner decisions: one creature (the egg) or several; the palette; whether typing spells into the field.
2. A one-day prototype as a standalone page outside the homepage route, so the owner can look at it and judge feel before it touches the real page.
3. Performance and accessibility pass on the prototype (frame time on a phone, reduced motion, no-JS fallback, contrast of the hero text over the field).
4. Replace the hero background on the real homepage behind a single component, with the static grid as the fallback.

## Not verified

- Anything about the reel's video: only two screenshots were available.
- Frame rates on real phones.
