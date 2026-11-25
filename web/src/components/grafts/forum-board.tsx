"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import { FORUM_CATEGORIES, type ForumThreadView } from "@/server/grafts/forum";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, fieldClass } from "@/components/ui/input";

const categoryName = new Map(FORUM_CATEGORIES.map((category) => [category.id, category.label]));
const statusName: Record<ForumThreadView["status"], string> = {
  open: "Open",
  planned: "Planned",
  in_progress: "In progress",
  complete: "Complete",
  declined: "Declined",
};

export function ForumBoard({ initialThreads, userId, isAdmin }: { initialThreads: ForumThreadView[]; userId: string; isAdmin: boolean }) {
  const router = useRouter();
  const [threads, setThreads] = useState(initialThreads);
  const [category, setCategory] = useState<ForumThreadView["category"]>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ id: string }>("/api/grafts/forum/threads", {
        method: "POST",
        body: { category, title, body },
      });
      router.push(`/grafts/forum/${result.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the topic.");
    } finally {
      setBusy(false);
    }
  }

  async function vote(thread: ForumThreadView) {
    try {
      await api(`/api/grafts/forum/threads/${thread.id}/vote`, { method: thread.hasVoted ? "DELETE" : "POST" });
      setThreads((current) => current.map((row) => row.id === thread.id
        ? { ...row, hasVoted: !row.hasVoted, voteCount: row.voteCount + (row.hasVoted ? -1 : 1) }
        : row));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your vote.");
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-label text-muted-foreground">Egg app</p>
        <h1 className="mt-1 text-title-1">Forum</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Share a question, report a problem, or suggest a change. Instance administrators review topics and can lock or pin them.</p>
      </header>
      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}

      <section className="rounded-lg bg-card p-5 shadow-border-small" aria-labelledby="new-topic-heading">
        <h2 id="new-topic-heading" className="text-title-2">Start a topic</h2>
        <form onSubmit={create} className="mt-4 grid gap-3">
          <label className="grid gap-1.5 text-label text-muted-foreground">
            Category
            <select className={fieldClass} value={category} onChange={(e) => setCategory(e.target.value as ForumThreadView["category"])}>
              {FORUM_CATEGORIES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-label text-muted-foreground">
            Title
            <Input value={title} maxLength={140} minLength={4} required onChange={(e) => setTitle(e.target.value)} placeholder="What should people know?" />
          </label>
          <label className="grid gap-1.5 text-label text-muted-foreground">
            Details
            <textarea value={body} maxLength={12000} required rows={4} className={`${fieldClass} h-auto resize-y py-2`} onChange={(e) => setBody(e.target.value)} placeholder="Add context, steps to reproduce, or the outcome you hope for." />
          </label>
          <div><Button type="submit" loading={busy} disabled={busy || title.trim().length < 4 || !body.trim()}>Post topic</Button></div>
        </form>
      </section>

      <section aria-labelledby="topics-heading" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div><h2 id="topics-heading" className="text-title-2">Recent topics</h2><p className="mt-1 text-sm text-muted-foreground">{isAdmin ? "You can moderate each topic after opening it." : "Vote for topics you would like the instance to prioritize."}</p></div>
          <Badge variant="outline">{threads.length} topics</Badge>
        </div>
        {threads.length ? (
          <div className="space-y-2">
            {threads.map((thread) => (
              <article key={thread.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-card p-4 shadow-border-small">
                <Button type="button" variant={thread.hasVoted ? "secondary" : "outline"} size="sm" aria-pressed={thread.hasVoted} onClick={() => void vote(thread)}>
                  {thread.hasVoted ? "Voted" : "Vote"} · {thread.voteCount}
                </Button>
                <div className="min-w-0 flex-1">
                  <Link href={`/grafts/forum/${thread.id}`} className="font-medium hover:underline">{thread.title}</Link>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{thread.body}</p>
                  <p className="mt-2 text-label text-subtle-foreground">{categoryName.get(thread.category)} · {thread.authorId === userId ? "You" : thread.author} · {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  {thread.pinned ? <Badge variant="secondary">Pinned</Badge> : null}
                  <Badge variant="outline">{statusName[thread.status]}</Badge>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No topics yet. Start the first one above.</p>}
      </section>
    </div>
  );
}
