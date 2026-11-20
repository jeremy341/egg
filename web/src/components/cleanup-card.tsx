"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import { Card, Label } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/alert-dialog";

type Status = {
  id: string; scope: "account" | "project"; state: "draining" | "running" | "failed" | "done";
  step: string; notBefore: string; error: string | null; canCancel: boolean; recoveryRequired: boolean;
  items: Array<{ id: string; projectName: string; serverLabel: string; state: string; step: string; error: string | null; warnings: string[] }>;
};

export function CleanupCard({ name, projectId }: { name: string; projectId?: string }) {
  const router = useRouter();
  const endpoint = projectId ? `/api/projects/${encodeURIComponent(projectId)}/cleanup` : "/api/account/cleanup";
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [confirmIdle, setConfirmIdle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cleanupId = status?.id;
  const cleanupState = status?.state;
  useEffect(() => {
    let alive = true;
    void api<{ cleanup: Status | null }>(endpoint).then((r) => { if (alive) setStatus(r.cleanup); }).catch((err) => { if (alive) setError(err instanceof Error ? err.message : "Could not load cleanup status."); });
    return () => { alive = false; };
  }, [endpoint]);
  useEffect(() => {
    if (!cleanupId || cleanupState === "done") return;
    let alive = true;
    const poll = async () => {
      try {
        const response = await fetch(`/api/cleanup/${cleanupId}`, { cache: "no-store" });
        if (response.status === 401 && !projectId) { router.push("/login"); router.refresh(); return; }
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message ?? "Could not refresh cleanup status.");
        if (alive) setStatus(result.cleanup);
        if (result.cleanup.state === "done" && projectId) { router.push("/projects"); router.refresh(); }
      } catch (err) { if (alive) setError(err instanceof Error ? err.message : "Could not refresh cleanup status."); }
    };
    const timer = setInterval(() => void poll(), 5_000);
    return () => { alive = false; clearInterval(timer); };
  }, [cleanupId, cleanupState, projectId, router]);
  async function request() {
    const result = await api<{ cleanup: Status }>(endpoint, { method: "POST", body: { confirm: confirmation } });
    setStatus(result.cleanup); setError(null);
  }
  async function retry() {
    setBusy(true); setError(null);
    try { const result = await api<{ cleanup: Status }>(`/api/cleanup/${status!.id}`, { method: "PATCH", body: { confirmIdle } }); setStatus(result.cleanup); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not retry cleanup."); }
    finally { setBusy(false); }
  }
  async function cancel(acknowledge = false) {
    if (!status) return;
    setBusy(true); setError(null);
    try {
      await api(`/api/cleanup/${status.id}${acknowledge ? "?acknowledgeOrphans=true" : ""}`, { method: "DELETE" });
      setStatus(null); router.refresh();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "confirm_orphans" && window.confirm(err instanceof Error ? err.message : "")) {
        setBusy(false);
        await cancel(true);
        return;
      }
      setError(err instanceof Error ? err.message : "Could not cancel cleanup.");
    } finally { setBusy(false); }
  }
  return <Card id={projectId ? "cleanup-project-heading" : "cleanup-account-heading"} title={projectId ? "Clean up this project" : "Clean up and delete account"} tone="danger" description="Pause new work, drain for five minutes, then remove verified Egg-managed services and deployed code. Account records are kept if a remote step fails.">
    <div className="space-y-4 text-sm">
      <p>Shared application data and your GitHub repositories are preserved. GitHub App installations may be shared, so <a className="link underline" href="https://github.com/settings/installations" target="_blank" rel="noreferrer">uninstall or restrict them on GitHub</a> yourself. Remove Egg’s SSH key in the <a className="link underline" href="https://dashboard.hackclub.app" target="_blank" rel="noreferrer">Nest dashboard</a> after cleanup; Egg cannot revoke that dashboard permission.</p>
      <p>Once remote cleanup starts it cannot be undone. Stopping services causes downtime; the five-minute delay does not migrate traffic or guarantee that every application request finishes. Existing deployments and remote sessions must finish before removal begins. A stopped or unreachable server keeps the request blocked for review and retry. Canceling a drain does not restart deployments already canceled by the cleanup request.</p>
      {status ? <div className="space-y-3 rounded-md border p-3" role="status">
        <p className="font-medium">{status.state === "draining" ? "Draining" : status.state === "running" ? "Cleaning up" : status.state === "failed" ? "Cleanup needs attention" : "Cleanup complete"}</p>
        <p className="text-muted-foreground">{status.step.replaceAll("_", " ")}{status.state === "draining" ? ` · removal starts no earlier than ${new Date(status.notBefore).toLocaleString()}` : ""}</p>
        {status.error ? <Alert tone="error">{status.error}</Alert> : null}
        {status.items.length ? <ul className="space-y-2">{status.items.map((item) => <li key={item.id} className="border-t pt-2"><p className="font-medium">{item.projectName} · {item.state}</p><p className="text-muted-foreground">{item.serverLabel} · {item.step.replaceAll("_", " ")}</p>{item.error ? <p className="mt-1 text-destructive">{item.error}</p> : null}{item.warnings.map((warning) => <p key={warning} className="mt-1 text-muted-foreground">{warning}</p>)}</li>)}</ul> : null}
        {status.recoveryRequired ? <Alert tone="error">The prior worker did not confirm completion. Do not retry until you have verified that it and its remote commands have stopped.</Alert> : null}
        {(status.state === "failed" || status.recoveryRequired) ? <><label className="flex items-start gap-2"><input type="checkbox" checked={confirmIdle} onChange={(e) => setConfirmIdle(e.target.checked)} className="mt-1" /><span>I checked the affected server and confirmed that no prior Egg cleanup command or remote session is still running.</span></label><Button variant="outline" disabled={busy || (status.recoveryRequired && !confirmIdle)} onClick={() => void retry()}>Retry after another five-minute drain</Button></> : null}
        {status.canCancel ? <Button variant="outline" disabled={busy} onClick={() => void cancel()}>Cancel cleanup before removal starts</Button> : null}
      </div> : <><Label htmlFor={`cleanup-confirm-${projectId ?? "account"}`}>Type <span className="font-mono">{name}</span> to confirm</Label><Input id={`cleanup-confirm-${projectId ?? "account"}`} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" /><ConfirmDialog trigger={<Button variant="destructive" disabled={confirmation !== name}>Review full cleanup</Button>} title={projectId ? "Schedule project cleanup?" : "Schedule account cleanup and deletion?"} description="This blocks new work immediately. After five minutes, Egg removes only resources it can verify it created; shared data, GitHub repositories and the Nest dashboard SSH key stay for you to manage." confirmLabel="Start five-minute drain" pendingLabel="Scheduling…" tone="destructive" onConfirm={request} /></>}
      {error ? <Alert role="alert" tone="error">{error}</Alert> : null}
    </div>
  </Card>;
}
