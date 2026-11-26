"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowsClockwiseIcon,
  ArrowUpRightIcon,
  GlobeSimpleIcon,
  HardDrivesIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { api } from "@/components/api";
import { CopyField } from "@/components/copy-field";
import { DomainAppCheck, type AppCheckResult } from "@/components/domain-app-check";
import { Stagger } from "@/components/motion/stagger";
import { Swap } from "@/components/motion/swap";
import { StatusIndicator } from "@/components/status-dot";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

type DomainRow = {
  id: string;
  domain: string;
  port: number;
  status: "pending" | "valid" | "invalid";
  nestUsername: string;
  projectName: string | null;
  projectId: string | null;
  /** nest: a name Nest hands out. subdomain: under a domain already verified here. custom: needs a DNS record. */
  kind: "nest" | "subdomain" | "custom";
  cname: string | null;
  txt: string | null;
  /** Shown as active, but the DNS record is gone. */
  dnsWarning?: boolean;
};

type Instructions = {
  steps: string[];
  cname: { name: string; value: string } | null;
  txt: { name: string; value: string } | null;
};

const DNS_LOST = "DNS no longer points here. Check your record.";

function statusFor(d: DomainRow): { label: string; tone: "ready" | "neutral" | "error" } {
  if (d.status === "invalid" || d.dnsWarning) return { label: "Needs attention", tone: "error" };
  if (d.status === "valid") return { label: "Active", tone: "ready" };
  return { label: d.kind === "custom" ? "Waiting for DNS" : "Not checked", tone: "neutral" };
}

/** The records a custom domain can use, and the next two steps, shown while it waits for DNS. */
function RecordsToAdd({ d }: { d: DomainRow }) {
  if (!d.cname || !d.txt) return null;
  return (
    <div className="mt-2 max-w-[60ch] space-y-2">
      <p className="text-label text-foreground">
        At your DNS provider, add a CNAME record for <span className="font-mono">{d.domain}</span> pointing to:
      </p>
      <CopyField label={`CNAME value for ${d.domain}`} value={d.cname} />
      <p className="text-label text-muted-foreground">Or a TXT record on the same name with the value:</p>
      <CopyField label={`TXT value for ${d.domain}`} value={d.txt} />
      <p className="text-label text-muted-foreground">
        Then add the domain on the Domains page of your Nest dashboard, with target port{" "}
        <span className="font-mono">{d.port}</span>, and press Check.
      </p>
    </div>
  );
}

const FIELD_LABEL = "mb-1.5 block text-label text-muted-foreground";

export function DomainsView({
  initial,
  servers,
  projects,
}: {
  initial: DomainRow[];
  servers: { id: string; nestUsername: string }[];
  projects: { id: string; name: string; port: number; serverId: string }[];
}) {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState("");
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState<{ field: "domain" | "port"; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [instructions, setInstructions] = useState<{ domain: string; port: number; data: Instructions } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  // Why the last check failed, kept apart from notes so it can sit under a "Needs attention" row.
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState<string | null>(null);
  const [appResults, setAppResults] = useState<Record<string, AppCheckResult>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [editProject, setEditProject] = useState("");
  const [editPort, setEditPort] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const server = servers[0];
  // The tour points at the first domain whose app has not answered a check yet, and at the first one shown as active.
  // A Nest name is saved as active at once, but only a check that gets an answer shows the address works.
  const answered = (id: string) => {
    const r = appResults[id];
    return Boolean(r) && !r!.skipped && r!.problem === null && r!.answers.some((a) => a.ok);
  };
  const waitingId = initial.find((d) => !answered(d.id))?.id;
  const activeId = initial.find((d) => d.status === "valid" && !d.dnsWarning)?.id;

  function pickProject(id: string) {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p) setPort(String(p.port));
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      setError({ field: "port", text: "Enter a port between 1 and 65535." });
      return;
    }
    setAdding(true);
    try {
      const res = await api<{ instructions: Instructions }>("/api/domains", {
        body: { serverId: server.id, domain, port: n, projectId: projectId || null },
      });
      setInstructions({ domain: domain.trim().toLowerCase(), port: n, data: res.instructions });
      setDomain("");
      setPort("");
      setProjectId("");
      router.refresh();
    } catch (err) {
      setError({
        field: "domain",
        text: err instanceof Error ? err.message : "Could not add the domain",
      });
    } finally {
      setAdding(false);
    }
  }

  async function check(id: string) {
    setChecking(id);
    try {
      const r = await api<{ status: string; reason: string | null; app?: AppCheckResult }>(
        `/api/domains/${id}/verify`,
        { method: "POST" }
      );
      const app = r.app;
      if (app) setAppResults((a) => ({ ...a, [id]: app }));
      const failed = r.status === "invalid";
      setReasons((x) => ({ ...x, [id]: failed ? (r.reason ?? "") : "" }));
      setNotes((n) => ({ ...n, [id]: failed ? "" : (r.reason ?? "") }));
      router.refresh();
    } catch (err) {
      setNotes((n) => ({ ...n, [id]: err instanceof Error ? err.message : "Check failed" }));
    } finally {
      setChecking(null);
    }
  }

  function startEdit(d: DomainRow) {
    setEditId(d.id);
    setEditProject(d.projectId ?? "");
    setEditPort(String(d.port));
    setEditError(null);
    // The form mounts on the next render; move focus into it once it exists.
    window.requestAnimationFrame(() => document.getElementById(`edit-project-${d.id}`)?.focus());
  }

  /** Close the edit form and put focus back on the button that opened it. */
  function stopEdit(id: string) {
    setEditId(null);
    window.requestAnimationFrame(() => document.getElementById(`edit-btn-${id}`)?.focus());
  }

  async function saveEdit(d: DomainRow) {
    const n = Number(editPort);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      setEditError("Enter a port between 1 and 65535.");
      return;
    }
    setSaving(true);
    setEditError(null);
    try {
      const res = await api<{ needsNestChange: boolean }>(`/api/domains/${d.id}`, {
        method: "PATCH",
        body: { projectId: editProject || null, port: n },
      });
      setNotes((x) => ({
        ...x,
        [d.id]: res.needsNestChange
          ? `Saved. Also change the target port to ${n} on the Domains page of your Nest dashboard, then press Check.`
          : "Saved.",
      }));
      stopEdit(d.id);
      router.refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  /** Throws on failure so the confirm dialog can show the message. */
  async function remove(id: string) {
    await api(`/api/domains/${id}`, { method: "DELETE" });
    router.refresh();
  }

  if (!server) {
    return (
      <EmptyState
        icon={<HardDrivesIcon />}
        title="Connect a server first"
        description="Domains are recorded against a Nest container, so there has to be one to point them at."
        action={
          <Link href="/connect" className={cn(buttonVariants())}>
            Connect a server
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={add}
        aria-label="Add a domain"
        data-tour="domain-form"
        className="rounded-lg bg-card shadow-border-small"
      >
        <div className="grid gap-4 p-4 md:grid-cols-[1fr_1fr_130px]">
          <div>
            <label htmlFor="dom-name" className={FIELD_LABEL}>
              Domain
            </label>
            <Input
              id="dom-name"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="app.example.com"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error?.field === "domain" || undefined}
              aria-describedby="dom-help"
            />
          </div>
          <div>
            <label htmlFor="dom-project" className={FIELD_LABEL}>
              Project (optional)
            </label>
            <NativeSelect
              id="dom-project"
              value={projectId}
              onChange={(e) => pickProject(e.target.value)}
            >
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <label htmlFor="dom-port" className={FIELD_LABEL}>
              Target port
            </label>
            <Input
              id="dom-port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              inputMode="numeric"
              placeholder="3000"
              className="font-mono"
              aria-invalid={error?.field === "port" || undefined}
              aria-describedby="dom-help"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t bg-background-subtle px-4 py-3">
          <p
            id="dom-help"
            key={error ? "error" : "help"}
            role={error ? "alert" : undefined}
            className={cn("text-label", error ? "text-destructive" : "text-muted-foreground")}
          >
            {error?.text ??
              "Your Nest name is free. A custom domain needs a DNS record first. Egg shows it as active once DNS checks out."}
          </p>
          <Button type="submit" disabled={!domain.trim()} loading={adding}>
            {adding ? "Adding…" : "Add domain"}
          </Button>
        </div>
      </form>

      {instructions ? (
        <section aria-labelledby="next-steps" data-tour="domain-steps" className="motion-enter">
          <Alert
            tone="info"
            role="status"
            title={<h2 id="next-steps">Next: finish setup for {instructions.domain}</h2>}
          >
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              {instructions.data.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {instructions.data.cname && instructions.data.txt ? (
              <div className="mt-3 space-y-2">
                <p className="text-label">Add either one of these records:</p>
                <CopyField label="CNAME name" value={instructions.data.cname.name} />
                <CopyField label="CNAME value" value={instructions.data.cname.value} />
                <p className="text-label">or</p>
                <CopyField label="TXT name" value={instructions.data.txt.name} />
                <CopyField label="TXT value" value={instructions.data.txt.value} />
              </div>
            ) : null}
          </Alert>
        </section>
      ) : null}

      {initial.length === 0 ? (
        <EmptyState
          icon={<GlobeSimpleIcon />}
          title="No domains yet"
          description="Type a domain and its port above. Egg tells you which DNS record to add and shows the domain as active once DNS checks out. Nest does the routing, so add the same domain on its dashboard too."
        />
      ) : (
        <Stagger
          as="ul"
          className="hairline-y overflow-hidden rounded-lg bg-card shadow-border-small"
        >
          {initial.map((d) => {
            const s = statusFor(d);
            return (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
                <div
                  data-tour={!instructions && d.id === waitingId ? "domain-steps" : undefined}
                  className="min-w-0 max-sm:w-full"
                >
                  <p className="truncate font-medium tracking-[-0.02em]">{d.domain}</p>
                  <p className="tabular text-label text-muted-foreground">
                    Port <span className="font-mono">{d.port}</span>
                    {d.projectName ? <> · {d.projectName}</> : null}
                  </p>
                  {notes[d.id] ? (
                    <p role="status" className="mt-1 text-label text-muted-foreground">
                      <Swap value={notes[d.id]}>{notes[d.id]}</Swap>
                    </p>
                  ) : null}
                  {d.status === "invalid" || d.dnsWarning ? (
                    <p id={`cause-${d.id}`} role="alert" className="mt-1 max-w-[60ch] text-label text-foreground">
                      {DNS_LOST}
                      {reasons[d.id] ? <> {reasons[d.id]}</> : null}
                    </p>
                  ) : reasons[d.id] ? (
                    <p id={`cause-${d.id}`} className="mt-1 max-w-[60ch] text-label text-foreground">
                      {reasons[d.id]}
                    </p>
                  ) : null}
                  {d.kind === "custom" && (d.status !== "valid" || d.dnsWarning) ? <RecordsToAdd d={d} /> : null}
                  <div role="status" aria-label={`App check for ${d.domain}`} data-tour={answered(d.id) ? "app-answers" : undefined}>
                    <DomainAppCheck result={appResults[d.id]} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-label">
                    <Swap value={s.label}>
                      <StatusIndicator tone={s.tone} label={s.label} />
                    </Swap>
                  </span>
                  {d.id === activeId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      data-tour="visit"
                      render={<a href={`https://${d.domain}`} target="_blank" rel="noreferrer" />}
                    >
                      Open
                      <ArrowUpRightIcon aria-hidden="true" />
                      <span className="sr-only"> {d.domain} (opens in a new tab)</span>
                    </Button>
                  ) : null}
                  <Button
                    variant={d.status === "invalid" || d.dnsWarning ? "default" : "outline"}
                    size="sm"
                    data-tour={d.id === waitingId ? "domain-check" : undefined}
                    disabled={checking === d.id}
                    aria-label={checking === d.id ? undefined : `Check ${d.domain}`}
                    aria-describedby={d.status === "invalid" || d.dnsWarning || reasons[d.id] ? `cause-${d.id}` : undefined}
                    onClick={() => void check(d.id)}
                  >
                    <ArrowsClockwiseIcon className={cn(checking === d.id && "animate-spin")} />
                    {checking === d.id ? "Checking…" : "Check"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    id={`edit-btn-${d.id}`}
                    aria-label={`Edit ${d.domain}`}
                    onClick={() => startEdit(d)}
                  >
                    <PencilSimpleIcon />
                  </Button>
                  <ConfirmDialog
                    tone="destructive"
                    title={`Remove ${d.domain}?`}
                    description="This removes the record from Egg."
                    confirmLabel="Remove"
                    pendingLabel="Removing…"
                    onConfirm={() => remove(d.id)}
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${d.domain}`}>
                        <TrashIcon />
                      </Button>
                    }
                  />
                </div>
                {editId === d.id ? (
                  <form
                    className="motion-enter grid w-full gap-3 border-t pt-3 sm:grid-cols-[1fr_130px_auto] sm:items-end"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveEdit(d);
                    }}
                  >
                    <div>
                      <label htmlFor={`edit-project-${d.id}`} className={FIELD_LABEL}>
                        Project
                      </label>
                      <NativeSelect
                        id={`edit-project-${d.id}`}
                        value={editProject}
                        onChange={(e) => {
                          setEditProject(e.target.value);
                          const p = projects.find((x) => x.id === e.target.value);
                          if (p) setEditPort(String(p.port));
                        }}
                      >
                        <option value="">None</option>
                        {projects
                          .filter((p) => servers.find((s) => s.nestUsername === d.nestUsername)?.id === p.serverId)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </NativeSelect>
                    </div>
                    <div>
                      <label htmlFor={`edit-port-${d.id}`} className={FIELD_LABEL}>
                        Target port
                      </label>
                      <Input
                        id={`edit-port-${d.id}`}
                        value={editPort}
                        onChange={(e) => setEditPort(e.target.value)}
                        inputMode="numeric"
                        className="font-mono"
                        aria-invalid={editError ? true : undefined}
                        aria-describedby={editError ? `edit-error-${d.id}` : undefined}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" loading={saving}>
                        {saving ? "Saving…" : "Save"}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => stopEdit(d.id)}>
                        Cancel
                      </Button>
                    </div>
                    {editError ? (
                      <p
                        id={`edit-error-${d.id}`}
                        role="alert"
                        className="text-label text-destructive sm:col-span-3"
                      >
                        {editError}
                      </p>
                    ) : null}
                  </form>
                ) : null}
              </li>
            );
          })}
        </Stagger>
      )}
    </div>
  );
}
