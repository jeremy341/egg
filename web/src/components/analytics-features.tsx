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
import { RETENTION_NOTICE } from "@/lib/analytics-defaults";
import { UTM_ALLOWLIST_MAX, UTM_ALLOWLIST_VALUE, type UtmAllowlist, type UtmKey } from "@/server/analytics-fields";

type Step = { kind: "page" | "track"; value: string };
export type RetentionDays = 30 | 60 | 90;
export type Features = {
  clicks: boolean;
  time: boolean;
  funnel: boolean;
  steps: Step[];
  referrers: boolean;
  campaigns: boolean;
  utmAllowlist: UtmAllowlist;
  retentionDays: RetentionDays;
  vitals: boolean;
  events: boolean;
  live: boolean;
  retention: boolean;
  locations: boolean;
};

const MAX_STEPS = 6;
const MIN_STEPS = 2;

export const RETENTION_CHOICES: readonly RetentionDays[] = [30, 60, 90];

/** What each switch records, word for word. */
export const RECORDS = {
  clicks:
    "Records only the data-egg-track name on elements you mark, and the day. Egg never reads visible text or accessible labels. Do not use personal or changing values as tracking names. No visitor id.",
  time: "Records how long a page was open and visible, as one of four ranges (under 10 seconds, 10 to 60 seconds, 1 to 5 minutes, over 5 minutes), sent when the visitor leaves. Time in a hidden tab is not counted. It stores the day and no visitor id.",
  funnel:
    "Counts the visitors who reach each step you list, in order. A page step uses the page views already recorded. A step set by data-egg-track name also records that name with the same daily visitor code a page view has, which changes every day and cannot follow anyone across days.",
  referrers:
    "Records the host of the site a visitor came from (never the full address or its query string) with the page view. No cookies. Turning it off deletes the referrers already stored.",
  campaigns:
    "Records the utm_source, utm_medium and utm_campaign values in the address, but only the values you list below, matched exactly. Any other value is dropped and never stored. No cookies. Turning it off deletes the campaign values already stored.",
  vitals:
    "Records five measurements of how fast a page loaded, sent once when the visitor leaves. Exception messages are not collected because they can contain credentials or personal data.",
  events:
    "Records a click on an element marked with data-egg-track, with an optional data-egg-value of up to 40 plain characters (a plan name, for example). Stores the name, the value and the day, and no visitor id. Never put personal details in a value.",
  live: "Shows page views and visitors in the last 5 minutes. A page that is open and visible sends a small signal every 60 seconds, which is deleted after an hour. Counting visitors needs Retention to be on too.",
  retention: `${RETENTION_NOTICE} It tells new visitors from returning ones over 7 and 30 days. Only a salted code made from the id is stored, never the id itself, and the code changes every 90 days. Turning it off deletes the codes already stored.`,
  locations:
    "Records the visitor's country (two letters, such as FR) with each page view, to draw the visitor map. The country is looked up from the address in the same request, using a database that ships with Egg, so nothing is sent to another service. The address itself is never stored or logged, and no city, region or position is kept. Turning it off deletes the countries already stored.",
  keep: "How long page views, events and speed measurements are kept before Egg deletes them. Live view signals are always deleted after an hour. New projects keep 90 days.",
} as const;

/** The three campaign values, as the address names them and as this screen labels them. */
export const UTM_FIELDS: readonly { key: UtmKey; label: string; param: string; example: string }[] = [
  { key: "source", label: "Source", param: "utm_source", example: "newsletter" },
  { key: "medium", label: "Medium", param: "utm_medium", example: "email" },
  { key: "campaign", label: "Campaign", param: "utm_campaign", example: "spring-26" },
];

export const ALLOWLIST_RULE = `Up to ${UTM_ALLOWLIST_MAX} values for each, 40 characters at most, using letters, numbers, dot, dash or underscore. A value must match exactly, capital letters included.`;

/**
 * Add one value to an allowlist: the text trimmed, checked against the rule the server
 * enforces, and refused when it is already listed or the list is full. Pure.
 */
export function addAllowedValue(list: readonly string[], raw: string): { list: string[] } | { error: string } {
  const value = raw.trim();
  if (!value) return { error: "Type a value to add." };
  if (!UTM_ALLOWLIST_VALUE.test(value)) {
    return { error: "Use letters, numbers, dot, dash or underscore, up to 40 characters, starting with a letter or number." };
  }
  if (list.includes(value)) return { error: `${value} is already on the list.` };
  if (list.length >= UTM_ALLOWLIST_MAX) return { error: `A list holds at most ${UTM_ALLOWLIST_MAX} values.` };
  return { list: [...list, value] };
}

const noValues = (a: UtmAllowlist) => a.source.length + a.medium.length + a.campaign.length === 0;

function Switch({
  id,
  title,
  sentence,
  checked,
  busy,
  disabled = false,
  onChange,
}: {
  id: string;
  title: string;
  sentence: string;
  checked: boolean;
  busy: boolean;
  /** Blocks the switch for a reason other than a save in progress. */
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2.5">
      <input
        id={id}
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={busy || disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block">{title}</span>
        <span className="block text-label text-muted-foreground">{sentence}</span>
      </span>
    </label>
  );
}

/** One of the three lists: the values on it, each removable, and a field to add another. */
function AllowlistField({
  field,
  values,
  disabled,
  onChange,
}: {
  field: (typeof UTM_FIELDS)[number];
  values: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorId = `analytics-utm-${field.key}-error`;

  function add() {
    const result = addAllowedValue(values, draft);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onChange(result.list);
    setDraft("");
    setError(null);
  }

  return (
    <div className="min-w-0">
      <p className="text-label font-medium">
        {field.label} <span className="font-normal text-muted-foreground">(from {field.param})</span>
      </p>
      {values.length ? (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Allowed ${field.label.toLowerCase()} values`}>
          {values.map((v) => (
            <li key={v} className="flex items-center gap-0.5 rounded-md bg-muted py-0.5 pl-2 text-label">
              <code className="font-mono">{v}</code>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove ${field.label.toLowerCase()} value ${v}`}
                disabled={disabled}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-label text-muted-foreground">None listed.</p>
      )}
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          className="min-w-0 flex-1 basis-40 font-mono"
          aria-label={`Add a ${field.label.toLowerCase()} value`}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          placeholder={field.example}
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
        />
        <Button type="submit" variant="outline" disabled={disabled || values.length >= UTM_ALLOWLIST_MAX}>
          <PlusIcon aria-hidden="true" /> Add
        </Button>
      </form>
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-label text-destructive">
          {error}
        </p>
      ) : null}
    </div>
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
  const [allowed, setAllowed] = useState<UtmAllowlist>(initial.utmAllowlist);
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
      if (patch.utmAllowlist) setAllowed(res.features.utmAllowlist);
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

  const allowedChanged = JSON.stringify(allowed) !== JSON.stringify(features.utmAllowlist);
  // Campaigns with nothing allowed would record nothing, and the server refuses it.
  const needsValue = noValues(allowed) && features.campaigns;
  const nothingSaved = noValues(features.utmAllowlist);

  return (
    <Card
      id="analytics-features"
      title="What else to record"
      description="Each of these is off until you turn it on. Page views and visitors are always counted when analytics is on. New projects start from your account defaults in Settings."
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
              element with data-egg-track=&quot;name&quot;.
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
        <Switch
          id="analytics-referrers"
          title="Referrers"
          sentence={RECORDS.referrers}
          checked={features.referrers}
          busy={busy !== null}
          onChange={(referrers) => void save("referrers", { referrers })}
        />
        <div>
          <Switch
            id="analytics-campaigns"
            title="Campaigns"
            sentence={RECORDS.campaigns}
            checked={features.campaigns}
            busy={busy !== null}
            disabled={!features.campaigns && nothingSaved}
            onChange={(campaigns) => void save("campaigns", { campaigns })}
          />
          <fieldset className="mb-3 ml-7 min-w-0">
            <legend className="text-label text-muted-foreground">
              Allowed campaign values. Only the values listed here are recorded; anything else in the address is
              dropped. {ALLOWLIST_RULE}
            </legend>
            <div className="mt-3 space-y-4">
              {UTM_FIELDS.map((field) => (
                <AllowlistField
                  key={field.key}
                  field={field}
                  values={allowed[field.key]}
                  disabled={busy !== null}
                  onChange={(next) => {
                    setAllowed({ ...allowed, [field.key]: next });
                    setSaved(false);
                  }}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={!allowedChanged || needsValue}
                loading={busy === "allowlist"}
                onClick={() => void save("allowlist", { utmAllowlist: allowed })}
              >
                Save allowed values
              </Button>
              {needsValue ? (
                <span className="text-label text-muted-foreground">
                  Campaigns is on, so keep at least one value, or turn it off first.
                </span>
              ) : !features.campaigns && nothingSaved ? (
                <span className="text-label text-muted-foreground">
                  Save at least one value to be able to turn Campaigns on.
                </span>
              ) : allowedChanged ? (
                <span className="text-label text-muted-foreground">Not saved yet.</span>
              ) : null}
            </div>
          </fieldset>
        </div>
        <Switch
          id="analytics-vitals"
          title="Speed metrics"
          sentence={RECORDS.vitals}
          checked={features.vitals}
          busy={busy !== null}
          onChange={(vitals) => void save("vitals", { vitals })}
        />
        <Switch
          id="analytics-events"
          title="Custom events"
          sentence={RECORDS.events}
          checked={features.events}
          busy={busy !== null}
          onChange={(events) => void save("events", { events })}
        />
        <Switch
          id="analytics-live"
          title="Live view"
          sentence={RECORDS.live}
          checked={features.live}
          busy={busy !== null}
          onChange={(live) => void save("live", { live })}
        />
        <Switch
          id="analytics-retention"
          title="Retention"
          sentence={RECORDS.retention}
          checked={features.retention}
          busy={busy !== null}
          onChange={(retention) => void save("retention", { retention })}
        />
        <Switch
          id="analytics-locations"
          title="Record visitor countries"
          sentence={RECORDS.locations}
          checked={features.locations}
          busy={busy !== null}
          onChange={(locations) => void save("locations", { locations })}
        />
        <div className="py-2.5">
          <label htmlFor="analytics-keep" className="block">
            Keep the numbers for
          </label>
          <span id="analytics-keep-note" className="block text-label text-muted-foreground">
            {RECORDS.keep}
          </span>
          <NativeSelect
            className="mt-2 w-40"
            id="analytics-keep"
            aria-describedby="analytics-keep-note"
            value={String(features.retentionDays)}
            disabled={busy !== null}
            onChange={(e) => void save("retentionDays", { retentionDays: Number(e.target.value) as RetentionDays })}
          >
            {RETENTION_CHOICES.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </NativeSelect>
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
