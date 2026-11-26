"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/components/api";
import { Card } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * What GET /api/projects/[id]/score returns: the score.yaml on the production
 * branch and what it would create. Variable values are never included.
 */
export type ScorePreview = {
  file: string;
  branch: string;
  preview: {
    ports: { name: string; port: number; protocol?: "tcp" | "udp" }[];
    variables: { name: string; action: "set" }[];
    databases: { name: string; type: "postgres" | "mysql" | "redis"; version?: string }[];
  };
};

const TOUCH = "min-h-10";

/** The server sends a stable code with each error; a validation error is about the file's content. */
function errorCode(e: unknown): string | undefined {
  return typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : undefined;
}

function Section({ title, empty, children, count }: { title: string; empty: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <h3 className="text-label font-medium text-muted-foreground">
        {title}
        {count > 0 ? <span> ({count})</span> : null}
      </h3>
      {count === 0 ? (
        <p className="text-label text-muted-foreground">{empty}</p>
      ) : (
        <ul className="hairline-y divide-y overflow-hidden rounded-md shadow-border-base">{children}</ul>
      )}
    </section>
  );
}

const ROW = "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-label";

/**
 * What the project's score.yaml would create on deploy. This is read-only: it
 * shows the file's resources, and a problem in the file is shown in full.
 */
export function ScorePreviewCard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<ScorePreview | null>(null);
  const [error, setError] = useState<{ code?: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<ScorePreview>(`/api/projects/${encodeURIComponent(projectId)}/score`);
      setData(res);
      setError(null);
    } catch (e) {
      setError({
        code: errorCode(e),
        message: e instanceof Error ? e.message : "Could not read score.yaml.",
      });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads from the server on mount
    void load();
  }, [load]);

  const preview = data?.preview ?? null;
  const total = preview ? preview.ports.length + preview.variables.length + preview.databases.length : 0;
  const isValidation = error?.code === "validation";
  const isMissing = error?.code === "not_found";

  return (
    <Card
      id="score-preview-heading"
      title="Config preview"
      description="What score.yaml on your production branch would create when you deploy. Reading it changes nothing."
      footer={
        <>
          <p className="text-label text-muted-foreground" role="status" aria-live="polite">
            {data && !loading ? `From ${data.file} on ${data.branch}` : null}
          </p>
          <Button type="button" variant="outline" className={TOUCH} onClick={() => void load()} disabled={loading}>
            {loading ? "Reading…" : "Read again"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {error ? (
          isValidation ? (
            <Alert tone="error" role="alert" title="score.yaml has a problem">
              <p>{error.message}</p>
              <p className="mt-1 text-label text-muted-foreground">Fix the file on your branch, then read it again.</p>
            </Alert>
          ) : isMissing ? (
            <Alert tone="note" title="No score.yaml yet">
              <p className="text-muted-foreground">{error.message}</p>
            </Alert>
          ) : (
            <Alert
              tone="error"
              role="alert"
              action={
                <Button type="button" variant="outline" className={TOUCH} onClick={() => void load()} disabled={loading}>
                  Try again
                </Button>
              }
            >
              {error.message}
            </Alert>
          )
        ) : null}

        {data === null && error === null ? (
          <p className="text-muted-foreground" role="status">
            Reading score.yaml…
          </p>
        ) : null}

        {preview !== null && total === 0 ? (
          <p className="text-muted-foreground">score.yaml is valid but declares no ports, variables or databases.</p>
        ) : null}

        {preview !== null && total > 0 ? (
          <div className="space-y-4">
            <Section title="Ports" empty="No ports declared." count={preview.ports.length}>
              {preview.ports.map((p) => (
                <li key={p.name} className={ROW}>
                  <span className="font-medium">{p.name}</span>
                  <span className="font-mono text-muted-foreground">
                    {p.port}/{p.protocol ?? "tcp"}
                  </span>
                </li>
              ))}
            </Section>

            <Section title="Variables" empty="No variables declared." count={preview.variables.length}>
              {preview.variables.map((v) => (
                <li key={v.name} className={ROW}>
                  <span className="font-mono">{v.name}</span>
                  <span className="text-muted-foreground">Will be set. Value hidden.</span>
                </li>
              ))}
            </Section>

            <Section title="Databases" empty="No databases declared." count={preview.databases.length}>
              {preview.databases.map((d) => (
                <li key={d.name} className={ROW}>
                  <span className="font-medium">{d.name}</span>
                  <span className="text-muted-foreground">
                    {d.type}
                    {d.version ? ` ${d.version}` : ""}
                  </span>
                </li>
              ))}
            </Section>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
