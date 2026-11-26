"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/api";
import type { GraftListing } from "@/server/grafts/registry";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function AdminGrafts({ initial }: { initial: GraftListing[] }) {
  const router = useRouter();
  const [grafts, setGrafts] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(id: GraftListing["id"], enabled: boolean) {
    setBusy(id);
    setError(null);
    try {
      const result = await api<{ graft: GraftListing }>(`/api/admin/grafts/${id}`, {
        method: "PATCH",
        body: { enabled },
      });
      setGrafts((current) => current.map((graft) => graft.id === id ? result.graft : graft));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update app availability.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <p className="text-label text-muted-foreground">Instance administration</p>
        <h1 className="mt-1 text-title-1">First-party apps</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Choose which compiled Egg apps are available to signed-in users. Turning an app off keeps its saved data.
        </p>
      </header>

      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {grafts.map((graft) => (
          <Card key={graft.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-title-2">{graft.name}</h2>
              <Badge variant={graft.enabled ? "default" : "outline"}>{graft.enabled ? "Enabled" : "Off"}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{graft.description}</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={graft.enabled ? "outline" : "default"}
                loading={busy === graft.id}
                disabled={busy !== null}
                onClick={() => void toggle(graft.id, !graft.enabled)}
              >
                {graft.enabled ? "Turn off" : "Enable"}
              </Button>
              {graft.enabled ? <Link href={graft.href} className={buttonVariants({ variant: "ghost" })}>Open app</Link> : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
