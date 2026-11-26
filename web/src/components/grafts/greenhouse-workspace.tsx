"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import type { GreenhouseNoteView, GreenhouseWorkspaceView } from "@/server/grafts/greenhouse";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";

type WorkspaceData = { workspace: GreenhouseWorkspaceView; notes: GreenhouseNoteView[] };
const statusLabel: Record<GreenhouseWorkspaceView["status"], string> = {
  draft: "Draft", active: "Active", review: "In review", complete: "Complete",
};

export function GreenhouseWorkspace({ initial, workspaceId, userId }: { initial: WorkspaceData; workspaceId: string; userId: string }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [title, setTitle] = useState(initial.workspace.title);
  const [goal, setGoal] = useState(initial.workspace.goal);
  const [branch, setBranch] = useState(initial.workspace.branch ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      const result = await api<WorkspaceData>(`/api/grafts/greenhouse/workspaces/${workspaceId}`);
      setData(result);
      setTitle(result.workspace.title);
      setGoal(result.workspace.goal);
      setBranch(result.workspace.branch ?? "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this workspace.");
    }
  }

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/grafts/greenhouse/workspaces/${workspaceId}`, { method: "PATCH", body: patch });
      await refresh();
      setNotice("Workspace updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/grafts/greenhouse/workspaces/${workspaceId}/notes`, { method: "POST", body: { body: note } });
      setNote("");
      await refresh();
      setNotice("Review note added.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the note.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove this workspace and its notes? The Egg project will stay as it is.")) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/grafts/greenhouse/workspaces/${workspaceId}`, { method: "DELETE" });
      router.push("/grafts/greenhouse");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the workspace.");
      setBusy(false);
    }
  }

  const workspace = data.workspace;
  const ownsWorkspace = workspace.userId === userId;

  return (
    <div className="space-y-5">
      <Link href="/grafts/greenhouse" className="text-sm text-link hover:underline">← Greenhouse</Link>
      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}
      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-label text-muted-foreground">{workspace.projectName} · {workspace.projectSlug}</p><h1 className="mt-1 text-title-1">{workspace.title}</h1></div>
        <Badge variant="outline">{statusLabel[workspace.status]}</Badge>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <main className="space-y-4">
          <section className="rounded-lg bg-card p-5 shadow-border-small" aria-labelledby="workspace-goal-heading">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="workspace-goal-heading" className="text-title-2">Goal and branch</h2><Link href={`/projects/${workspace.projectSlug}`} className="text-sm text-link hover:underline">Open Egg project</Link></div>
            {ownsWorkspace ? (
              <form onSubmit={(e) => { e.preventDefault(); void save({ title, goal, branch: branch.trim() || null }); }} className="mt-4 space-y-3">
                <label className="grid gap-1.5 text-label text-muted-foreground">Title<Input value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} /></label>
                <label className="grid gap-1.5 text-label text-muted-foreground">Goal<textarea value={goal} maxLength={4000} rows={5} required className={`${fieldClass} h-auto resize-y py-2`} onChange={(e) => setGoal(e.target.value)} /></label>
                <label className="grid gap-1.5 text-label text-muted-foreground">Branch reference<Input value={branch} maxLength={255} onChange={(e) => setBranch(e.target.value)} placeholder="Optional" /></label>
                <Button type="submit" variant="outline" loading={busy} disabled={busy || !title.trim() || !goal.trim()}>Save details</Button>
              </form>
            ) : <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{workspace.goal}</p>}
          </section>
          <section aria-labelledby="workspace-notes-heading" className="space-y-3">
            <h2 id="workspace-notes-heading" className="text-title-2">Review notes</h2>
            {data.notes.length ? data.notes.map((item) => (
              <article key={item.id} className="rounded-lg bg-card p-4 shadow-border-small"><p className="text-label text-muted-foreground">{item.author} · {item.createdAt.slice(0, 16).replace("T", " ")} UTC</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{item.body}</p></article>
            )) : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Add a note as you work through this project.</p>}
            {ownsWorkspace ? <form onSubmit={addNote} className="rounded-lg bg-card p-5 shadow-border-small"><label htmlFor="workspace-note" className="mb-2 block text-label text-muted-foreground">Add a note</label><textarea id="workspace-note" value={note} maxLength={8000} rows={3} required className={`${fieldClass} h-auto resize-y py-2`} onChange={(e) => setNote(e.target.value)} /><Button type="submit" className="mt-3" loading={busy} disabled={busy || !note.trim()}>Add note</Button></form> : null}
          </section>
        </main>
        <aside className="space-y-4">
          <section className="rounded-lg bg-card p-5 shadow-border-small" aria-labelledby="workspace-tools-heading">
            <h2 id="workspace-tools-heading" className="text-title-3">Egg project tools</h2>
            <div className="mt-3 grid gap-2">
              <Link href={`/projects/${workspace.projectSlug}`} className="text-sm text-link hover:underline">Overview</Link>
              <Link href={`/projects/${workspace.projectSlug}/deployments`} className="text-sm text-link hover:underline">Deployments</Link>
              <Link href={`/projects/${workspace.projectSlug}/files`} className="text-sm text-link hover:underline">Files</Link>
              <Link href={`/projects/${workspace.projectSlug}/terminal`} className="text-sm text-link hover:underline">Terminal</Link>
            </div>
            <p className="mt-3 text-label text-subtle-foreground">Each page keeps its existing project and container permission checks.</p>
          </section>
          {ownsWorkspace ? <section className="rounded-lg bg-card p-5 shadow-border-small" aria-labelledby="workspace-status-heading"><h2 id="workspace-status-heading" className="text-title-3">Status</h2><p className="mt-1 text-sm text-muted-foreground">Track where this piece of work stands.</p><div className="mt-3 grid gap-2">{(["draft", "active", "review", "complete"] as const).map((status) => <Button key={status} type="button" size="sm" variant={workspace.status === status ? "secondary" : "outline"} disabled={busy || workspace.status === status} onClick={() => void save({ status })}>{statusLabel[status]}</Button>)}</div></section> : null}
          {ownsWorkspace ? <Button type="button" variant="destructive" onClick={() => void remove()} disabled={busy}>Remove workspace</Button> : null}
          <p className="text-label text-subtle-foreground">Created {workspace.createdAt.slice(0, 10)} · Updated {workspace.updatedAt.slice(0, 10)} UTC</p>
        </aside>
      </div>
    </div>
  );
}
