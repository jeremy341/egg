"use client";

import { useState } from "react";
import { HOME_FACTS } from "@/components/marketing/home-facts";

/** Made-up releases of the sample project, newest first. Not real data. */
const RELEASES = [
  { sha: "7c2f9ab", message: "Fix timezone offset in weekly summary", age: "2h ago" },
  { sha: "5e1b803", message: "Cache the leaderboard query", age: "1d ago" },
  { sha: "2a94d7c", message: "Add weekly summary email", age: "3d ago" },
  { sha: "c03f6e1", message: "Bump dependencies", age: "5d ago" },
  { sha: "91d8a42", message: "Import the repo", age: "6d ago" },
].slice(0, HOME_FACTS.releasesKept);

/**
 * The releases a production project keeps on the container, as a list you can press. Rolling back
 * only moves the live marker to another release, as it does on the container: nothing is rebuilt.
 * Sample data, local state only.
 */
export function ReleaseRail() {
  const [live, setLive] = useState(0);
  const [note, setNote] = useState("");

  function rollBack(i: number) {
    setLive(i);
    setNote(
      i === 0
        ? `Back on the newest release, ${RELEASES[0].sha}.`
        : `Switched to release ${RELEASES[i].sha}. Nothing was rebuilt.`
    );
  }

  return (
    <div className="vg-rail">
      <ul>
        {RELEASES.map((r, i) => {
          const isLive = i === live;
          return (
            <li key={r.sha} data-live={isLive || undefined}>
              <span aria-hidden="true" className="vg-rail-mark" />
              <span className="vg-rail-sha">{r.sha}</span>
              <span className="vg-rail-msg">{r.message}</span>
              <span className="vg-rail-age">{r.age}</span>
              {isLive ? (
                <span className="vg-rail-live">Live</span>
              ) : (
                <button
                  type="button"
                  onClick={() => rollBack(i)}
                  className="vg-rail-btn"
                  aria-label={`Roll back to ${r.sha}: ${r.message}`}
                >
                  {i === 0 ? "Go live" : "Roll back"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="vg-rail-note" role="status" aria-live="polite">
        {note || "Press Roll back on any release."}
      </p>
    </div>
  );
}
