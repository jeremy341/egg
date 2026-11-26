"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/components/api";
import { diagnoseCrashLoop } from "@/lib/crash-diagnosis";
import { lastCrashSentence } from "@/lib/crash-text";

type Crash = { at: number; exitCode: number | null; reason: string; restarts: number | null };

/**
 * The last crash the monitor recorded for this project, and a likely cause for
 * a crash loop found in the lines on screen. The crash is labelled as status
 * only: the output of that run is not kept, so the lines may not include it.
 */
export function CrashPanel({ projectId, lines }: { projectId: string; lines: string[] }) {
  const [crash, setCrash] = useState<Crash | null>(null);

  useEffect(() => {
    let live = true;
    api<{ crash: Crash | null }>(`/api/projects/${projectId}/last-crash`)
      .then((res) => {
        if (live) setCrash(res.crash);
      })
      .catch(() => {
        // The panel is extra; a failed read just leaves it out.
        if (live) setCrash(null);
      });
    return () => {
      live = false;
    };
  }, [projectId]);

  const diagnosis = useMemo(
    () => diagnoseCrashLoop({ lines, exitCode: crash?.exitCode ?? null, reason: crash?.reason ?? null }),
    [lines, crash]
  );

  if (!crash && !diagnosis) return null;
  return (
    <section aria-label="Crash details" className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-label">
      {diagnosis ? (
        <div>
          <p className="font-medium">Likely cause: {diagnosis.title}</p>
          <p className="mt-1 text-muted-foreground">{diagnosis.suggestion}</p>
        </div>
      ) : null}
      {crash ? (
        <div>
          <p className="font-medium">Last crash (status only)</p>
          <p className="mt-1 text-muted-foreground">{lastCrashSentence(crash)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The output from that run is not kept. Only its exit status and reason are.
          </p>
        </div>
      ) : null}
    </section>
  );
}
