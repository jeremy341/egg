"use client";

import { IconTip } from "@/components/ui/tooltip";
import { useThemeChoice } from "@/components/use-theme-choice";
import { MoonIcon, SunIcon } from "@phosphor-icons/react";

/**
 * One button that flips between light and dark. Which icon shows is decided
 * by CSS from the `dark` class, so it needs no state and cannot mismatch on
 * hydration. The footer keeps the three-way toggle that includes "system".
 */
export function ThemeButton({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useThemeChoice();

  return (
    <IconTip label="Switch between light and dark mode">
      <button
        type="button"
        aria-label="Switch between light and dark mode"
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        className={
          "touch-target pressable inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-[var(--ds-gray-100)] hover:text-foreground max-sm:size-10 " +
          (className ?? "")
        }
      >
        <SunIcon className="hidden size-[18px] dark:block" />
        <MoonIcon className="size-[18px] dark:hidden" />
      </button>
    </IconTip>
  );
}
