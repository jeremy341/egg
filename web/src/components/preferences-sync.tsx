"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import {
  applyAppearance,
  currentCustomThemes,
  readAppearance,
  readAppearanceCookie,
  rememberCustomThemes,
  storeAppearance,
  type KnownTheme,
} from "@/components/appearance";
import { DEFAULT_APPEARANCE, themeMode, type Preferences } from "@/lib/preferences";

const KEYS = ["matchDevice", "lightPreset", "darkPreset", "preset", "density", "reducedMotion"] as const;

/**
 * A new device has no cookie yet, so the account's saved look is applied once
 * the app opens (and the cookie is written so the next load is flash-free).
 * Saved defaults never overwrite a look chosen on this device before signing
 * in, or a theme picked before the cookie existed.
 */
export function PreferencesSync({ saved, customThemes = [] }: { saved: Preferences; customThemes?: readonly KnownTheme[] }) {
  const { setTheme } = useTheme();
  // Seed the cookie from the account once, on the first load. Later runs must not
  // copy an older saved value over a choice made on this device a moment ago.
  const seeded = useRef(false);

  useEffect(() => {
    // The custom themes in use come from the account, so a theme too big for the cookie still loads (after first paint).
    rememberCustomThemes(customThemes);
    const cookie = readAppearanceCookie();
    const savedIsDefault = KEYS.every((k) => saved[k] === DEFAULT_APPEARANCE[k]);
    const same = KEYS.every((k) => cookie[k] === saved[k]);
    if (!seeded.current && !same && !savedIsDefault) {
      storeAppearance({
        matchDevice: saved.matchDevice,
        lightPreset: saved.lightPreset,
        darkPreset: saved.darkPreset,
        preset: saved.preset,
        density: saved.density,
        reducedMotion: saved.reducedMotion,
      });
    } else if (!seeded.current && !same && Object.keys(cookie).length === 0) {
      // Nothing saved yet: keep what this device already shows, and remember it for first paint.
      storeAppearance({});
    }
    seeded.current = true;
    // Whatever the cookie now says is what the page shows, including when the person came from a public page.
    const shown = readAppearance();
    applyAppearance(shown);
    setTheme(themeMode(shown, currentCustomThemes()));
  }, [saved, customThemes, setTheme]);

  // While Match my device is on, the theme shown follows the device, so when
  // the device switches between light and dark the other theme is picked at
  // once, with no reload. (next-themes switches the class itself.)
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const onChange = () => applyAppearance(readAppearance());
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return null;
}
