"use client";

import { useState } from "react";
import { HOME_FACTS, numberWord } from "@/components/marketing/home-facts";
import { Cell } from "@/components/marketing/readout";

/** Sample releases, oldest first. The commits are made up; the row holds as many as the product keeps. */
const RELEASES = [
  { sha: "3d9f0b2", age: "9 days ago" },
  { sha: "b41d0e7", age: "6 days ago" },
  { sha: "7c2f9ab", age: "3 days ago" },
  { sha: "a08c6f1", age: "yesterday" },
  { sha: "e41b7d2", age: "just now" },
].slice(-HOME_FACTS.releasesKept);

const NEWEST = RELEASES.length - 1;

/**
 * The releases a container keeps, as a radio group. Picking one only changes
 * this sample: it shows where `current` would point after a rollback.
 */
export function ReleasePicker() {
  const [live, setLive] = useState(NEWEST);
  const release = RELEASES[live];

  return (
    <div>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="p-0 text-[0.875rem] leading-[30px] text-muted-foreground">
          The last {numberWord(RELEASES.length)} releases. Pick one to roll back (sample).
        </legend>
        <div className="mt-2 flex">
          {RELEASES.map((r, i) => (
            <label key={r.sha} className="rd-radio" title={`${r.sha}, ${r.age}`}>
              <input
                type="radio"
                name="release-sample"
                value={r.sha}
                checked={live === i}
                onChange={() => setLive(i)}
                aria-label={`${r.sha}, ${r.age}`}
              />
              <Cell state={live === i ? "accent" : "ink"} />
            </label>
          ))}
        </div>
      </fieldset>
      <p aria-live="polite" className="m-0 mt-3 font-mono text-[0.8125rem] leading-6 break-all">
        current <span className="text-subtle-foreground">-&gt;</span> releases/{release.sha}{" "}
        <span className="font-sans text-muted-foreground">({release.age})</span>
      </p>
    </div>
  );
}
