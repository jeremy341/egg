"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import type { GreenhouseAdminWorkspaceView, GreenhouseWorkspaceView } from "@/server/grafts/greenhouse";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";

type ProjectOption = { id: string; name: string; slug: string };
const statusLabel: Record<GreenhouseWorkspaceView["status"], string> = {
  draft: "Draft", active: "Active", review: "In review", complete: "Complete",
};

export function GreenhouseBoard({
  initialProjects,
  initialWorkspaces,
  initialAdminWorkspaces,
  isAdmin,
}: {
  initialProjects: ProjectOption[];
  initialWorkspaces: GreenhouseWorkspaceView[];
  initialAdminWorkspaces: GreenhouseAdminWorkspaceView[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [projects] = useState(initialProjects);
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [adminWorkspaces, setAdminWorkspaces] = useState(initialAdminWorkspaces);
  const [projectId, setProjectId] = useState(initialProjects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ id: string }>("/api/grafts/greenhouse/workspaces", {
        method: "POST",
        body: { projectId, title, goal, branch },
      });
      router.push(`/grafts/greenhouse/${result.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function removeAdminWorkspace(workspace: GreenhouseAdminWorkspaceView) {
    if (!window.confirm(`Remove “${workspace.title}” from ${workspace.owner}'s Greenhouse?`)) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/grafts/greenhouse/workspaces/${workspace.id}`, { method: "DELETE" });
      setAdminWorkspaces((current) => current.filter((row) => row.id !== workspace.id));
      setWorkspaces((current) => current.filter((row) => row.id !== workspace.id));
      setNotice("Workspace removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the workspace.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-label text-muted-foreground">Egg app</p>
        <h1 className="mt-1 text-title-1">Greenhouse</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Organize focused work around an Egg project. Each workspace holds a goal, branch reference, and review notes, with direct links to the project tools you already have access to.</p>
        <p className="mt-2 max-w-2xl text-label text-subtle-foreground">Greenhouse records do not launch a separate machine, run an agent, or change project files.</p>
      </header>
      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}
      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}

      <section className="rounded-lg bg-card p-5 shadow-border-small" aria-labelledby="new-workspace-heading">
        <h2 id="new-workspace-heading" className="text-title-2">Start a workspace</h2>
        {projects.length ? (
          <form onSubmit={create} className="mt-4 grid gap-3">
            <label className="grid gap-1.5 text-label text-muted-foreground">Project
              <select className={fieldClass} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.slug}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-label text-muted-foreground">Workspace title
              <Input value={title} maxLength={120} minLength={3} required onChange={(e) => setTitle(e.target.value)} placeholder="Tighten the deploy status flow" />
            </label>
            <label className="grid gap-1.5 text-label text-muted-foreground">Goal
              <textarea value={goal} maxLength={4000} required rows={4} className={`${fieldClass} h-auto resize-y py-2`} onChange={(e) => setGoal(e.target.value)} placeholder="Describe the change and how you will know it is ready." />
            </label>
            <label className="grid gap-1.5 text-label text-muted-foreground">Branch reference <span className="font-normal">(optional)</span>
              <Input value={branch} maxLength={255} onChange={(e) => setBranch(e.target.value)} placeholder="feature/deploy-status" />
            </label>
            <div><Button type="submit" loading={busy} disabled={busy || !projectId || title.trim().length < 3 || !goal.trim()}>Create workspace</Button></div>
          </form>
        ) : (
          <div className="mt-3 space-y-3"><p className="text-sm text-muted-foreground">Connect or create an Egg project before starting a workspace.</p><Link href="/projects" className={buttonVariants({ variant: "outline" })}>Open projects</Link></div>
        )}
      </section>

      <section aria-labelledby="my-workspaces-heading" className="space-y-3">
        <h2 id="my-workspaces-heading" className="text-title-2">Your workspaces</h2>
        {workspaces.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {workspaces.map((workspace) => (
              <article key={workspace.id} className="rounded-lg bg-card p-5 shadow-border-small">
                <div className="flex items-start justify-between gap-3"><h3 className="text-title-3"><Link href={`/grafts/greenhouse/${workspace.id}`} className="hover:underline">{workspace.title}</Link></h3><Badge variant="outline">{statusLabel[workspace.status]}</Badge></div>
                <p className="mt-2 text-label text-muted-foreground">{workspace.projectName} · {workspace.projectSlug}{workspace.branch ? ` · ${workspace.branch}` : ""}</p>
                <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{workspace.goal}</p>
                <Link href={`/grafts/greenhouse/${workspace.id}`} className={`${buttonVariants({ variant: "ghost", size: "sm" })} mt-3`}>Open workspace</Link>
                <Link href={`/projects/${workspace.projectSlug}`} className={`${buttonVariants({ variant: "ghost", size: "sm" })} mt-3`}>Open project</Link>
              </article>
            ))}
          </div>
        ) : <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No workspaces yet. Start one above.</p>}
      </section>

      {isAdmin ? (
        <section aria-labelledby="admin-workspaces-heading" className="space-y-3 border-t pt-5">
          <div><h2 id="admin-workspaces-heading" className="text-title-2">Instance administration</h2><p className="mt-1 text-sm text-muted-foreground">Review workspace ownership and remove records when they need cleanup.</p></div>
          <p className="text-label text-muted-foreground">{adminWorkspaces.length} workspace records shown (up to 250 most recently updated).</p>
          {adminWorkspaces.map((workspace) => (
            <article key={workspace.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-card p-4 shadow-border-small">
              <div className="min-w-0 flex-1"><p className="font-medium">{workspace.title}</p><p className="mt-1 text-label text-muted-foreground">{workspace.owner} · {workspace.projectName} · {statusLabel[workspace.status]}</p></div>
              <Button type="button" variant="destructive" size="sm" disabled={busy} onClick={() => void removeAdminWorkspace(workspace)}>Remove</Button>
            </article>
          ))}
        </section>
      ) : null}
    </div>
  );
}
