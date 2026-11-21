"use client";

import { Badge } from "@/components/ui/badge";
import type { BuildLocation } from "@/server/db/schema";

/** The two places a build can run. GitHub Actions is listed first because it is the recommended one. */
export const BUILD_CHOICES: { value: BuildLocation; title: string; text: string; recommended?: boolean }[] = [
  {
    value: "github",
    title: "GitHub Actions",
    text: "Builds on GitHub's machines, so your Nest container only runs the app.",
    recommended: true,
  },
  {
    value: "container",
    title: "Build on Nest",
    text: "Runs on your container under a memory and CPU cap.",
  },
];

/**
 * One radio group for "How should Egg build it?". Used by the new project flow and by the project settings, so
 * the two never word it differently. The caller decides which value is checked.
 */
export function BuildLocationChoice({
  name,
  legend,
  value,
  onChange,
  describedBy,
  showLegend = false,
}: {
  name: string;
  legend: string;
  value: BuildLocation;
  onChange: (next: BuildLocation) => void;
  describedBy?: string;
  /** Show the legend as a visible label. Off where the card title already names the group. */
  showLegend?: boolean;
}) {
  return (
    <fieldset className="min-w-0" aria-describedby={describedBy}>
      <legend className={showLegend ? "mb-1.5 text-label font-medium" : "sr-only"}>{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {BUILD_CHOICES.map((c) => (
          <label key={c.value} className="touch-target relative block min-w-0 cursor-pointer">
            <input
              type="radio"
              name={name}
              value={c.value}
              checked={value === c.value}
              onChange={() => onChange(c.value)}
              className="peer sr-only"
            />
            <span className="flex h-full flex-col gap-1 rounded-md bg-background p-3 shadow-border-base transition-[box-shadow] duration-(--dur-fast) hover:shadow-border-hover peer-checked:shadow-[0_0_0_2px_var(--foreground)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ds-focus-color)]">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {c.title}
                {c.recommended ? <Badge variant="outline">Recommended</Badge> : null}
              </span>
              <span className="text-label text-muted-foreground">{c.text}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
