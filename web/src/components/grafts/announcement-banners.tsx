"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/components/api";
import type { AnnouncementView } from "@/server/grafts/announcements";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function AnnouncementBanners({ initial }: { initial: AnnouncementView[] }) {
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function dismiss(id: string) {
    setError(null);
    try {
      await api(`/api/grafts/announcements/${id}/dismiss`, { method: "POST" });
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not dismiss this notice.");
    }
  }

  return (
    <section aria-label="Instance announcements" className="mb-5 space-y-2">
      {items.map((item) => (
        <Alert
          key={item.id}
          tone={item.pinned ? "info" : "note"}
          title={<Link href="/grafts/announcements" className="hover:underline">{item.title}</Link>}
          action={<Button type="button" variant="ghost" size="sm" onClick={() => void dismiss(item.id)}>Dismiss</Button>}
        >
          <span className="whitespace-pre-wrap">{item.body}</span>
        </Alert>
      ))}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </section>
  );
}

