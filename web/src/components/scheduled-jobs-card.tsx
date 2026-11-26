"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PauseIcon, PencilSimpleIcon, PlayIcon, TerminalWindowIcon, TrashIcon } from "@phosphor-icons/react";
import { api } from "@/components/api";
import { Card, Label } from "@/components/settings-ui";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { describeSchedule, nextRun, parseSchedule, ScheduleError } from "@/lib/cron-schedule";
import { timeAgo } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { JobStatus, JobView } from "@/server/scheduled-jobs";

const REFRESH_MS = 30_000;

const PRESETS: { label: string; schedule: string }[] = [
  { label: "Every 15 minutes", schedule: "*/15 * * * *" },
  { label: "Every hour", schedule: "0 * * * *" },
  { label: "Every day at 03:00", schedule: "0 3 * * *" },
  { label: "Every Monday at 09:00", schedule: "0 9 * * 1" },
  { label: "First of the month at 04:00", schedule: "0 4 1 * *" },
];

/** "in 5m", "in 3h", "in 2d": the mirror of timeAgo, for a time that has not come yet. */
function timeUntil(value: string, now: number): string {
  const s = Math.max(0, Math.round((new Date(value).getTime() - now) / 1000));
  if (s < 60) return "in under a minute";
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
}

function lastRunText(job: JobView, status: JobStatus | undefined, now: number) {
  if (!status) return { text: "Checking…", tone: "muted" as const };
  switch (status.state) {
    case "running":
      return { text: "Running now", tone: "info" as const };
    case "failed":
      return {
        text: `Failed${status.exitCode ? ` (exit ${status.exitCode})` : ""}${status.lastEndedAt ? ` ${timeAgo(status.lastEndedAt, now)}` : ""}`,
        tone: "bad" as const,
      };
    case "ok":
      return { text: `Succeeded ${timeAgo(status.lastEndedAt!, now)}`, tone: "good" as const };
    case "missing":
      return { text: "Not on your container. Pause and resume it to put it back.", tone: "bad" as const };
    default:
      return { text: job.enabled ? "Has not run yet" : "Paused", tone: "muted" as const };
  }
}

const TONE: Record<"muted" | "good" | "bad" | "info", string> = {
  muted: "text-muted-foreground",
  good: "text-foreground",
  bad: "text-destructive",
  info: "text-foreground",
};

/** Live reading of a cron schedule: what it means and when it next runs, or why it is not valid. */
function useSchedulePreview(schedule: string, now: number) {
  return useMemo(() => {
    try {
      const s = parseSchedule(schedule);
      const next = nextRun(s, new Date(now));
      return { ok: true as const, text: `${describeSchedule(s)}${next ? `, next ${next.toISOString().slice(0, 16).replace("T", " ")} UTC` : ""}` };
    } catch (err) {
      return { ok: false as const, text: err instanceof ScheduleError ? err.message : "That is not a schedule." };
    }
  }, [schedule, now]);
}

/** The inline form that replaces a job row while it is being edited. */
function JobEditForm({
  job,
  now,
  saving,
  onSave,
  onCancel,
}: {
  job: JobView;
  now: number;
  saving: boolean;
  onSave: (values: { name: string; schedule: string; command: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(job.name);
  const [schedule, setSchedule] = useState(job.schedule);
  const [command, setCommand] = useState(job.command);
  const preview = useSchedulePreview(schedule, now);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name: name.trim(), schedule: schedule.trim(), command: command.trim() });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="grid gap-3"
    >
      <p className="text-[13px] font-medium">Edit {job.name}</p>
      <div>
        <Label htmlFor="job-edit-name">Name</Label>
        <Input
          ref={nameRef}
          id="job-edit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoComplete="off"
        />
      </div>
      <div>
        <Label htmlFor="job-edit-schedule">Schedule (minute hour day month weekday)</Label>
        <Input
          id="job-edit-schedule"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="job-edit-schedule-hint"
        />
        <p id="job-edit-schedule-hint" className={cn("mt-1 text-[13px]", preview.ok ? "text-muted-foreground" : "text-destructive")}>
          {preview.text}
        </p>
      </div>
      <div>
        <Label htmlFor="job-edit-command">Command</Label>
        <Input
          id="job-edit-command"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={saving || !name.trim() || !command.trim() || !schedule.trim() || !preview.ok} className="px-3">
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving} className="px-3">
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Commands that run on a schedule inside the current release, as systemd timers
 * on the container. The list comes from the dashboard's records; how each job is
 * doing is read from the container when the card opens and every 30 seconds.
 */
export function ScheduledJobsCard({ projectId }: { projectId: string }) {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [status, setStatus] = useState<Record<string, JobStatus>>({});
  const [statusError, setStatusError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<{ id: string; lines: string[] | null; error?: string } | null>(null);
  const inFlight = useRef(false);
  /** A reload asked for while a poll is running. One follow-up is kept, never more. */
  const reloadQueued = useRef(false);

  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("0 3 * * *");
  const [command, setCommand] = useState("");
  const [adding, setAdding] = useState(false);

  const preview = useSchedulePreview(schedule, now);

  const [editingId, setEditingId] = useState<string | null>(null);
  const editButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusBack = useRef<string | null>(null);

  function stopEditing(id: string) {
    focusBack.current = id;
    setEditingId(null);
  }

  useEffect(() => {
    // The Edit button is disabled while its row is busy, so wait for that to clear.
    if (editingId === null && busy === null && focusBack.current) {
      editButtons.current[focusBack.current]?.focus();
      focusBack.current = null;
    }
  }, [editingId, busy]);

  const load = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      // Not dropped: a reload asked for during a poll runs once that poll ends.
      reloadQueued.current = true;
      return;
    }
    inFlight.current = true;
    try {
      // One more pass runs if a reload was asked for while the last pass was in flight.
      do {
        reloadQueued.current = false;
        try {
          const res = await api<{ jobs: JobView[] }>(`/api/projects/${projectId}/jobs`);
          setJobs(res.jobs);
          if (res.jobs.length > 0) {
            try {
              const live = await api<{ jobs: JobView[]; status: JobStatus[] }>(`/api/projects/${projectId}/jobs?status=1`);
              setStatus(Object.fromEntries(live.status.map((s) => [s.id, s])));
              setStatusError(null);
            } catch (err) {
              setStatusError(err instanceof Error ? err.message.replace(/\.$/, "") : "Could not read the jobs");
            }
          }
          setNow(Date.now());
        } catch (err) {
          setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not load the jobs" });
          setJobs((j) => j ?? []);
        }
      } while (reloadQueued.current);
    } finally {
      inFlight.current = false;
    }
  }, [projectId]);

  useEffect(() => {
    // Reading the container is an external side effect, which is what effects are for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setMessage(null);
    try {
      await api(`/api/projects/${projectId}/jobs`, { method: "POST", body: { name, schedule, command } });
      setName("");
      setCommand("");
      setMessage({ ok: true, text: "Added. It is armed on your container now." });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not add the job" });
    } finally {
      setAdding(false);
    }
  }

  async function act(id: string, what: string, run: () => Promise<unknown>, done?: string) {
    setBusy(`${id}:${what}`);
    setMessage(null);
    try {
      await run();
      if (done) setMessage({ ok: true, text: done });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "That did not work" });
    } finally {
      setBusy(null);
    }
  }

  const runNow = (job: JobView) =>
    act(job.id, "run", async () => {
      await api(`/api/projects/${projectId}/jobs/${job.id}/run`, { method: "POST", body: {} });
      // Give it a moment to finish before asking how it went.
      await new Promise((r) => setTimeout(r, 1500));
    }, `Started “${job.name}”. Open its output to see what it printed.`);

  const toggle = (job: JobView) =>
    act(job.id, "toggle", () =>
      api(`/api/projects/${projectId}/jobs/${job.id}`, { method: "PATCH", body: { enabled: !job.enabled } })
    );

  const save = (job: JobView, values: { name: string; schedule: string; command: string }) =>
    act(job.id, "edit", async () => {
      await api(`/api/projects/${projectId}/jobs/${job.id}`, { method: "PATCH", body: values });
      stopEditing(job.id);
    });

  const remove = (job: JobView) =>
    act(job.id, "remove", async () => {
      await api(`/api/projects/${projectId}/jobs/${job.id}`, { method: "DELETE" });
      if (open?.id === job.id) setOpen(null);
    });

  async function toggleOutput(job: JobView) {
    if (open?.id === job.id) return setOpen(null);
    setOpen({ id: job.id, lines: null });
    try {
      const res = await api<{ lines: string[] }>(`/api/projects/${projectId}/jobs/${job.id}/logs`);
      setOpen({ id: job.id, lines: res.lines });
    } catch (err) {
      setOpen({ id: job.id, lines: [], error: err instanceof Error ? err.message : "Could not read the output" });
    }
  }

  return (
    <Card
      id="jobs-heading"
      title="Scheduled Jobs"
      docsHref="/docs/jobs"
      docsTopic="scheduled jobs"
      description="Run a command on a schedule inside your latest release, such as a nightly clean-up or a weekly report. Times are UTC."
    >
      {jobs === null ? (
        <p role="status" className="text-muted-foreground">
          Loading…
        </p>
      ) : jobs.length === 0 ? (
        <p className="text-muted-foreground">No jobs yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {jobs.map((job) => {
            const s = status[job.id];
            const last = lastRunText(job, s, now);
            const working = busy?.startsWith(`${job.id}:`) ?? false;
            return (
              <li key={job.id} className="px-3 py-3">
                {editingId === job.id ? (
                  <JobEditForm
                    job={job}
                    now={now}
                    saving={working}
                    onSave={(values) => void save(job, values)}
                    onCancel={() => stopEditing(job.id)}
                  />
                ) : (
                <>
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <p className="font-medium tracking-[-0.02em]">{job.name}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {job.description}
                      {job.enabled && job.nextRunAt ? `. Next run ${timeUntil(job.nextRunAt, now)}` : ""}
                    </p>
                    <p className={cn("mt-0.5 text-[13px]", TONE[last.tone])}>{last.text}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => void runNow(job)} disabled={working}>
                      <PlayIcon />
                      Run now
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => void toggle(job)} disabled={working}>
                      {job.enabled ? <PauseIcon /> : <PlayIcon />}
                      {job.enabled ? "Pause" : "Resume"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${open?.id === job.id ? "Hide" : "Show"} the output of ${job.name}`}
                      aria-pressed={open?.id === job.id}
                      onClick={() => void toggleOutput(job)}
                    >
                      <TerminalWindowIcon />
                    </Button>
                    <Button
                      ref={(el) => {
                        editButtons.current[job.id] = el;
                      }}
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${job.name}`}
                      onClick={() => setEditingId(job.id)}
                      disabled={working}
                    >
                      <PencilSimpleIcon />
                    </Button>
                    <ConfirmDialog
                      tone="destructive"
                      title={`Remove ${job.name}?`}
                      description="It stops running and is removed from your container."
                      confirmLabel="Remove"
                      pendingLabel="Removing…"
                      onConfirm={() => remove(job)}
                      trigger={
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${job.name}`}>
                          <TrashIcon />
                        </Button>
                      }
                    />
                  </div>
                </div>
                <p className="mt-2 overflow-x-auto whitespace-nowrap rounded bg-muted/40 px-2 py-1.5 font-mono text-[12.5px]">
                  {job.command}
                </p>
                {open?.id === job.id ? (
                  <div className="mt-2">
                    {open.lines === null ? (
                      <p role="status" className="text-[13px] text-muted-foreground">
                        Reading the output…
                      </p>
                    ) : open.error ? (
                      <p role="alert" className="text-[13px] text-destructive">
                        {open.error}
                      </p>
                    ) : (
                      <pre
                        tabIndex={0}
                        aria-label={`Output of ${job.name}`}
                        className="max-h-64 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-[12px] leading-5"
                      >
                        {open.lines.length ? open.lines.join("\n") : "It has not printed anything yet."}
                      </pre>
                    )}
                  </div>
                ) : null}
                </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {statusError ? (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {statusError}. The list shows what Egg has saved; last runs may be out of date.
        </p>
      ) : null}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={cn("mt-3 text-[13px]", message.ok ? "text-muted-foreground" : "text-destructive")}>
          {message.text}
        </p>
      ) : null}

      <form onSubmit={add} className="mt-5 grid gap-3 border-t pt-4 sm:grid-cols-2">
        <p className="text-[13px] font-medium sm:col-span-2">Add a job</p>
        <div>
          <Label htmlFor="job-name">Name</Label>
          <Input id="job-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly clean-up" maxLength={60} autoComplete="off" />
        </div>
        <div>
          <Label htmlFor="job-preset">Common schedules</Label>
          <NativeSelect id="job-preset" value="" onChange={(e) => e.target.value && setSchedule(e.target.value)}>
            <option value="">Pick one to fill in the schedule</option>
            {PRESETS.map((p) => (
              <option key={p.schedule} value={p.schedule}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="job-schedule">Schedule (minute hour day month weekday)</Label>
          <Input
            id="job-schedule"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="job-schedule-hint"
          />
          <p id="job-schedule-hint" className={cn("mt-1 text-[13px]", preview.ok ? "text-muted-foreground" : "text-destructive")}>
            {preview.text}
          </p>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="job-command">Command</Label>
          <Input
            id="job-command"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="node scripts/cleanup.js"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            maxLength={500}
          />
          <p className="mt-1 text-[13px] text-muted-foreground">
            Runs in your current release. It stops after 30 minutes, and at most once every 5 minutes.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={adding || !name.trim() || !command.trim() || !preview.ok} className="px-3">
            {adding ? "Adding…" : "Add job"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
