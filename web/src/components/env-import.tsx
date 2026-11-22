"use client";

import { useEffect, useState } from "react";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { api } from "@/components/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { runtimeLabel } from "@/components/hosting-options";
import type { SourceProvider } from "@/components/repository-source";
import type { PackageManager, RepoDetection } from "@/server/repo-detect";
import type { RepoRead } from "@/server/repo-read";

/**
 * Client side of repository detection: the hook, the "We found" summary, the
 * env value fields for the new project flow, and the import button for the
 * settings page. Everything here handles NAMES only; the server never sends a
 * value from the repository.
 */

export type DetectParams = {
  /** "owner/name" */
  repo: string;
  branch: string;
  installationId: number | null;
  rootDir: string;
  sourceProvider?: SourceProvider;
  providerConnectionId?: string | null;
};

type Loaded = { key: string; read: RepoRead | null };

/** The repo, branch and root a detection is for. Null disables the lookup. */
export function useRepoDetection(params: DetectParams | null) {
  const key = params
    ? `${params.repo}|${params.branch}|${params.installationId ?? ""}|${params.rootDir}|${params.sourceProvider ?? "github"}|${params.providerConnectionId ?? ""}`
    : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!params || !key) return;
    const ctl = new AbortController();
    const timer = window.setTimeout(() => {
      const q = new URLSearchParams({
        repo: params.repo,
        branch: params.branch,
        root: params.rootDir.trim() || ".",
      });
      if (params.installationId) q.set("installation", String(params.installationId));
      if (params.sourceProvider) q.set("sourceProvider", params.sourceProvider);
      if (params.providerConnectionId) q.set("providerConnectionId", params.providerConnectionId);
      fetch(`/api/repos/detect?${q}`, { signal: ctl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<RepoRead>) : null))
        .then((read) => setLoaded({ key, read }))
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setLoaded({ key, read: null });
        });
    }, 500);
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
    // The key stands for every field of params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return { status: "idle" as const };
  if (!loaded || loaded.key !== key) return { status: "loading" as const };
  if (!loaded.read) return { status: "error" as const, message: "Could not look at the repository right now." };
  if (loaded.read.status !== "ok" || !loaded.read.detection) {
    return { status: "error" as const, message: loaded.read.message ?? "Could not look at the repository." };
  }
  return { status: "ok" as const, detection: loaded.read.detection };
}

export const PM_NAMES: Record<PackageManager, string> = {
  npm: "npm",
  pnpm: "pnpm",
  yarn: "Yarn",
  bun: "Bun",
};

const FRAMEWORK_NAMES = { next: "Next.js", vite: "Vite", nuxt: "Nuxt", astro: "Astro" } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-32 shrink-0 text-label text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

const Mono = ({ children }: { children: React.ReactNode }) => (
  <code className="font-mono text-[13px] break-all">{children}</code>
);

/**
 * "We found": what the repository looks like and the settings it suggests.
 * Nothing is applied until the user presses the button; the fields it fills
 * stay editable.
 */
export function DetectedSummary({
  detection: d,
  onUse,
  onPickRoot,
}: {
  detection: RepoDetection;
  onUse: () => void;
  onPickRoot: (dir: string) => void;
}) {
  const canUse = d.runtime !== null;
  return (
    <section aria-labelledby="found-heading" className="mt-5 rounded-md bg-[var(--ds-gray-100)] px-3 py-3">
      <h2 id="found-heading" className="text-label font-medium">
        We found
      </h2>

      {d.language === null ? (
        <p className="mt-2 text-muted-foreground">
          Nothing here tells us what this project is. Choose a preset below.
        </p>
      ) : (
        <dl className="mt-2 grid gap-1.5">
          {d.packageManager ? (
            <Row label="Package manager">
              {PM_NAMES[d.packageManager]}
              {d.packageManagerSupported ? null : " (not built by Egg yet)"}
            </Row>
          ) : null}
          <Row label="Runtime">
            {d.runtime ? runtimeLabel(d.runtime) : "Not supported yet"}
            {d.framework ? ` (${FRAMEWORK_NAMES[d.framework]})` : null}
          </Row>
          {d.commands.install ? (
            <Row label="Install">
              <Mono>{d.commands.install}</Mono>
            </Row>
          ) : null}
          {d.commands.build ? (
            <Row label="Build">
              <Mono>{d.commands.build}</Mono>
            </Row>
          ) : null}
          {d.commands.start ? (
            <Row label="Start">
              <Mono>{d.commands.start}</Mono>
            </Row>
          ) : null}
          {d.outputDir ? (
            <Row label="Output folder">
              <Mono>{d.outputDir}</Mono>
            </Row>
          ) : null}
        </dl>
      )}

      {d.notes.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-label text-muted-foreground">
          {d.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      {d.candidateRoots.length > 0 ? (
        <div className="mt-3">
          <p className="text-label text-muted-foreground">Apps in this repository</p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {d.candidateRoots.map((dir) => (
              <li key={dir}>
                <Button type="button" variant="outline" size="sm" onClick={() => onPickRoot(dir)}>
                  <span className="font-mono">{dir}</span>
                  <span className="sr-only"> as the root directory</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canUse ? (
        <div className="mt-3">
          <Button type="button" variant="outline" onClick={onUse}>
            Use these settings
          </Button>
          <p className="mt-1.5 text-label text-muted-foreground">
            Fills the fields below. You can change any of them before you deploy.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** Warnings from detection, such as a committed .env. */
export function DetectionWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mt-3 grid gap-2">
      {warnings.map((w) => (
        <Alert key={w} tone="warning" role="status">
          {w}
        </Alert>
      ))}
    </div>
  );
}

/**
 * One empty input per detected name. A name becomes a real variable only when
 * its value is filled in.
 */
export function EnvValueFields({
  env,
  values,
  onChange,
}: {
  env: RepoDetection["env"];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  if (env.length === 0) return null;
  return (
    <fieldset className="mt-5 min-w-0">
      <legend className="text-label font-medium">Environment variables</legend>
      <p id="env-values-note" className="mt-1 text-label text-muted-foreground">
        These names came from the example env file in your repository, or from what your bot framework is known to
        read. Values are entered once and never shown again. Leave a field empty to skip that name.
      </p>
      <div className="mt-3 grid gap-3">
        {env.map((e) => {
          const id = `np-env-${e.name}`;
          return (
            <div key={e.name}>
              <label htmlFor={id} className="mb-1.5 block text-label text-muted-foreground">
                <span className="font-mono break-all text-foreground">{e.name}</span>
                <span>{e.suggested ? ` · suggested for ${e.source}` : ` from ${e.source}`}</span>
              </label>
              <Input
                id={id}
                value={values[e.name] ?? ""}
                onChange={(ev) => onChange(e.name, ev.target.value)}
                aria-describedby="env-values-note"
                autoComplete="off"
                spellCheck={false}
                data-1p-ignore
                className="font-mono"
              />
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

type EnvVar = { id: string; key: string; target: "all" | "production" | "preview" };

/**
 * Project settings: read the repository, and add every detected name that is
 * not already a variable, with an empty value. Existing variables are never
 * touched.
 */
export function EnvImportButton({
  projectId,
  onImported,
}: {
  projectId: string;
  /** Kept for callers; the import re-reads the authoritative list itself. */
  existing: string[];
  onImported: (env: EnvVar[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    { tone: "info" | "success" | "error"; text: string; warnings: string[] } | null
  >(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const read = await api<RepoRead>(`/api/repos/detect?projectId=${encodeURIComponent(projectId)}`);
      if (read.status !== "ok" || !read.detection) {
        setResult({ tone: "error", text: read.message ?? "Could not look at the repository.", warnings: [] });
        return;
      }
      const warnings = read.detection.warnings.filter((w) => w.startsWith("A .env file"));
      if (read.detection.env.length === 0) {
        setResult({
          tone: "info",
          text: "No example env file (such as .env.example) was found in the repository.",
          warnings,
        });
        return;
      }
      // Re-read immediately before importing: the prop from the settings page is a
      // snapshot. Another tab or a token may have created a variable since then,
      // and POST /env is an upsert — importing a stale "missing" name would
      // overwrite its saved value with an empty string.
      const fresh = await api<{ env: EnvVar[] }>(`/api/projects/${projectId}/env`);
      const have = new Set(fresh.env.map((e) => e.key));
      const missing = read.detection.env.map((e) => e.name).filter((n) => !have.has(n));
      if (missing.length === 0) {
        setResult({ tone: "info", text: "Every name in the repository is already here.", warnings });
        return;
      }
      let latest: EnvVar[] | null = null;
      let added = 0;
      try {
        for (const name of missing) {
          const res = await api<{ env: EnvVar[] }>(`/api/projects/${projectId}/env`, {
            body: { key: name, value: "", target: "all" },
          });
          latest = res.env;
          added += 1;
        }
      } catch (err) {
        if (latest) onImported(latest);
        setResult({
          tone: "error",
          text: `${added} added, then it stopped: ${err instanceof Error ? err.message : "could not save"}`,
          warnings,
        });
        return;
      }
      if (latest) onImported(latest);
      setResult({
        tone: "success",
        text: `Added ${added} ${added === 1 ? "name" : "names"} with empty values. Use the pencil on each to set its value.`,
        warnings,
      });
    } catch (err) {
      setResult({ tone: "error", text: err instanceof Error ? err.message : "Could not import", warnings: [] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <Button type="button" variant="outline" onClick={() => void run()} loading={busy}>
        {busy ? null : <DownloadSimpleIcon aria-hidden="true" />}
        {busy ? "Reading the repository…" : "Import names from the repository"}
      </Button>
      <div role="status" aria-live="polite" className="mt-3 grid gap-2 empty:hidden">
        {result ? (
          <>
            <Alert tone={result.tone}>{result.text}</Alert>
            {result.warnings.map((w) => (
              <Alert key={w} tone="warning">
                {w}
              </Alert>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
