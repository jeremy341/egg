"use client";

import { useState } from "react";
import { DownloadSimpleIcon, ShieldCheckIcon, TrashIcon } from "@phosphor-icons/react";
import { api } from "@/components/api";
import { SafeReportMarkdown } from "@/components/safe-report-markdown";
import { Segmented } from "@/components/segmented";
import { StatusIndicator } from "@/components/status-dot";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

type Status = "new" | "reviewing" | "resolved";

type Summary = {
  id: string;
  title: string;
  status: Status;
  createdAt: string;
  anonymous: boolean;
  evidenceCount: number;
};
type Report = {
  id: string;
  status: Status;
  createdAt: string;
  payload: {
    title: string;
    location: string;
    impact: string;
    details: string;
    anonymous: boolean;
    name?: string;
    contact?: string;
    evidence: { name: string; type: string }[];
  };
};

const STATUS: Record<Status, { label: string; tone: "warning" | "building" | "ready" }> = {
  new: { label: "New", tone: "warning" },
  reviewing: { label: "Reviewing", tone: "building" },
  resolved: { label: "Resolved", tone: "ready" },
};

const STATUS_OPTIONS = (Object.keys(STATUS) as Status[]).map((value) => ({ value, label: STATUS[value].label }));

/** One labelled fact of a report. */
function Field({ label, children, mono = false }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 break-words whitespace-pre-wrap", mono && "font-mono text-label")}>{children}</dd>
    </div>
  );
}

/**
 * The private inbox of vulnerability reports: the list on the left, the report
 * you opened on the right (under the list on a phone). A report is read from
 * the server only when it is opened.
 */
export function SecurityReportInbox({ initial }: { initial: Summary[] }) {
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function read(id: string) {
    setBusy(true);
    setError(null);
    try {
      setSelected(await api<Report>(`/api/admin/security-reports/${encodeURIComponent(id)}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the report.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(value: Status) {
    if (!selected || value === selected.status) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/security-reports/${selected.id}`, { method: "PATCH", body: { status: value } });
      setRows(rows.map((r) => (r.id === selected.id ? { ...r, status: value } : r)));
      setSelected({ ...selected, status: value });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the report.");
    } finally {
      setBusy(false);
    }
  }

  /** Throws on failure, so the confirm dialog stays open and shows the message. */
  async function remove() {
    if (!selected) return;
    await api(`/api/admin/security-reports/${selected.id}`, { method: "DELETE" });
    setRows(rows.filter((r) => r.id !== selected.id));
    setSelected(null);
  }

  return (
    <div className="space-y-6">
      <Alert tone="note">
        This inbox is limited to the exact account configured by the operator. Reports and images are encrypted in the
        database using APP_SECRET. Keep that key and backups private. Downloads are untrusted evidence: open them in a
        safe viewer, and do not run supplied code.
      </Alert>
      {error ? (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
        <section aria-labelledby="reports-heading" className="overflow-hidden rounded-lg bg-card shadow-border-small">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <h2 id="reports-heading" className="text-title-3">
              Reports
            </h2>
            <Badge variant="secondary" className="tabular">
              {rows.length}
            </Badge>
          </div>
          {rows.length ? (
            <ul className="hairline-y">
              {rows.map((r) => {
                const current = selected?.id === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void read(r.id)}
                      aria-current={current ? "true" : undefined}
                      className={cn(
                        "block w-full px-4 py-3 text-left transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] focus-visible:outline-offset-[-2px] disabled:cursor-wait",
                        current && "bg-[var(--ds-gray-alpha-100)]"
                      )}
                    >
                      <span className="block font-medium break-words">{r.title}</span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted-foreground">
                        <StatusIndicator tone={STATUS[r.status].tone} label={STATUS[r.status].label} className="font-normal" />
                        <time dateTime={r.createdAt} className="tabular">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </time>
                        <span>{r.anonymous ? "Anonymous" : "Identity supplied"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-5 text-muted-foreground">No reports yet.</p>
          )}
        </section>

        {selected ? (
          <article aria-labelledby="report-heading" className="min-w-0 overflow-hidden rounded-lg bg-card shadow-border-small">
            <header className="border-b px-4 py-4 sm:px-5">
              <p className="font-mono text-caption font-normal break-all text-muted-foreground">{selected.id}</p>
              <h2 id="report-heading" className="mt-1 text-title-2 break-words">
                {selected.payload.title}
              </h2>
              <p className="mt-1 text-label text-muted-foreground">
                Received <time dateTime={selected.createdAt}>{new Date(selected.createdAt).toLocaleString()}</time>
              </p>
              <Segmented
                className="mt-4"
                label="Report status"
                options={STATUS_OPTIONS}
                value={selected.status}
                onChange={(value) => void setStatus(value)}
              />
            </header>

            <dl className="grid gap-4 px-4 py-4 sm:px-5">
              <Field label="Identity">
                {selected.payload.anonymous
                  ? "Anonymous; no account identity attached"
                  : `${selected.payload.name || "No name supplied"}\n${selected.payload.contact || "No reply address supplied"}`}
              </Field>
              <Field label="Affected location" mono>
                {selected.payload.location || "Not supplied"}
              </Field>
              <Field label="Impact">{selected.payload.impact}</Field>
            </dl>

            <div className="border-t px-4 py-4 sm:px-5">
              <h3 className="mb-2 text-label font-normal text-muted-foreground">Steps, observations, and proof</h3>
              <SafeReportMarkdown source={selected.payload.details} />
            </div>

            {selected.payload.evidence.length ? (
              <div className="border-t px-4 py-4 sm:px-5">
                <h3 className="text-label font-normal text-muted-foreground">Evidence downloads</h3>
                <ul className="mt-2 flex flex-col gap-1">
                  {selected.payload.evidence.map((e, i) => (
                    <li key={i}>
                      <a
                        className="touch-target inline-flex min-w-0 items-center gap-2 font-medium underline-offset-4 hover:underline max-sm:min-h-10"
                        href={`/api/admin/security-reports/${selected.id}/evidence/${i}`}
                        download
                      >
                        <DownloadSimpleIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        <span className="break-all">{e.name}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-background-subtle px-4 py-3 sm:px-5">
              <p className="text-label text-muted-foreground">Deleting removes the report and its evidence from the live database.</p>
              <ConfirmDialog
                trigger={
                  <Button type="button" variant="destructive" disabled={busy}>
                    <TrashIcon aria-hidden="true" />
                    Delete report and evidence
                  </Button>
                }
                tone="destructive"
                title="Delete this report and its evidence?"
                description="This removes the report from the live database. Copies may remain in backups until their separate retention expires. This cannot be undone here."
                confirmLabel="Delete permanently"
                pendingLabel="Deleting…"
                onConfirm={remove}
              />
            </div>
          </article>
        ) : (
          <EmptyState
            icon={<ShieldCheckIcon />}
            title={rows.length ? "Choose a report" : "The inbox is empty"}
            description={
              rows.length
                ? "Choose a report to read its private details."
                : "Reports sent from the Security page appear here."
            }
          />
        )}
      </div>
    </div>
  );
}
