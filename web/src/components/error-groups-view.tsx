"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/segmented";
import type { ErrorGroupAction, ErrorGroupStatus } from "@/lib/error-status";

type Group = {
  fingerprint: string;
  message: string;
  file: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  status: ErrorGroupStatus;
  assigneeId: string | null;
};

type Filter = ErrorGroupStatus | "all";

const LABEL: Record<Filter, string> = { all: "All", open: "Open", resolved: "Resolved", ignored: "Ignored" };

/** Open, resolved and ignored error groups, with the actions the server allows. Owner only for changes. */
export function ErrorGroupsView({
  projectId,
  currentUserId,
  canEdit,
}: {
  projectId: string;
  currentUserId: string;
  canEdit: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ groups: Group[] }>(`/api/projects/${projectId}/error-groups?status=${filter}`);
      setGroups(res.groups);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the errors.");
    }
  }, [projectId, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(g: Group, action: ErrorGroupAction, assigneeId?: string | null) {
    setBusy(g.fingerprint);
    try {
      await api(`/api/projects/${projectId}/error-groups/${g.fingerprint}`, {
        body: { action, assigneeId: assigneeId ?? null },
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That change did not save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Segmented
        label="Error status"
        value={filter}
        onChange={setFilter}
        options={(["open", "resolved", "ignored", "all"] as Filter[]).map((v) => ({ value: v, label: LABEL[v] }))}
      />
      {error ? (
        <p role="alert" className="text-label text-[var(--status-error)]">
          {error}
        </p>
      ) : null}
      {groups === null && !error ? <p className="text-label text-muted-foreground">Loading…</p> : null}
      {groups?.length === 0 ? (
        <p className="text-label text-muted-foreground">No {filter === "all" ? "" : filter} errors in the last 30 days.</p>
      ) : null}
      <ul className="divide-y divide-border">
        {(groups ?? []).map((g) => (
          <li key={g.fingerprint} className="space-y-2 py-3">
            <p className="break-words font-mono text-label">{g.message}</p>
            <p className="text-xs text-muted-foreground">
              {g.file ? `${g.file} · ` : ""}
              {g.count} {g.count === 1 ? "time" : "times"} · last seen {new Date(g.lastSeen).toLocaleString()} · {g.status}
              {g.assigneeId ? (g.assigneeId === currentUserId ? " · assigned to you" : " · assigned") : ""}
            </p>
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                {g.status !== "resolved" ? (
                  <Button size="sm" variant="outline" loading={busy === g.fingerprint} onClick={() => void act(g, "resolve")}>
                    Resolve
                  </Button>
                ) : null}
                {g.status !== "ignored" ? (
                  <Button size="sm" variant="outline" loading={busy === g.fingerprint} onClick={() => void act(g, "ignore")}>
                    Ignore
                  </Button>
                ) : null}
                {g.status !== "open" ? (
                  <Button size="sm" variant="outline" loading={busy === g.fingerprint} onClick={() => void act(g, "reopen")}>
                    Reopen
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  loading={busy === g.fingerprint}
                  onClick={() => void act(g, "assign", g.assigneeId === currentUserId ? null : currentUserId)}
                >
                  {g.assigneeId === currentUserId ? "Unassign me" : "Assign to me"}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
