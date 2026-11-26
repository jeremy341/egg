"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { api } from "@/components/api";
import { Card } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

type Step = { kind: "page" | "track"; value: string };
export type Features = { clicks: boolean; time: boolean; funnel: boolean; steps: Step[] };

const MAX_STEPS = 6;
const MIN_STEPS = 2;

/** What each switch records, word for word. It is the same text the docs give. */
export const RECORDS = {
  clicks:
    "Records the label of each link or button a visitor clicks (its text up to 40 characters, its aria-label, or its data-nd-track name) and the day. Never input values, form contents or URLs with query strings, and no visitor id.",
  time: "Records how long a page was open and visible, as one of four ranges (under 10 seconds, 10 to 60 seconds, 1 to 5 minutes, over 5 minutes), sent when the visitor leaves. Time in a hidden tab is not counted. It stores the day and no visitor id.",
  funnel:
    "Counts the visitors who reach each step you list, in order. A page step uses the page views already recorded. A step set by data-nd-track name also records that name with the same daily visitor code a page view has, which changes every day and cannot follow anyone across days.",
} as const;

function Switch({
  id,
  title,
  sentence,
  checked,
  busy,
  onChange,
}: {
  id: string;
  title: string;
  sentence: string;
  checked: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5">
      <input
        id={id}
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={busy}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block">{title}</span>
        <span className="block text-label text-muted-foreground">{sentence}</span>
      </span>
    </label>
  );
}

/**
 * The opt-in switches. Each one is off until it is turned on, and says in one
 * sentence what it records. A switch saves as soon as it is changed.
 */
export function AnalyticsFeatures({ projectId, initial }: { projectId: string; initial: Features }) {
  const router = useRouter();
  const [features, setFeatures] = useState(initial);
  const [steps, setSteps] = useState<Step[]>(
    initial.steps.length ? initial.steps : [{ kind: "page", value: "" }, { kind: "page", value: "" }]
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(name: string, patch: Partial<Features>) {
    setBusy(name);
    setError(null);
    setSaved(false);
    try {
      const res = await api<{ features: Features }>(`/api/projects/${projectId}/analytics`, {
        method: "PATCH",
        body: patch,
      });
      setFeatures(res.features);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  const clean = steps.map((s) => ({ ...s, value: s.value.trim() })).filter((s) => s.value);
  const stepsChanged = JSON.stringify(clean) !== JSON.stringify(features.steps);

  function setStep(i: number, next: Partial<Step>) {
    setSteps(steps.map((s, j) => (j === i ? { ...s, ...next } : s)));
    setSaved(false);
  }

  return (
    <Card
      id="analytics-features"
      title="What else to record"
      description="Each of these is off until you turn it on. Page views and visitors are always counted when analytics is on."
    >
      <div className="divide-y">
        <Switch
          id="analytics-clicks"
          title="Clicks"
          sentence={RECORDS.clicks}
          checked={features.clicks}
          busy={busy !== null}
          onChange={(clicks) => void save("clicks", { clicks })}
        />
        <Switch
          id="analytics-time"
          title="Time on page"
          sentence={RECORDS.time}
          checked={features.time}
          busy={busy !== null}
          onChange={(time) => void save("time", { time })}
        />
        <div>
          <Switch
            id="analytics-funnel"
            title="Funnel"
            sentence={RECORDS.funnel}
            checked={features.funnel}
            busy={busy !== null}
            onChange={(funnel) => void save("funnel", { funnel })}
          />
          <fieldset className="mb-3 ml-7 min-w-0">
            <legend className="text-label text-muted-foreground">
              Steps, in order ({MIN_STEPS} to {MAX_STEPS}). A page step is a path like /pricing. A name step matches an
              element with data-nd-track=&quot;name&quot;.
            </legend>
            <ol className="mt-2 space-y-2">
              {steps.map((s, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="tabular w-5 text-label text-muted-foreground">{i + 1}.</span>
                  <NativeSelect
                    className="w-40"
                    aria-label={`Step ${i + 1} type`}
                    value={s.kind}
                    onChange={(e) => setStep(i, { kind: e.target.value as Step["kind"] })}
                  >
                    <option value="page">Page</option>
                    <option value="track">Tracked name</option>
                  </NativeSelect>
                  <Input
                    className="min-w-0 flex-1 basis-48 font-mono"
                    aria-label={`Step ${i + 1} ${s.kind === "page" ? "path" : "name"}`}
                    placeholder={s.kind === "page" ? "/pricing" : "signup"}
                    maxLength={200}
                    value={s.value}
                    onChange={(e) => setStep(i, { value: e.target.value })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove step ${i + 1}`}
                    disabled={steps.length <= MIN_STEPS}
                    onClick={() => {
                      setSteps(steps.filter((_, j) => j !== i));
                      setSaved(false);
                    }}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={steps.length >= MAX_STEPS}
                onClick={() => setSteps([...steps, { kind: "page", value: "" }])}
              >
                <PlusIcon aria-hidden="true" /> Add step
              </Button>
              <Button
                type="button"
                disabled={!stepsChanged || clean.length < MIN_STEPS}
                loading={busy === "steps"}
                onClick={() => void save("steps", { steps: clean })}
              >
                Save steps
              </Button>
            </div>
          </fieldset>
        </div>
      </div>
      <p className="mt-3 text-label text-muted-foreground">
        These work with the snippet above, whose address ends in <code className="font-mono">?key=</code>. If you pasted
        an older snippet, paste this one instead. Turning a switch off stops recording at once; turning one on reaches
        visitors&apos; browsers within about 5 minutes. Visitors whose browser sends Do Not Track or Global Privacy
        Control are never recorded.
      </p>
      <p role="status" className="mt-2 min-h-5 text-label text-muted-foreground">
        {saved ? "Saved." : ""}
      </p>
      {error ? (
        <Alert tone="error" role="alert" className="mt-1">
          {error}
        </Alert>
      ) : null}
    </Card>
  );
}
