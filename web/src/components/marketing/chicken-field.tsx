"use client";

import { useEffect, useRef } from "react";
import { motionReduced } from "@/lib/motion";
import { createField } from "./field/engine";
import "./chickens.css";

/**
 * The chickens: a fixed canvas over the public pages, drawn and driven by field/engine.ts. They
 * walk over the whole page, keep out of the text, come to the pointer, can be poked, stroked,
 * picked up and thrown, and run for seed dropped with a click.
 *
 * It is decoration: hidden from assistive technology, never focusable, and it takes no pointer
 * events (the engine listens on the window). With reduced motion it draws one still picture.
 */
export default function ChickenField() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const field = createField(canvas.current!, motionReduced());
    return () => field.destroy();
  }, []);

  return <canvas ref={canvas} aria-hidden="true" className="chicken-canvas" />;
}
