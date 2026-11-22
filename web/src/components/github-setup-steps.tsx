"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRightIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  DownloadSimpleIcon,
  MinusCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { api } from "@/components/api";
import { CopyField } from "@/components/copy-field";
import { Swap } from "@/components/motion/swap";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ types and pure helpers */

export type Secret = {
  name: string;
  credential: "previewUploadToken" | "productionUploadToken" | "previewEnvToken" | "productionEnvToken";
  /** Where the secret is saved on GitHub: the production ones in the egg-production environment. */
  store: "environment" | "repository";
  purpose: string;
};
export type WorkflowInfo = {
  path: string;
  workflow: string;
  secrets: Secret[];
  limits: { waitMinutes: number; maxArchiveMb: number; credentialDays: number };
};
export type Made = Record<Secret["credential"], string> & { createdAt: string; expiresAt: string };
export type Check = { id: string; label: string; status: "pass" | "fail" | "not_checked"; detail: string };
export type Report = { checks: Check[]; allPassed: boolean; notChecked: string[] };
export type PublishResult = {
  status: "opened" | "updated" | "already";
  branch: string;
  base: string;
  pullRequestUrl: string | null;
};
export type PublishFailure = { code?: string; message: string };

export const STEP_IDS = ["credentials", "secrets", "workflow", "test", "build"] as const;
export type StepId = (typeof STEP_IDS)[number];

export const STEP_TITLES: Record<StepId, string> = {
  credentials: "Make the build credentials",
  secrets: "Save the secrets on GitHub",
  workflow: "Add the workflow file",
  test: "Test the connection",
  build: "Run the first build",
};

/** The names Egg's workflow reads. Used until the workflow endpoint answers; the endpoint's list wins. */
const FALLBACK_SECRETS: Secret[] = [
  { name: "EGG_UPLOAD_PRODUCTION_TOKEN", credential: "productionUploadToken", store: "environment", purpose: "sends the production release" },
  { name: "EGG_ENV_PRODUCTION_TOKEN", credential: "productionEnvToken", store: "environment", purpose: "reads production variables" },
  { name: "EGG_UPLOAD_PREVIEW_TOKEN", credential: "previewUploadToken", store: "repository", purpose: "sends a preview release" },
  { name: "EGG_ENV_PREVIEW_TOKEN", credential: "previewEnvToken", store: "repository", purpose: "reads preview variables" },
];

/** The step to open: the first one that is not finished. The last step is never finished. */
export function firstUnfinished(done: Record<StepId, boolean>): StepId {
  return STEP_IDS.find((id) => !done[id]) ?? "build";
}

/** What to tell the person for each failure code of the publish endpoint. `manual` means: show the copy and download route. */
export function publishAdvice(failure: PublishFailure): { text: string; manual: boolean } {
  switch (failure.code) {
    case "permission_missing":
      return { text: "", manual: true };
    case "workflow_invalid":
      return { text: "Egg could not make a valid workflow from this project's saved settings. Check the root directory and the build commands in Settings, save, then try again.", manual: false };
    case "repo_unavailable":
      return { text: "Egg cannot see this repository. Run Test connection to see why, or add the file by hand below.", manual: true };
    case "not_a_github_project":
      return { text: "This project does not come from a GitHub repository, so Egg cannot open a pull request for it.", manual: true };
    case "rate_limited":
      return { text: "GitHub asked Egg to slow down. Wait a minute, then try again.", manual: false };
    case "github_error":
      return { text: "GitHub did not accept the request. Try again in a minute, or add the file by hand below.", manual: true };
    default:
      return { text: failure.message || "Egg could not add the file. Try again, or add it by hand below.", manual: true };
  }
}

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/* ------------------------------------------------------------------ progress and the step frame */

/** "Step 2 of 5" and a row of five segments. The words carry the state; the segments only repeat it. */
export function SetupProgress({ current, done }: { current: StepId | null; done: Record<StepId, boolean> }) {
  if (!current) return <p className="text-label text-muted-foreground">Checking your setup…</p>;
  const index = STEP_IDS.indexOf(current);
  return (
    <div>
      <p aria-live="polite" className="text-label font-medium">
        Step {index + 1} of {STEP_IDS.length}
        <span className="font-normal text-muted-foreground">: {STEP_TITLES[current]}</span>
      </p>
      <div aria-hidden="true" className="mt-2 grid grid-cols-5 gap-1">
        {STEP_IDS.map((id) => (
          <span
            key={id}
            className={cn(
              "h-1 rounded-full",
              done[id] ? "bg-foreground" : id === current ? "bg-foreground/45" : "bg-[var(--ds-gray-alpha-200)]"
            )}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One step of the list. The header is a real button. A finished step collapses to this one line with a check.
 * The body stays mounted when closed (hidden), so what a step knows is not lost when another one opens.
 */
export function SetupStep({
  id,
  number,
  open,
  done,
  summary,
  onToggle,
  children,
}: {
  id: StepId;
  number: number;
  open: boolean;
  done: boolean;
  summary?: string | null;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <li aria-current={open ? "step" : undefined} className="py-1">
      <h3>
        <button
          type="button"
          id={`setup-${id}-header`}
          aria-expanded={open}
          aria-controls={`setup-${id}-body`}
          onClick={onToggle}
          className="touch-target flex min-h-10 w-full items-center gap-3 rounded-md py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-focus-color)]"
        >
          {done ? (
            <CheckCircleIcon aria-hidden="true" weight="fill" className="size-5 shrink-0 text-[var(--tone-success-icon)]" />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-medium",
                open ? "bg-foreground text-background" : "shadow-border-base text-muted-foreground"
              )}
            >
              {number}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className={cn("block font-medium", !open && !done && "text-muted-foreground")}>
              {STEP_TITLES[id]}
              {done ? <span className="sr-only">, done</span> : null}
            </span>
            {!open && summary ? <span className="block text-label text-muted-foreground">{summary}</span> : null}
          </span>
          <CaretDownIcon
            aria-hidden="true"
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-(--dur-fast)", open && "rotate-180")}
          />
        </button>
      </h3>
      <div id={`setup-${id}-body`} role="region" aria-labelledby={`setup-${id}-header`} hidden={!open} className="pb-2 pl-8">
        {children}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ step 1: credentials */

export function CredentialsStep({
  busy,
  error,
  days,
  status,
  replacing,
  onMake,
  confirmSlot,
}: {
  busy: boolean;
  error: string | null;
  days: number | undefined;
  status: string | null;
  replacing: boolean;
  onMake: () => void;
  /** The "make new ones" control with its confirm dialog, for a project that already has credentials. */
  confirmSlot: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="text-label text-muted-foreground">
        Four credentials that can send a release and read build variables, and nothing else
        {days ? `. They work for ${days} days.` : "."} Egg shows them once and keeps only a fingerprint.
      </p>
      {status ? (
        <p role="status" className="text-label">
          {status}
        </p>
      ) : null}
      {error ? (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      ) : null}
      {replacing ? (
        confirmSlot
      ) : (
        <Button type="button" loading={busy} disabled={busy} onClick={onMake}>
          {busy ? "Making…" : "Make credentials"}
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ step 2: secrets */

/**
 * Where each secret goes. The production pair lives in an Environment so GitHub can limit it to the production
 * branch; a repository secret is readable by a workflow on any branch. When the values were just made they are
 * shown here, next to where they are pasted.
 */
export function SecretsStep({
  branch,
  secrets,
  made,
  acknowledged,
  onAcknowledge,
}: {
  branch: string;
  secrets: Secret[] | null;
  made: Made | null;
  acknowledged: boolean;
  onAcknowledge: () => void;
}) {
  const list = secrets ?? FALLBACK_SECRETS;
  const groups = [
    {
      store: "environment" as const,
      heading: "Production: an environment named egg-production",
      how: (
        <>
          On GitHub, open Settings, then Environments, then New environment, and name it{" "}
          <code className="font-mono text-foreground">egg-production</code>. Under Deployment branches and tags, choose
          Selected branches and tags and add <code className="font-mono text-foreground">{branch}</code>. Then add these as
          environment secrets.
        </>
      ),
    },
    {
      store: "repository" as const,
      heading: "Previews: repository secrets",
      how: <>Open Settings, then Secrets and variables, then Actions, and add these as repository secrets.</>,
    },
  ];
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const rows = list.filter((s) => s.store === g.store);
        return (
          <div key={g.store} className="space-y-2">
            <p className="text-label font-medium">{g.heading}</p>
            <p className="text-label text-muted-foreground">{g.how}</p>
            <ul className="space-y-2.5">
              {rows.map((s) => (
                <li key={s.name}>
                  <p className="text-label">
                    <span className="font-mono text-[13px] font-medium">{s.name}</span>
                    <span className="text-muted-foreground">: {s.purpose}</span>
                  </p>
                  {made ? (
                    <div className="mt-1">
                      <CopyField value={made[s.credential]} label={`Value for the ${s.name} secret`} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {made ? (
        <p className="text-label text-muted-foreground">Copy each value now. Egg does not show them again.</p>
      ) : (
        <p className="text-label text-muted-foreground">
          Egg shows the values once, when it makes them. To see them again, make new credentials in step 1.
        </p>
      )}
      <Alert tone="warning">
        The production values must not be repository secrets: a workflow edited on any branch could read them. People who
        can edit workflows are trusted operators of this project. Each project has a single owner.
      </Alert>
      <Button type="button" variant={acknowledged ? "outline" : "default"} onClick={onAcknowledge}>
        {acknowledged ? "Continue" : "I saved all four secrets"}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ step 3: the workflow file */

/** Egg's GitHub App cannot write to the repository. Says what is missing and who can fix it. */
export function PermissionNotice() {
  return (
    <Alert tone="warning" role="alert">
      <p className="font-medium">Egg cannot add the file yet</p>
      <p className="mt-1">
        Egg&apos;s GitHub App needs permission it does not have: Contents, Pull requests and Workflows, each read and
        write. Only the person who runs this Egg can grant it. If that is not you, add the file by hand below.
      </p>
    </Alert>
  );
}

export function PublishOutcome({ result }: { result: PublishResult }) {
  if (result.status === "already") {
    return (
      <Alert tone="success" role="status">
        The workflow file is already on <code className="font-mono">{result.base}</code>. Nothing changed.
      </Alert>
    );
  }
  return (
    <Alert tone="success" role="status">
      <p className="font-medium">{result.status === "opened" ? "Pull request opened" : "Pull request updated"}</p>
      {result.pullRequestUrl ? (
        <p className="mt-1">
          Merge it on GitHub to finish.{" "}
          <a href={result.pullRequestUrl} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1 font-medium">
            Open the pull request
            <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      ) : (
        <p className="mt-1">
          The branch <code className="font-mono">{result.branch}</code> is ready. On GitHub, open a pull request from it into{" "}
          <code className="font-mono">{result.base}</code> and merge it to finish.
        </p>
      )}
    </Alert>
  );
}

/** Copy and download the file, with its path. The way to add it when Egg cannot, and always there as a fallback. */
export function ManualWorkflow({
  info,
  branch,
  onReload,
}: {
  info: WorkflowInfo;
  branch: string;
  onReload: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(info.workflow);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([info.workflow], { type: "text/yaml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "egg.yml";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-3">
      <p className="text-label text-muted-foreground">
        Save this as <code className="font-mono text-foreground">{info.path}</code> on the{" "}
        <code className="font-mono text-foreground">{branch}</code> branch and commit it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          <Swap value={copied} className="inline-flex items-center gap-1">
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy egg.yml"}
          </Swap>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={download}>
          <DownloadSimpleIcon aria-hidden="true" />
          Download egg.yml
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onReload}>
          Refresh from saved settings
        </Button>
        <span aria-live="polite" className="sr-only">
          {copied ? "Workflow copied" : ""}
        </span>
      </div>
      <pre
        tabIndex={0}
        aria-label={`Contents of ${info.path}`}
        className="max-h-80 overflow-auto rounded-md bg-[var(--code-bg)] p-3 font-mono text-[12.5px] leading-5 shadow-border-base"
      >
        {info.workflow}
      </pre>
    </div>
  );
}

export function WorkflowStep({
  projectId,
  info,
  error,
  branch,
  onReload,
  onDone,
  done,
}: {
  projectId: string;
  info: WorkflowInfo | null;
  error: string | null;
  branch: string;
  onReload: () => void;
  /** Called when the file is on the repository: at once for "already", otherwise when the person says so. */
  onDone: () => void;
  done: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [failure, setFailure] = useState<PublishFailure | null>(null);
  const [manual, setManual] = useState(false);

  async function publish() {
    setBusy(true);
    setFailure(null);
    try {
      const out = await api<PublishResult>(`/api/projects/${projectId}/github-workflow/publish`, { method: "POST" });
      setResult(out);
      if (out.status === "already") onDone();
    } catch (err) {
      setResult(null);
      const f = { code: (err as { code?: string }).code, message: message(err, "") };
      setFailure(f);
      if (publishAdvice(f).manual) setManual(true);
    } finally {
      setBusy(false);
    }
  }

  const advice = failure ? publishAdvice(failure) : null;

  return (
    <div className="space-y-3">
      <p className="text-label text-muted-foreground">
        Egg opens a pull request that adds <code className="font-mono text-foreground">.github/workflows/egg.yml</code>, made
        from this project&apos;s saved settings.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => void publish()} loading={busy} disabled={busy}>
          {busy ? "Adding…" : result ? "Add again" : "Add to repository"}
        </Button>
        {result && result.status !== "already" && !done ? (
          <Button type="button" variant="outline" onClick={onDone}>
            I merged it
          </Button>
        ) : null}
      </div>

      <div aria-live="polite" className="empty:hidden">
        {result ? <PublishOutcome result={result} /> : null}
        {failure?.code === "permission_missing" ? <PermissionNotice /> : null}
        {failure && failure.code !== "permission_missing" && advice ? (
          <Alert tone="error" role="alert">
            {advice.text}
          </Alert>
        ) : null}
      </div>

      <details
        open={manual}
        onToggle={(e) => setManual((e.currentTarget as HTMLDetailsElement).open)}
        className="rounded-md shadow-border-base"
      >
        <summary className="touch-target flex min-h-10 cursor-pointer items-center px-3 text-label font-medium">
          Add it by hand instead
        </summary>
        <div className="px-3 pb-3">
          {error ? (
            <div className="space-y-2">
              <Alert tone="error" role="alert">
                {error}
              </Alert>
              <Button type="button" variant="outline" size="sm" onClick={onReload}>
                Try again
              </Button>
            </div>
          ) : info ? (
            <ManualWorkflow info={info} branch={branch} onReload={onReload} />
          ) : (
            <p className="text-label text-muted-foreground">Making the workflow…</p>
          )}
          {!done ? (
            <div className="mt-3">
              <Button type="button" variant="outline" onClick={onDone}>
                I committed the file
              </Button>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ step 4: test */

const STATUS = {
  pass: { word: "Passed", Icon: CheckCircleIcon, tone: "text-[var(--tone-success-icon)]" },
  fail: { word: "Failed", Icon: XCircleIcon, tone: "text-[var(--tone-error-icon)]" },
  not_checked: { word: "Not checked", Icon: MinusCircleIcon, tone: "text-muted-foreground" },
} as const;

export function CheckList({ report }: { report: Report }) {
  const failed = report.checks.filter((c) => c.status === "fail").length;
  const skipped = report.checks.filter((c) => c.status === "not_checked").length;
  return (
    <div className="space-y-3">
      <p className="font-medium">
        {report.allPassed
          ? "Every check passed."
          : `${failed} ${failed === 1 ? "check" : "checks"} failed${skipped ? `, ${skipped} not checked` : ""}.`}
      </p>
      <ul className="hairline-y overflow-hidden rounded-md shadow-border-base">
        {report.checks.map((c) => {
          const s = STATUS[c.status];
          return (
            <li key={c.id} className="flex items-start gap-3 px-3 py-2.5">
              <s.Icon aria-hidden="true" weight="fill" className={cn("mt-0.5 size-4 shrink-0", s.tone)} />
              <div className="min-w-0">
                <p className="font-medium">
                  {c.label}
                  <span className="ml-2 text-label font-normal text-muted-foreground">{s.word}</span>
                </p>
                <p className="text-label text-muted-foreground">{c.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <details className="rounded-md bg-background-subtle">
        <summary className="touch-target flex min-h-10 cursor-pointer items-center px-3 text-label font-medium">
          What this test cannot check
        </summary>
        <ul className="list-disc space-y-0.5 px-3 pb-3 pl-7 text-label text-muted-foreground">
          {report.notChecked.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function TestStep({
  projectId,
  report,
  onReport,
  onContinue,
}: {
  projectId: string;
  report: Report | null;
  onReport: (r: Report | null) => void;
  onContinue: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      onReport(await api<Report>(`/api/projects/${projectId}/github-check`, { method: "POST" }));
    } catch (err) {
      onReport(null);
      setError(message(err, "Could not run the test. Try again in a minute."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-label text-muted-foreground">
        Run it after the workflow is merged. It looks at Egg&apos;s records and, read only, at your repository. It cannot see
        your GitHub secrets or environment settings.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant={report?.allPassed ? "outline" : "default"} onClick={() => void run()} loading={busy} disabled={busy}>
          {busy ? "Testing…" : report ? "Test again" : "Test connection"}
        </Button>
        {report?.allPassed ? (
          <Button type="button" onClick={onContinue}>
            Continue
          </Button>
        ) : null}
      </div>
      <div role="status" aria-live="polite" className="empty:hidden">
        {error ? <Alert tone="error">{error}</Alert> : report ? <CheckList report={report} /> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ step 5: first build */

const STATE_WORDS: Record<string, string> = {
  ready: "ready",
  building: "building",
  error: "failed",
  queued: "queued",
  canceled: "canceled",
};

export function FirstBuildStep({
  slug,
  repo,
  branch,
  state,
  autoDeploy,
}: {
  slug: string;
  repo: string | null;
  branch: string;
  state: string | null;
  autoDeploy: boolean;
}) {
  const actions = repo ? `https://github.com/${repo}/actions/workflows/egg.yml` : null;
  return (
    <div className="space-y-3">
      <p className="text-label text-muted-foreground">
        Push a commit to <code className="font-mono text-foreground">{branch}</code>
        {actions ? (
          <>
            , or open{" "}
            <a href={actions} target="_blank" rel="noopener noreferrer" className="link font-medium">
              the workflow on GitHub<span className="sr-only"> (opens in a new tab)</span>
            </a>{" "}
            and press Run workflow.
          </>
        ) : (
          <>, or open the workflow on GitHub and press Run workflow.</>
        )}{" "}
        The build runs on GitHub. When it finishes, Egg deploys the release.
      </p>
      {autoDeploy ? null : (
        <Alert tone="note">
          Deploy automatically on push is off, so a push starts no deployment. Deploy from Egg once, then run the workflow
          by hand on the same branch.
        </Alert>
      )}
      <p className="text-label text-muted-foreground">
        {state ? `Latest deployment: ${STATE_WORDS[state] ?? state}.` : "Nothing has been deployed yet."}{" "}
        <Link href={`/projects/${slug}/deployments`} className="link font-medium">
          Open the deployments
        </Link>{" "}
        to follow it.
      </p>
    </div>
  );
}

export { date as formatDate, message as errorMessage };
