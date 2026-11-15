"use client";

import { useEffect, useRef, useState } from "react";
import { motionReduced } from "@/lib/motion";
import { SPECIES } from "./field/creatures";
import { createField, type Field } from "./field/engine";

/** Focus on any of these means a key press belongs to that element, not to the field. */
const BUSY = "input, textarea, select, button, a[href], summary, [contenteditable], [role='button'], [role='textbox']";

/**
 * The living background of the hero: a canvas of creatures (see field/engine.ts), a row of
 * buttons to pick the creature, a line that says what the controls are, and a button that hides
 * the hero text so the field can be watched alone.
 *
 * The canvas is decoration: hidden from assistive technology, never focusable, and it takes no
 * pointer events, so text selection, links and touch scrolling work through it. A click or tap
 * anywhere in the hero that is not a link or a button scatters the creatures. Keys 1 to 6 pick a
 * creature and H hides or shows the text, only while the hero is on screen and focus is not in a
 * field or on some other control, and never together with Ctrl, Alt or the Meta key.
 */
export default function HeroField() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const field = useRef<Field | null>(null);
  const [current, setCurrent] = useState(0);
  const [shown, setShown] = useState(true);

  useEffect(() => {
    const hero = canvas.current!.closest("section")!;
    const zones = Array.from(hero.querySelectorAll<HTMLElement>("[data-field-zone]"));
    const made = createField(canvas.current!, zones, 0, motionReduced());
    field.current = made;

    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("a, button")) return;
      made.scatter(e.clientX, e.clientY);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.altKey || e.metaKey || !made.onScreen()) return;
      const focus = document.activeElement;
      if (focus && !bar.current?.contains(focus) && focus.matches(BUSY)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= SPECIES.length) setCurrent(n - 1);
      else if (e.key === "h" || e.key === "H") setShown((v) => !v);
    };
    hero.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      hero.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKey);
      hero.removeAttribute("data-ui");
      made.destroy();
      field.current = null;
    };
  }, []);

  useEffect(() => field.current?.set(current), [current]);
  useEffect(() => {
    field.current?.ui(shown);
    canvas.current?.closest("section")?.setAttribute("data-ui", shown ? "on" : "off");
  }, [shown]);

  return (
    <>
      <canvas ref={canvas} aria-hidden="true" className="cf-canvas" />
      <div ref={bar} className="cf-bar" data-shown={shown}>
        <p className="cf-hint" data-field-zone="">
          <span className="cf-fine">
            Click the grid and they scatter. Keys 1 to {SPECIES.length} switch, H hides the text.
          </span>
          <span className="cf-coarse">Tap the grid and they scatter.</span>
        </p>
        <div className="cf-controls" data-field-zone="">
          <div role="group" aria-label="Creature in the background" className="cf-switch">
            {SPECIES.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={i === current}
                onClick={() => setCurrent(i)}
                style={{ "--sw-d": s.ramp.dark[3], "--sw-l": s.ramp.light[3] } as React.CSSProperties}
              >
                <span aria-hidden="true" className="cf-sw" />
                <span aria-hidden="true" className="cf-key">
                  {i + 1}
                </span>
                <span className="cf-name">{s.name}</span>
              </button>
            ))}
          </div>
          <button type="button" className="cf-toggle" onClick={() => setShown((v) => !v)}>
            {shown ? "Hide text" : "Show text"}
            <span aria-hidden="true" className="cf-key">
              H
            </span>
          </button>
        </div>
      </div>
    </>
  );
}
