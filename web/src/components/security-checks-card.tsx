"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { Card } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One finding from GET /api/projects/[id]/security-checks. The messages are
 * written by the server and never contain environment values.
 */
export type SecurityFinding = {
  id: string;
  severity: string;
  title: string;
  message: string;
  /** What the finding is about, such as an environment key or a domain. */
  resource: string;
};

const SEVERITY_ORDER = ["critical", "high", "medium", "warning", "low", "info"];

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  warning: "Warning",
  low: "Low",
  info: "Info",
};

// Severity is always written out as text; colour only adds emphasis.
const SEVERITY_TONE: Record<string, string> = {
  critical: "font-semibold text-destructive",
  high: "font-semibold text-destructive",
  medium: "font-medium text-foreground",
  warning: "font-medium text-foreground",
  low: "text-muted-foreground",
  info: "text-muted-foreground",
};

const TOUCH = "min-h-10";

function rank(severity: string): number {
  const i = SEVERITY_ORDER.indexOf(severity);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

function FindingItem({ finding }: { finding: SecurityFinding }) {
  const label = SEVERITY_LABEL[finding.severity];
  return (
    <li className="space-y-1 px-4 py-3">
      <p className="text-label">
        <span className={SEVERITY_TONE[finding.severity] ?? "text-muted-foreground"}>
          {label ?? "Unknown severity"}
        </span>
      </p>
      <p className="font-medium">{finding.title}</p>
      <p className="text-label text-muted-foreground">{finding.message}</p>
      <p className="text-label text-muted-foreground">
        About <code className="break-all font-mono text-[12.5px]">{finding.resource}</code>
      </p>
    </li>
  );
}

/**
 * Read-only list of security findings for the project's environment, domains and
 * image tag. Findings are sorted most severe first. Nothing here changes the project.
 */
export function SecurityChecksCard({ projectId }: { projectId: string }) {
  const [findings, setFindings] = useState<SecurityFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ findings: SecurityFinding[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/security-checks`
      );
      setFindings(res.findings);
      setCheckedAt(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not run the security checks.");
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the server on mount
    void load();
  }, [load]);

  async function recheck() {
    setChecking(true);
    await load();
    setChecking(false);
  }

  const sorted = findings ? [...findings].sort((a, b) => rank(a.severity) - rank(b.severity)) : [];

  return (
    <Card
      id="security-checks-heading"
      title="Security checks"
      description="Problems found in this project's settings. Fix them, then check again."
      footer={
        <>
          <p className="text-label text-muted-foreground" role="status" aria-live="polite">
            {checking ? (
              "Checking…"
            ) : checkedAt ? (
              <>
                Last checked <time dateTime={checkedAt.toISOString()}>{checkedAt.toLocaleString()}</time>
              </>
            ) : null}
          </p>
          <Button type="button" variant="outline" className={TOUCH} onClick={() => void recheck()} disabled={checking}>
            {checking ? "Checking…" : "Check again"}
          </Button>
        </>
      }
    >
      {error ? (
        <Alert
          tone="error"
          role="alert"
          action={
            <Button type="button" variant="outline" className={TOUCH} onClick={() => void recheck()} disabled={checking}>
              Try again
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}

      {findings === null && error === null ? (
        <p className="text-muted-foreground" role="status">
          Running the security checks…
        </p>
      ) : null}

      {findings !== null && findings.length === 0 ? (
        <p className="text-muted-foreground">No problems found.</p>
      ) : null}

      {findings !== null && findings.length > 0 ? (
        <>
          <p className="mb-2 text-label text-muted-foreground">
            {findings.length} {findings.length === 1 ? "finding" : "findings"}, most severe first.
          </p>
          <ul
            aria-label="Findings"
            className={cn("hairline-y divide-y overflow-hidden rounded-md shadow-border-base", checking && "opacity-60")}
          >
            {sorted.map((f, i) => (
              <FindingItem key={`${f.id}-${f.resource}-${i}`} finding={f} />
            ))}
          </ul>
        </>
      ) : null}
    </Card>
  );
}
