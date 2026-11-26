"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/api";
import { Card } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { STATISTIC_COPY, STATISTIC_ORDER } from "@/lib/statistics-copy";

type Switches = Record<(typeof STATISTIC_ORDER)[number], boolean>;
const OFF: Switches = { deployCount: false, deploySuccess: false, buildTime: false, visitors: false };

/**
 * Owner switches for the statistics shown on the project's Statistics section.
 * Everything starts off. The server enforces owner-only changes.
 */
export function StatisticsCard({ projectId }: { projectId: string }) {
  const [switches, setSwitches] = useState<Switches>(OFF);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<keyof Switches | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ statistics: Switches }>(`/api/projects/${projectId}/statistics`)
      .then((data) => {
        if (alive) setSwitches({ ...OFF, ...data.statistics });
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : "Could not load statistics settings");
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function toggle(key: keyof Switches, next: boolean) {
    const previous = switches;
    setBusy(key);
    setError(null);
    setSwitches({ ...switches, [key]: next });
    try {
      const data = await api<{ statistics: Switches }>(`/api/projects/${projectId}/statistics`, {
        method: "PATCH",
        body: { [key]: next },
      });
      setSwitches({ ...OFF, ...data.statistics });
    } catch (err) {
      setSwitches(previous);
      setError(err instanceof Error ? err.message : "Could not change this setting");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      id="statistics-card"
      title="Statistics"
      description="Choose what the Statistics section of this project shows. Every item is off until you turn it on."
    >
      {error ? <Alert tone="error" role="alert" className="mb-3">{error}</Alert> : null}
      <div className="divide-y">
        {STATISTIC_ORDER.map((key) => (
          <label key={key} htmlFor={`statistics-${key}`} className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5">
            <input
              id={`statistics-${key}`}
              type="checkbox"
              className="mt-1"
              checked={switches[key]}
              disabled={!loaded || busy !== null}
              onChange={(e) => void toggle(key, e.target.checked)}
            />
            <span className="min-w-0">
              <span className="block">{STATISTIC_COPY[key].title}</span>
              <span className="block text-label text-muted-foreground">{STATISTIC_COPY[key].sentence}</span>
            </span>
          </label>
        ))}
      </div>
    </Card>
  );
}
