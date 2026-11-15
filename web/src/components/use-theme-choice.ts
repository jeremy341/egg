"use client";

import { useCallback } from "react";
import { useTheme } from "next-themes";
import { useOptionalAccount } from "@/components/account-context";
import { applyAppearance, currentCustomThemes, readAppearance, savePreferences, storeAppearance } from "@/components/appearance";
import { THEMES, themeMode, type Appearance } from "@/lib/preferences";

/**
 * The quick light, dark and system switches. They go through the same choice
 * as Settings: System turns Match my device on; Light or Dark turns it off and
 * keeps the light or dark theme already chosen for that side. Every place that
 * remembers it is kept in step: next-themes (the class on <html> and
 * localStorage), the egg_prefs cookie that sets it before paint, and, when
 * signed in, the account.
 */
export function useThemeChoice() {
  const { theme, resolvedTheme, setTheme: setNextTheme } = useTheme();
  const signedIn = useOptionalAccount() !== null;

  const setTheme = useCallback(
    (value: string) => {
      if (!(THEMES as readonly string[]).includes(value)) return;
      const now = readAppearance();
      const change: Partial<Appearance> =
        value === "system"
          ? { matchDevice: true }
          : { matchDevice: false, preset: value === "light" ? now.lightPreset : now.darkPreset };
      const next = storeAppearance(change);
      setNextTheme(themeMode(next, currentCustomThemes()));
      // The colour theme shown depends on the choice, so it is applied again with it.
      applyAppearance(next);
      // The look is already applied; a failed save only means this device keeps the choice to itself.
      if (signedIn) void savePreferences(change).catch(() => {});
    },
    [setNextTheme, signedIn]
  );

  return { theme, resolvedTheme, setTheme };
}
