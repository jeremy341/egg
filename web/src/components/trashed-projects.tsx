"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type TrashedRow = {
  projectId: string;
  name: string;
  slug: string;
  deletedAt: string;
  purgeAt: string;
};

/** The apps in the trash, each with a restore button. */
export function TrashedProjects({ rows }: { rows: TrashedRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/projects/trash/${id}/restore`, { method: "POST" });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore this app");
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return <p className="text-muted-foreground">Nothing has been deleted recently.</p>;
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="error" title="Restore failed">{error}</Alert> : null}
      <ul className="divide-y rounded-lg bg-card shadow-border-small">
        {rows.map((r) => (
          <li key={r.projectId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">{r.name}</p>
              <p className="text-label text-muted-foreground">
                Deleted {new Date(r.deletedAt).toLocaleDateString()}. Removed for good on{" "}
                {new Date(r.purgeAt).toLocaleDateString()}. The service on your container is not restored; deploy it again.
              </p>
            </div>
            <Button variant="outline" loading={busy === r.projectId} onClick={() => void restore(r.projectId)}>
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
