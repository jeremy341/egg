"use client";

import { useState } from "react";
import { api } from "@/components/api";
import { Card } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { timeAgo } from "@/lib/status";

/** A finished backup, as POST /api/projects/[id]/db-backup returns it in `backup`. */
export type BackupMetadata = {
  id: string;
  projectId: string;
  createdAt: string;
  status: "completed";
  objectKey: string;
  sizeBytes: number;
};

const TOUCH = "min-h-10";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** The server's stable codes that mean the project has no usable database setting. */
const SETUP_CODES = new Set(["database_missing", "database_unavailable"]);

function errorCode(e: unknown): string | undefined {
  return typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : undefined;
}

/**
 * Manual database backup for the project. Each backup is a pg_dump of the
 * production DATABASE_URL (or POSTGRES_URL) copied to object storage. Scheduled
 * backups run on Egg's worker for every project that has one of those settings;
 * the server does not yet report a schedule or a list of past backups, so this
 * card shows only the backups started from this page.
 */
export function DbBackupCard({ projectId }: { projectId: string }) {
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<BackupMetadata | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);

  async function backUpNow() {
    setRunning(true);
    setError(null);
    try {
      const res = await api<{ backup: BackupMetadata }>(
        `/api/projects/${encodeURIComponent(projectId)}/db-backup`,
        { method: "POST" }
      );
      setLastRun(res.backup);
      toast.success("Backup finished", formatBytes(res.backup.sizeBytes));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not start a backup.";
      setError({ code: errorCode(e), message });
      toast.error("Backup did not run", message);
    } finally {
      setRunning(false);
    }
  }

  const when = lastRun && !Number.isNaN(Date.parse(lastRun.createdAt)) ? new Date(lastRun.createdAt) : null;

  return (
    <Card
      id="db-backup-heading"
      title="Database backups"
      description="Copy your production database to storage, now or on Egg's schedule."
    >
      <div className="space-y-5">
        {error ? (
          <Alert tone={SETUP_CODES.has(error.code ?? "") ? "warning" : "error"} role="alert" title={SETUP_CODES.has(error.code ?? "") ? "Database setting needed" : "Backup failed"}>
            {error.message}
          </Alert>
        ) : null}

        <section aria-labelledby="db-backup-last-heading" className="space-y-1.5">
          <h3 id="db-backup-last-heading" className="text-label font-medium text-muted-foreground">
            Last backup from this page
          </h3>
          {running ? (
            <p role="status" className="font-medium">
              Backing up… This can take a while for a large database.
            </p>
          ) : lastRun && when ? (
            <p>
              <span className="font-medium">Completed</span>{" "}
              <time dateTime={lastRun.createdAt} className="text-muted-foreground">
                {timeAgo(when)}
              </time>
              <span className="text-muted-foreground">{`, ${formatBytes(lastRun.sizeBytes)}`}</span>
            </p>
          ) : (
            <p className="text-muted-foreground">No backup started from this page yet.</p>
          )}
          <p className="text-label text-muted-foreground">
            Earlier backups are not listed here yet.
          </p>
        </section>

        <div className="space-y-1.5">
          <p className="text-label text-muted-foreground">
            Scheduled backups run automatically for projects with a production DATABASE_URL or POSTGRES_URL.
          </p>
          <Button type="button" variant="outline" className={TOUCH} onClick={() => void backUpNow()} disabled={running}>
            {running ? "Backing up…" : "Back up now"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
