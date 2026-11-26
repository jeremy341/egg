"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import { Card, Label } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { ProjectView } from "@/server/queries";

type Rule = {
  id: string;
  metricLabel: string;
  metric: "cpu_percent" | "memory_mb" | "latency_ms";
  comparison: "above" | "below";
  threshold: number;
  durationMinutes: number;
  paused: boolean;
  statusLabel: string;
  status: string;
  lastValue: number | null;
};

const METRICS: { value: Rule["metric"]; label: string }[] = [
  { value: "cpu_percent", label: "CPU share of one core (%)" },
  { value: "memory_mb", label: "Memory (MB)" },
  { value: "latency_ms", label: "Health check time (ms)" },
];

/** Threshold rules on this app's own metrics. Pause, resume and delete from the list. */
export function AlertRulesCard({ project }: { project: ProjectView }) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [metric, setMetric] = useState<Rule["metric"]>("cpu_percent");
  const [comparison, setComparison] = useState<Rule["comparison"]>("above");
  const [threshold, setThreshold] = useState("80");
  const [duration, setDuration] = useState("5");

  useEffect(() => {
    let live = true;
    api<{ rules: Rule[] }>(`/api/projects/${project.id}/alert-rules`)
      .then((r) => { if (live) setRules(r.rules); })
      .catch((err) => { if (live) setLoadError(err instanceof Error ? err.message : "Could not load rules"); });
    return () => { live = false; };
  }, [project.id]);

  async function reload() {
    const r = await api<{ rules: Rule[] }>(`/api/projects/${project.id}/alert-rules`);
    setRules(r.rules);
    router.refresh();
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      id="alert-rules-heading"
      title="Threshold rules"
      description="Fire when one of this app's metrics stays past a line for a set time. Up to 25 rules."
    >
      {loadError ? <Alert tone="error" title="Rules did not load">{loadError}</Alert> : null}
      {error ? <Alert tone="error" title="Could not change the rule">{error}</Alert> : null}

      {rules && rules.length === 0 ? <p className="mb-3 text-[13px] text-muted-foreground">No rules yet.</p> : null}
      {rules && rules.length > 0 ? (
        <ul className="mb-4 divide-y rounded-md shadow-border-small">
          {rules.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
              <span className="min-w-0">
                <span className="font-medium">{r.metricLabel}</span>{" "}
                <span className="text-muted-foreground">
                  {r.comparison === "above" ? "above" : "below"} {r.threshold} for {r.durationMinutes} min
                </span>
                <span className="ml-2 text-foreground">{r.statusLabel}</span>
                {r.lastValue !== null ? <span className="ml-2 tabular text-muted-foreground">now {r.lastValue}</span> : null}
              </span>
              <span className="flex gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => api(`/api/projects/${project.id}/alert-rules/${r.id}`, { method: "PATCH", body: { paused: !r.paused } }))}>
                  {r.paused ? "Resume" : "Pause"}
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => api(`/api/projects/${project.id}/alert-rules/${r.id}`, { method: "DELETE" }))}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <form
        className="grid gap-3 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            api(`/api/projects/${project.id}/alert-rules`, {
              method: "POST",
              body: { metric, comparison, threshold: Number(threshold), durationMinutes: Number(duration) },
            })
          );
        }}
      >
        <div>
          <Label htmlFor="rule-metric">Metric</Label>
          <NativeSelect id="rule-metric" value={metric} onChange={(e) => setMetric(e.target.value as Rule["metric"])}>
            {METRICS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="rule-comparison">When it is</Label>
          <NativeSelect id="rule-comparison" value={comparison} onChange={(e) => setComparison(e.target.value as Rule["comparison"])}>
            <option value="above">above</option>
            <option value="below">below</option>
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="rule-threshold">Threshold</Label>
          <Input id="rule-threshold" inputMode="decimal" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="rule-duration">For (minutes)</Label>
          <Input id="rule-duration" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} />
        </div>
        <div className="sm:col-span-4">
          <Button type="submit" disabled={busy || (rules?.length ?? 0) >= 25}>Add rule</Button>
        </div>
      </form>
    </Card>
  );
}
