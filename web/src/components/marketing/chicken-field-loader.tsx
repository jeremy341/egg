"use client";

import dynamic from "next/dynamic";

/**
 * The chickens are decoration, so they are their own chunk and only ever load in the browser,
 * after the page's text is on screen. Until they arrive, and without JavaScript, the page is just
 * the plain grid.
 */
const ChickenField = dynamic(() => import("./chicken-field"), { ssr: false });

export function ChickenFieldLoader() {
  return <ChickenField />;
}
