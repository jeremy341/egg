"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/api";
import type { AnnouncementView } from "@/server/grafts/announcements";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Label } from "@/components/settings-ui";
import { Input, fieldClass } from "@/components/ui/input";

export function GraftAnnouncements({
  initialFeed,
  initialManaged,
  isAdmin,
}: {
  initialFeed: AnnouncementView[];
  initialManaged: AnnouncementView[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [feed, setFeed] = useState(initialFeed);
  const [managed, setManaged] = useState(initialManaged);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function changeManaged(id: string, patch: Partial<AnnouncementView>) {
    setManaged((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  async function refreshFeed() {
    const result = await api<{ announcements: AnnouncementView[] }>("/api/grafts/announcements");
    setFeed(result.announcements);
  }

  async function refreshManaged() {
    const result = await api<{ announcements: AnnouncementView[] }>("/api/admin/grafts/announcements");
    setManaged(result.announcements);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api("/api/admin/grafts/announcements", { method: "POST", body: { title, body } });
      setTitle("");
      setBody("");
      await refreshManaged();
      setNotice("Draft saved. Publish it when it is ready for everyone to see.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the announcement.");
    } finally {
      setBusy(false);
    }
  }

  async function save(item: AnnouncementView) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/grafts/announcements/${item.id}`, {
        method: "PATCH",
        body: { title: item.title, body: item.body },
      });
      await Promise.all([refreshManaged(), refreshFeed()]);
      router.refresh();
      setNotice("Announcement updated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the announcement.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(item: AnnouncementView, status: "draft" | "published") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/api/admin/grafts/announcements/${item.id}`, { method: "PATCH", body: { status } });
      await Promise.all([refreshManaged(), refreshFeed()]);
      router.refresh();
      setNotice(status === "published" ? "Announcement published." : "Announcement returned to drafts.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the announcement status.");
    } finally {
      setBusy(false);
    }
  }

  async function togglePin(item: AnnouncementView) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/grafts/announcements/${item.id}`, { method: "PATCH", body: { pinned: !item.pinned } });
      await Promise.all([refreshManaged(), refreshFeed()]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the pinned state.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: AnnouncementView) {
    if (!window.confirm(`Delete “${item.title}”? This also clears its dismissal records.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/grafts/announcements/${item.id}`, { method: "DELETE" });
      setManaged((current) => current.filter((row) => row.id !== item.id));
      await refreshFeed();
      router.refresh();
      setNotice("Announcement deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the announcement.");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(item: AnnouncementView) {
    setError(null);
    try {
      await api(`/api/grafts/announcements/${item.id}/dismiss`, { method: "POST" });
      setFeed((current) => current.map((row) => row.id === item.id ? { ...row, dismissedAt: new Date().toISOString() } : row));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not dismiss the notice.");
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-label text-muted-foreground">Egg app</p>
        <h1 className="mt-1 text-title-1">Announcements</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">Notices from this instance appear across Egg. You can dismiss them for your account and still find active notices here.</p>
      </header>

      {notice ? <Alert tone="success" role="status">{notice}</Alert> : null}
      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}

      <section aria-labelledby="announcement-feed-heading" className="space-y-3">
        <h2 id="announcement-feed-heading" className="text-title-2">Current notices</h2>
        {feed.length ? feed.map((item) => (
          <article key={item.id} className="rounded-lg bg-card p-5 shadow-border-small">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-title-3">{item.title}</h3>
                  {item.pinned ? <Badge variant="secondary">Pinned</Badge> : null}
                </div>
                <p className="mt-1 text-label text-muted-foreground">Posted by {item.author} · {(item.publishedAt ?? item.createdAt).slice(0, 10)}</p>
              </div>
              {item.dismissedAt ? <Badge variant="outline">Dismissed</Badge> : <Button type="button" variant="outline" size="sm" onClick={() => void dismiss(item)}>Dismiss for me</Button>}
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{item.body}</p>
          </article>
        )) : <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">There are no active notices right now.</p>}
      </section>

      {isAdmin ? (
        <section aria-labelledby="announcement-manage-heading" className="space-y-4">
          <div>
            <h2 id="announcement-manage-heading" className="text-title-2">Manage notices</h2>
            <p className="mt-1 text-sm text-muted-foreground">Drafts stay private until you publish them. Disabling the app keeps these records.</p>
          </div>
          <Card id="new-announcement" title="Write an announcement" description="Use plain text. It will be shown as text in the Egg app." >
            <form onSubmit={create} className="space-y-3">
              <div>
                <Label htmlFor="announcement-title">Title</Label>
                <Input id="announcement-title" maxLength={120} required value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="announcement-body">Message</Label>
                <textarea id="announcement-body" required maxLength={8000} rows={5} className={`${fieldClass} h-auto resize-y py-2`} value={body} onChange={(e) => setBody(e.target.value)} />
              </div>
              <Button type="submit" loading={busy} disabled={busy || !title.trim() || !body.trim()}>Save draft</Button>
            </form>
          </Card>

          {managed.length ? managed.map((item) => (
            <article key={item.id} className="rounded-lg bg-card p-5 shadow-border-small">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2"><h3 className="text-title-3">{item.title}</h3><Badge variant={item.status === "published" ? "default" : "outline"}>{item.status}</Badge></div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(item, item.status === "published" ? "draft" : "published")}>{item.status === "published" ? "Unpublish" : "Publish"}</Button>
                  <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void togglePin(item)}>{item.pinned ? "Unpin" : "Pin"}</Button>
                  <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => void remove(item)}>Delete</Button>
                </div>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); void save(item); }} className="mt-4 space-y-3">
                <Input aria-label="Announcement title" maxLength={120} value={item.title} onChange={(e) => changeManaged(item.id, { title: e.target.value })} />
                <textarea aria-label="Announcement message" maxLength={8000} rows={4} className={`${fieldClass} h-auto resize-y py-2`} value={item.body} onChange={(e) => changeManaged(item.id, { body: e.target.value })} />
                <Button type="submit" size="sm" variant="outline" loading={busy} disabled={busy || !item.title.trim() || !item.body.trim()}>Save edits</Button>
              </form>
            </article>
          )) : <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No announcements have been written yet.</p>}
          <Link href="/admin/grafts" className="text-sm text-link hover:underline">App availability and setup</Link>
        </section>
      ) : null}
    </div>
  );
}
