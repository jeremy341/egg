"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { api } from "@/components/api";
import { PageHeader } from "@/components/page-header";
import { Label } from "@/components/settings-ui";
import { StatusIndicator } from "@/components/status-dot";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { adminOverview } from "@/server/admin";
import type { MaintenanceState } from "@/server/maintenance";

type Overview = Awaited<ReturnType<typeof adminOverview>>;

const number = new Intl.NumberFormat("en");

/** An ISO time as the value of a datetime-local field, in this browser's time zone. */
function localDate(value: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const CARD = "overflow-hidden rounded-lg bg-card shadow-border-small";

/** A count for each state of a queue. A few small numbers read best as a list, so this is not a chart. */
function StatusList({ rows }: { rows: { state: string; count: number }[] }) {
  if (rows.length === 0) return <p className="px-4 py-4 text-muted-foreground">No records yet.</p>;
  return (
    <dl className="hairline-y">
      {rows.map((row) => (
        <div key={row.state} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
          <dt className="text-muted-foreground capitalize">{row.state}</dt>
          <dd className="tabular font-mono text-label">{number.format(row.count)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One queue: its name, the counts, a line on what an operator does about it, and an optional action. */
function QueueCard({
  id,
  title,
  rows,
  note,
  action,
}: {
  id: string;
  title: string;
  rows: { state: string; count: number }[];
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn(CARD, "flex flex-col")}>
      <div className="border-b px-4 py-3">
        <h2 id={id} className="text-title-3">
          {title}
        </h2>
      </div>
      <StatusList rows={rows} />
      {note || action ? (
        <div className="mt-auto flex flex-col items-start gap-3 border-t px-4 py-3">
          {note ? <p className="text-caption font-normal text-muted-foreground">{note}</p> : null}
          {action}
        </div>
      ) : null}
    </section>
  );
}

export function AdminDashboard({ initial }: { initial: Overview }) {
  const [overview, setOverview] = useState(initial);
  const [enabled, setEnabled] = useState(initial.maintenance.enabled);
  const [message, setMessage] = useState(initial.maintenance.message);
  const [startsAt, setStartsAt] = useState(localDate(initial.maintenance.startsAt));
  const [endsAt, setEndsAt] = useState(localDate(initial.maintenance.endsAt));
  /** Which request is running, so only the button that started it shows the loader. */
  const [pending, setPending] = useState<"refresh" | "save" | null>(null);
  const busy = pending !== null;
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function refresh() {
    setPending("refresh");
    setError(null);
    try {
      setOverview(await api<Overview>("/api/admin/overview"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh administration.");
    } finally {
      setPending(null);
    }
  }

  async function save(stop = false) {
    setPending("save");
    setError(null);
    setSaved(false);
    try {
      const { maintenance } = await api<{ maintenance: MaintenanceState }>("/api/admin/maintenance", {
        method: "PUT",
        body: {
          enabled: stop ? false : enabled,
          message,
          startsAt: stop || !startsAt ? null : new Date(startsAt).toISOString(),
          endsAt: stop || !endsAt ? null : new Date(endsAt).toISOString(),
        },
      });
      setEnabled(maintenance.enabled);
      setStartsAt(localDate(maintenance.startsAt));
      setEndsAt(localDate(maintenance.endsAt));
      setOverview({ ...overview, maintenance });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save maintenance.");
    } finally {
      setPending(null);
    }
  }

  const active = overview.maintenance.active;
  const totals: [string, number][] = [
    ["Accounts", overview.users],
    ["Projects", overview.projects],
    ["Servers", overview.servers],
  ];

  return (
    <div className="motion-enter space-y-6">
      <PageHeader
        title="Instance administration"
        description="Operational controls for this Egg installation. Your usual project and account tools remain available."
        actions={
          <Button variant="outline" disabled={busy} loading={pending === "refresh"} onClick={() => void refresh()}>
            <ArrowClockwiseIcon aria-hidden="true" />
            Refresh status
          </Button>
        }
      />

      <dl className="grid grid-cols-3 gap-4">
        {totals.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-card p-4 shadow-border-small">
            <dt className="text-label text-muted-foreground">{label}</dt>
            <dd className="tabular mt-1 text-title-2 sm:text-stat">{number.format(value)}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="maintenance-heading" className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3">
          <div className="min-w-0">
            <h2 id="maintenance-heading" className="text-title-3">
              Maintenance window
            </h2>
            <p className="mt-0.5 max-w-[70ch] text-label text-muted-foreground">
              Pause ordinary changes and new deployments while people can still read their data. Running deployments
              finish, and cancellation and cleanup recovery remain available.
            </p>
          </div>
          <StatusIndicator
            tone={active ? "warning" : "neutral"}
            label={active ? "Read-only now" : overview.maintenance.enabled ? "Scheduled or ended" : "Off"}
            className="shrink-0"
          />
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="space-y-5 p-4">
            <label className="flex cursor-pointer items-center gap-3 font-medium max-sm:min-h-10">
              <input
                type="checkbox"
                className="size-4 shrink-0"
                checked={enabled}
                onChange={(event) => {
                  setEnabled(event.target.checked);
                  setSaved(false);
                }}
              />
              Enable a read-only maintenance window
            </label>
            <div>
              <Label htmlFor="maintenance-message">Notice for users</Label>
              <textarea
                id="maintenance-message"
                value={message}
                maxLength={500}
                onChange={(event) => {
                  setMessage(event.target.value);
                  setSaved(false);
                }}
                className={cn(fieldClass, "h-auto min-h-24 resize-y py-2 max-sm:h-auto")}
                placeholder="We are updating Egg. Your existing apps remain online."
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="maintenance-start">Start (optional)</Label>
                <Input
                  id="maintenance-start"
                  type="datetime-local"
                  value={startsAt}
                  aria-describedby="maintenance-start-hint"
                  onChange={(event) => {
                    setStartsAt(event.target.value);
                    setSaved(false);
                  }}
                />
                <p id="maintenance-start-hint" className="mt-1.5 text-caption font-normal text-muted-foreground">
                  Leave empty to start when saved. Times use this browser’s timezone.
                </p>
              </div>
              <div>
                <Label htmlFor="maintenance-end">End (optional)</Label>
                <Input
                  id="maintenance-end"
                  type="datetime-local"
                  value={endsAt}
                  aria-describedby="maintenance-end-hint"
                  onChange={(event) => {
                    setEndsAt(event.target.value);
                    setSaved(false);
                  }}
                />
                <p id="maintenance-end-hint" className="mt-1.5 text-caption font-normal text-muted-foreground">
                  Leave empty to end the window manually.
                </p>
              </div>
            </div>
            <p className="max-w-[80ch] text-label text-muted-foreground">
              The configured administrator keeps normal access. Maintenance pauses new work; it does not stop deployed
              applications, disable infrastructure access, or act as a backup.
            </p>
            <Alert tone="warning">
              GitHub App events are refused during this window, including pushes, preview cleanup, repository renames,
              and installation updates. GitHub does not automatically retry failed deliveries. After maintenance,
              redeliver failed events from GitHub; a missed push can also be deployed manually. This applies to
              administrator-owned repositories too.
            </Alert>
            {error ? (
              <Alert tone="error" role="alert">
                {error}
              </Alert>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t bg-background-subtle px-4 py-3">
            <Button type="submit" disabled={busy} loading={pending === "save"}>
              Save window
            </Button>
            {overview.maintenance.enabled ? (
              <Button type="button" variant="outline" disabled={busy} onClick={() => void save(true)}>
                End maintenance now
              </Button>
            ) : null}
            <p role="status" className="text-label text-muted-foreground">
              {saved ? "Saved. Open pages refresh their notice within 30 seconds." : null}
            </p>
          </div>
        </form>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <QueueCard
          id="queue-heading"
          title="Deployment queue"
          rows={overview.jobs}
          note="Stale jobs stay blocked until an operator verifies remote work has stopped."
        />
        <QueueCard
          id="cleanup-heading"
          title="Cleanup operations"
          rows={overview.cleanup}
          note="Owners review and retry their cleanup from Account or project settings."
        />
        <QueueCard
          id="inbox-heading"
          title="Vulnerability inbox"
          rows={overview.reports}
          action={
            <Link href="/security/reports" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Open private inbox
            </Link>
          }
        />
      </div>

      <section aria-labelledby="changes-heading" className={CARD}>
        <div className="border-b px-4 py-3">
          <h2 id="changes-heading" className="text-title-3">
            Recent administration changes
          </h2>
        </div>
        {overview.events.length ? (
          <ul className="hairline-y">
            {overview.events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
                <span>Maintenance settings updated</span>
                <time dateTime={event.at} className="tabular font-mono text-caption font-normal text-muted-foreground">
                  {new Date(event.at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-5 text-muted-foreground">Administration changes appear here after they are saved.</p>
        )}
        <p className="border-t px-4 py-3 text-caption font-normal text-muted-foreground">
          Access is granted by an exact account ID in the operator’s configuration. This dashboard does not expose
          stored keys, environment variables, or other users’ files.
        </p>
      </section>
    </div>
  );
}
