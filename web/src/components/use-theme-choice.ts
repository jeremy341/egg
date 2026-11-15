"use client";

import { useCallback } from "react";
import { useTheme } from "next-themes";
import { useOptionalAccount } from "@/components/account-context";
import { savePreferences, storeAppearance } from "@/components/appearance";
import { THEMES, type Theme } from "@/lib/preferences";

/**
 * The theme, with every place that remembers it kept in step: next-themes (the
 * class on <html> and localStorage), the egg_prefs cookie that sets it before
 * paint, and, when signed in, the account. The toggles all go through here.
 */
export function useThemeChoice() {
  const { theme, resolvedTheme, setTheme: setNextTheme } = useTheme();
  const signedIn = useOptionalAccount() !== null;

  const setTheme = useCallback(
    (value: string) => {
      if (!(THEMES as readonly string[]).includes(value)) return;
      setNextTheme(value);
      storeAppearance({ theme: value as Theme });
      // The look is already applied; a failed save only means this device keeps the choice to itself.
      if (signedIn) void savePreferences({ theme: value as Theme }).catch(() => {});
    },
    [setNextTheme, signedIn]
  );

  return { theme, resolvedTheme, setTheme };
}
