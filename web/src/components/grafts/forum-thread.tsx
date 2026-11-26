"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import { FORUM_CATEGORIES, type ForumReplyView, type ForumThreadView } from "@/server/grafts/forum";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/ui/input";

type ThreadData = { thread: ForumThreadView; replies: ForumReplyView[] };
const statusName: Record<ForumThreadView["status"], string> = {
  open: "Open", planned: "Planned", in_progress: "In progress", complete: "Complete", declined: "Declined",
};

export function ForumThread({ initial, threadId, userId, isAdmin }: { initial: ThreadData; threadId: string; userId: string; isAdmin: boolean }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api<ThreadData>(`/api/grafts/forum/threads/${threadId}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load this topic.");
    }
  }, [threadId]);

  async function addReply(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/grafts/forum/threads/${threadId}/replies`, { method: "POST", body: { body: reply } });
      setReply("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post your reply.");
    } finally {
      setBusy(false);
    }
  }

  async function moderate(patch: { status?: ForumThreadView["status"]; priority?: ForumThreadView["priority"]; pinned?: boolean; locked?: boolean }) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/grafts/forum/threads/${threadId}`, { method: "PATCH", body: patch });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update moderation settings.");
    } finally {
      setBusy(false);
    }
  }

  async function removeThread() {
    if (!data || !window.confirm(`Delete “${data.thread.title}”? This removes its replies and votes.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/grafts/forum/threads/${threadId}`, { method: "DELETE" });
      router.push("/grafts/forum");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this topic.");
      setBusy(false);
    }
  }

  async function removeReply(item: ForumReplyView) {
    if (!window.confirm("Delete this reply?")) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/grafts/forum/threads/${threadId}/replies/${item.id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this reply.");
    } finally {
      setBusy(false);
    }
  }

  const thread = data.thread;
  const category = FORUM_CATEGORIES.find((row) => row.id === thread.category)?.label ?? "Topic";
  const mayRemoveThread = isAdmin || thread.authorId === userId;

  return (
    <div className="space-y-5">
      <Link href="/grafts/forum" className="text-sm text-link hover:underline">← Forum</Link>
      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
      <article className="rounded-lg bg-card p-5 shadow-border-small sm:p-6">
        <div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{category}</Badge><Badge variant="outline">{statusName[thread.status]}</Badge>{thread.pinned ? <Badge variant="secondary">Pinned</Badge> : null}{thread.priority === "high" ? <Badge variant="destructive">High priority</Badge> : null}</div>
        <h1 className="mt-3 text-title-1">{thread.title}</h1>
        <p className="mt-2 text-label text-muted-foreground">Started by {thread.author} · {thread.createdAt.slice(0, 16).replace("T", " ")} UTC · {thread.voteCount} votes</p>
        <p className="mt-5 whitespace-pre-wrap text-sm leading-6">{thread.body}</p>
        {isAdmin ? (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
            <label className="text-label text-muted-foreground">Status
              <select aria-label="Topic status" className={`${fieldClass} ml-2 w-auto`} value={thread.status} disabled={busy} onChange={(e) => void moderate({ status: e.target.value as ForumThreadView["status"]})}>
                {Object.entries(statusName).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void moderate({ priority: thread.priority === "high" ? "normal" : "high" })}>{thread.priority === "high" ? "Clear priority" : "Mark high priority"}</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void moderate({ pinned: !thread.pinned })}>{thread.pinned ? "Unpin" : "Pin"}</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void moderate({ locked: !thread.locked })}>{thread.locked ? "Unlock replies" : "Lock replies"}</Button>
          </div>
        ) : null}
        {mayRemoveThread ? <div className="mt-4"><Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void removeThread()}>Delete topic</Button></div> : null}
      </article>

      <section aria-labelledby="replies-heading" className="space-y-3">
        <h2 id="replies-heading" className="text-title-2">Replies <span className="text-muted-foreground">({data.replies.length})</span></h2>
        {data.replies.length ? data.replies.map((item) => (
          <article key={item.id} className="rounded-lg bg-card p-4 shadow-border-small">
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-label text-muted-foreground">{item.author} · {item.createdAt.slice(0, 16).replace("T", " ")} UTC</p>{isAdmin || item.authorId === userId ? <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => void removeReply(item)}>Delete reply</Button> : null}</div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{item.body}</p>
          </article>
        )) : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No replies yet.</p>}
      </section>

      {thread.locked ? <Alert tone="note">Replies are closed for this topic.</Alert> : (
        <form onSubmit={addReply} className="rounded-lg bg-card p-5 shadow-border-small">
          <label htmlFor="forum-reply" className="mb-2 block text-label text-muted-foreground">Add a reply</label>
          <textarea id="forum-reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={4} maxLength={8000} required className={`${fieldClass} h-auto resize-y py-2`} />
          <Button type="submit" className="mt-3" loading={busy} disabled={busy || !reply.trim()}>Post reply</Button>
        </form>
      )}
    </div>
  );
}
