"use client";

import { useEffect, useRef } from "react";
import { motionReduced } from "@/lib/motion";
import { createField } from "./field/engine";
import "./chickens.css";

/**
 * The chicken: a fixed canvas over the public pages, drawn and driven by field/engine.ts. It
 * stands on the bottom of the window, turns up and leaves, dashes about, and reacts to the
 * pointer the way Orry does on the LOADOUT homepage (poke, tickle, pet, pinch, pick up, throw).
 * The footer button (chicken-toggle.tsx) sends it away for good.
 *
 * It is decoration: hidden from assistive technology, never focusable, and it takes no pointer
 * events (the engine listens on the window). With reduced motion it draws one still picture.
 */
export default function ChickenField() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const field = createField(canvas.current!, motionReduced(), new URLSearchParams(window.location.search));
    return () => field.destroy();
  }, []);

  return <canvas ref={canvas} aria-hidden="true" className="chicken-canvas" />;
}
