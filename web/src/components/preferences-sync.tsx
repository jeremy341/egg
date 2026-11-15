"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { applyAppearance, readAppearanceCookie, storeAppearance } from "@/components/appearance";
import { DEFAULT_APPEARANCE, type Preferences } from "@/lib/preferences";

const KEYS = ["theme", "accent", "density", "reducedMotion"] as const;

/**
 * A new device has no cookie yet, so the account's saved look is applied once
 * the app opens (and the cookie is written so the next load is flash-free).
 * Saved defaults never overwrite a look chosen on this device before signing
 * in, or a theme picked before the cookie existed.
 */
export function PreferencesSync({ saved }: { saved: Preferences }) {
  const { setTheme } = useTheme();

  useEffect(() => {
    const cookie = readAppearanceCookie();
    const savedIsDefault = KEYS.every((k) => saved[k] === DEFAULT_APPEARANCE[k]);
    const same = KEYS.every((k) => cookie[k] === saved[k]);
    if (same) return;
    if (savedIsDefault) {
      // Nothing saved yet: keep what this device already shows, and remember it for first paint.
      if (Object.keys(cookie).length === 0) storeAppearance({});
      return;
    }
    const appearance = storeAppearance({
      theme: saved.theme,
      accent: saved.accent,
      density: saved.density,
      reducedMotion: saved.reducedMotion,
    });
    applyAppearance(appearance);
    setTheme(appearance.theme);
  }, [saved, setTheme]);

  return null;
}
