"use client";

import dynamic from "next/dynamic";

/**
 * The creature field behind the hero is decoration, so it is its own chunk and only ever loads in
 * the browser, after the headline and buttons (which the server renders) are on screen. Until it
 * arrives, and without JavaScript, the hero shows the plain page grid.
 */
const HeroField = dynamic(() => import("./hero-field"), { ssr: false });

export function HeroFieldLoader() {
  return <HeroField />;
}
