"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircleIcon, CheckIcon, CopyIcon, MinusCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { api } from "@/components/api";
import { CopyField } from "@/components/copy-field";
import { Swap } from "@/components/motion/swap";
import { Card } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { BuildLocation } from "@/server/db/schema";
import type { ProjectView } from "@/server/queries";
import { cn } from "@/lib/utils";

type Secret = {
  name: string;
  credential: "previewUploadToken" | "productionUploadToken" | "previewEnvToken" | "productionEnvToken";
  /** Where the secret is saved on GitHub: the production ones in the egg-production environment. */
  store: "environment" | "repository";
  purpose: string;
};
type WorkflowInfo = {
  path: string;
  workflow: string;
  secrets: Secret[];
  limits: { waitMinutes: number; maxArchiveMb: number; credentialDays: number };
};
type CredentialInfo = { configured: boolean; credentials: { scope: string; createdAt: string; expiresAt: string; expired: boolean }[] };
type Made = Record<Secret["credential"], string> & { createdAt: string; expiresAt: string };
type Check = { id: string; label: string; status: "pass" | "fail" | "not_checked"; detail: string };
type Report = { checks: Check[]; allPassed: boolean; notChecked: string[] };

const CHOICES: { value: BuildLocation; title: string; text: string }[] = [
  {
    value: "container",
    title: "On my container",
    text: "Egg builds on your Nest container under a memory and CPU cap. Nothing depends on GitHub. Suits small apps.",
  },
  {
    value: "github",
    title: "In GitHub Actions",
    text: "A workflow in your repository builds the app and sends the finished release to Egg. Suits framework builds that need more memory than the container has. It uses your GitHub Actions minutes.",
  },
];

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

/**
 * "Where builds run": the choice, and for GitHub Actions the four things a user does once: make the build
 * credentials, save them on GitHub, add the workflow file, and test the connection.
 */
export function GithubBuildCard({ project }: { project: ProjectView }) {
  const router = useRouter();
  const [saved, setSaved] = useState<BuildLocation>(project.buildLocation);
  const [choice, setChoice] = useState<BuildLocation>(project.buildLocation);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", body: { buildLocation: choice } });
      setSaved(choice);
      setMsg({ ok: true, text: choice === "github" ? "Saved. Follow the steps below." : "Saved. The next deployment builds on your container." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: message(err, "Could not save") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      id="builds-heading"
      title="Where Builds Run"
      description="Choose where this project is installed and built before it is released to your container."
      docsHref="/docs/projects#projects-settings"
      docsTopic="project settings"
      footer={
        <>
          <p role="status" className={cn("min-w-0 text-label", msg?.ok === false ? "text-destructive" : "text-muted-foreground")}>
            {msg?.text ?? (choice === saved ? "Applies to the next deployment." : "Not saved yet.")}
          </p>
          <Button type="submit" form="build-location-form" loading={saving} disabled={choice === saved}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="build-location-form" onSubmit={save}>
        <fieldset className="min-w-0">
          <legend className="sr-only">Where builds run</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CHOICES.map((c) => (
              <label key={c.value} className="touch-target relative block min-w-0 cursor-pointer">
                <input
                  type="radio"
                  name="build-location"
                  value={c.value}
                  checked={choice === c.value}
                  onChange={() => setChoice(c.value)}
                  className="peer sr-only"
                />
                <span className="flex h-full flex-col gap-1 rounded-md bg-background p-3 shadow-border-base transition-[box-shadow] duration-(--dur-fast) hover:shadow-border-hover peer-checked:shadow-[0_0_0_2px_var(--foreground)] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--ds-focus-color)]">
                  <span className="font-medium">{c.title}</span>
                  <span className="text-label text-muted-foreground">{c.text}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </form>

      {saved === "github" ? (
        <GithubSetup projectId={project.id} branch={project.branch} autoDeploy={project.autoDeploy} />
      ) : choice === "github" ? (
        <p className="mt-4 text-label text-muted-foreground">Save this choice to see the setup steps.</p>
      ) : null}
    </Card>
  );
}

function GithubSetup({ projectId, branch, autoDeploy }: { projectId: string; branch: string; autoDeploy: boolean }) {
  const [info, setInfo] = useState<WorkflowInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [creds, setCreds] = useState<CredentialInfo | null>(null);
  const [made, setMade] = useState<Made | null>(null);

  const fetchWorkflow = useCallback(() => api<WorkflowInfo>(`/api/projects/${projectId}/github-workflow`), [projectId]);
  const showWorkflow = useCallback((next: WorkflowInfo | null, err?: unknown) => {
    setInfo(next);
    setInfoError(next ? null : message(err, "Could not make the workflow"));
  }, []);

  useEffect(() => {
    let live = true;
    fetchWorkflow()
      .then((next) => live && showWorkflow(next))
      .catch((err) => live && showWorkflow(null, err));
    api<CredentialInfo>(`/api/projects/${projectId}/build-credentials`)
      .then((c) => live && setCreds(c))
      .catch(() => live && setCreds(null));
    return () => {
      live = false;
    };
  }, [projectId, fetchWorkflow, showWorkflow]);

  const loadWorkflow = () => fetchWorkflow().then((next) => showWorkflow(next)).catch((err) => showWorkflow(null, err));

  const days = info?.limits.credentialDays;
  const earliestExpiry = creds?.configured
    ? creds.credentials.map((c) => c.expiresAt).sort()[0]
    : null;
  const expired = creds?.configured ? creds.credentials.some((c) => c.expired) : false;

  return (
    <div className="mt-5 border-t pt-5">
      <p className="text-label text-muted-foreground">
        Do these four steps once. After that, a push to {branch} builds on GitHub and Egg deploys the finished release
        {info ? `, waiting up to ${info.limits.waitMinutes} minutes for it` : ""}. Other branches build previews the same way.
      </p>
      {autoDeploy ? null : (
        <Alert tone="note" className="mt-3">
          Deploy automatically on push is off for this project, so a push starts no deployment. Deploy from Egg first,
          then run the workflow by hand on the same branch.
        </Alert>
      )}

      <ol className="mt-4 space-y-6">
        <li>
          <h3 className="font-medium">1. Make the build credentials</h3>
          <p className="mt-1 text-label text-muted-foreground">
            Four credentials let the workflow send a release and read build variables, and nothing else: a pair for
            production and a pair for previews. A production credential cannot deliver a preview build, and a preview
            credential cannot deliver a production one{days ? `. They work for ${days} days.` : "."} Egg shows them once
            and keeps only a fingerprint.
          </p>
          <CredentialsStep
            projectId={projectId}
            secrets={info?.secrets ?? null}
            made={made}
            onMade={(m) => {
              setMade(m);
              setCreds({
                configured: true,
                credentials: ["upload_preview", "upload_production", "env_preview", "env_production"].map((scope) => ({
                  scope,
                  createdAt: m.createdAt,
                  expiresAt: m.expiresAt,
                  expired: false,
                })),
              });
            }}
            status={
              creds === null
                ? null
                : !creds.configured
                  ? "None yet."
                  : expired
                    ? "They have expired."
                    : `Made. They work until ${date(earliestExpiry as string)}.`
            }
            replacing={Boolean(creds?.configured)}
          />
        </li>

        <li>
          <h3 className="font-medium">2. Save the secrets on GitHub</h3>
          <SecretsStep branch={branch} />
        </li>

        <li>
          <h3 className="font-medium">3. Add the workflow file</h3>
          <WorkflowStep info={info} error={infoError} branch={branch} onReload={() => void loadWorkflow()} />
        </li>

        <li>
          <h3 className="font-medium">4. Test the connection</h3>
          <TestStep projectId={projectId} />
        </li>
      </ol>
    </div>
  );
}

function CredentialsStep({
  projectId,
  secrets,
  made,
  onMade,
  status,
  replacing,
}: {
  projectId: string;
  secrets: Secret[] | null;
  made: Made | null;
  onMade: (m: Made) => void;
  status: string | null;
  replacing: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Throws on failure so the confirm dialog can show the message. */
  async function make() {
    setBusy(true);
    try {
      onMade(await api<Made>(`/api/projects/${projectId}/build-credentials`, { method: "POST" }));
    } finally {
      setBusy(false);
    }
  }

  async function makeFirst() {
    setError(null);
    try {
      await make();
    } catch (err) {
      setError(message(err, "Could not make the credentials"));
    }
  }

  return (
    <div className="mt-3 space-y-3">
      {made ? (
        <div className="motion-enter space-y-3">
          <p className="text-label text-muted-foreground">
            Copy each value now; they are not shown again. Step 2 says where each one is saved: the two production
            values go in the egg-production environment, the two preview values in the repository.
          </p>
          {(["environment", "repository"] as const).map((store) => {
            const group = (secrets ?? []).filter((s) => s.store === store);
            if (group.length === 0) return null;
            return (
              <div key={store} className="space-y-3">
                <p className="text-label font-medium">
                  {store === "environment" ? "Production: save in the egg-production environment" : "Previews: save as repository secrets"}
                </p>
                {group.map((s) => (
                  <div key={s.name}>
                    <p className="mb-1 text-label">
                      <span className="font-mono text-[13px] font-medium">{s.name}</span>
                      <span className="text-muted-foreground">: {s.purpose}</span>
                    </p>
                    <CopyField value={made[s.credential]} label={`Value for the ${s.name} secret`} />
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : status ? (
        <p role="status" className="text-muted-foreground">
          {status}
        </p>
      ) : null}
      {error ? (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      ) : null}
      {replacing ? (
        <ConfirmDialog
          title="Make new credentials?"
          description="The old ones stop working at once. Replace all four secrets on GitHub with the new values, or the workflow will fail."
          confirmLabel="Make new credentials"
          pendingLabel="Making…"
          onConfirm={make}
          trigger={
            <Button type="button" variant="outline" disabled={busy}>
              Make new credentials
            </Button>
          }
        />
      ) : (
        <Button type="button" loading={busy} disabled={busy} onClick={() => void makeFirst()}>
          {busy ? "Making…" : "Make credentials"}
        </Button>
      )}
    </div>
  );
}

/**
 * Where each secret goes on GitHub. The production pair lives in an Environment so GitHub can limit it to the
 * production branch; a repository secret is readable by a workflow on any branch.
 */
function SecretsStep({ branch }: { branch: string }) {
  return (
    <div className="mt-1 space-y-3">
      <p className="text-label text-muted-foreground">
        On GitHub, open your repository and do this once. The production values must not be repository secrets: a
        repository secret can be read by a workflow that someone edits on any branch.
      </p>
      <ol className="list-decimal space-y-1.5 pl-5 text-label text-muted-foreground">
        <li>
          Open Settings, then Environments, then New environment. Name it{" "}
          <code className="font-mono text-foreground">egg-production</code>.
        </li>
        <li>
          Under Deployment branches and tags, choose Selected branches and tags, add a rule for{" "}
          <code className="font-mono text-foreground">{branch}</code> (this project&apos;s production branch), and save. Optionally turn on Required reviewers so a person
          approves each production build.
        </li>
        <li>
          In that environment, under Environment secrets, add{" "}
          <code className="font-mono text-foreground">EGG_UPLOAD_PRODUCTION_TOKEN</code> and{" "}
          <code className="font-mono text-foreground">EGG_ENV_PRODUCTION_TOKEN</code>.
        </li>
        <li>
          Open Settings, Secrets and variables, Actions, and add{" "}
          <code className="font-mono text-foreground">EGG_UPLOAD_PREVIEW_TOKEN</code> and{" "}
          <code className="font-mono text-foreground">EGG_ENV_PREVIEW_TOKEN</code> as repository secrets.
        </li>
      </ol>
      <Alert tone="note">
        This keeps the production credentials away from workflows on other branches. It does not make workflow editors
        harmless: anyone who can push a workflow can run code with the preview credentials and with whatever else your
        repository allows. Treat the people who can edit workflows as trusted operators of this project. Project roles
        in Egg do not isolate Nest accounts.
      </Alert>
    </div>
  );
}

function WorkflowStep({
  info,
  error,
  branch,
  onReload,
}: {
  info: WorkflowInfo | null;
  error: string | null;
  branch: string;
  onReload: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.workflow);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  if (error) {
    return (
      <div className="mt-2 space-y-2">
        <Alert tone="error" role="alert">
          {error}
        </Alert>
        <Button type="button" variant="outline" size="sm" onClick={onReload}>
          Try again
        </Button>
      </div>
    );
  }
  if (!info) return <p className="mt-2 text-muted-foreground">Making the workflow…</p>;

  return (
    <div className="mt-1 space-y-3">
      <p className="text-label text-muted-foreground">
        In your repository, create the file <code className="font-mono text-foreground">{info.path}</code> on the{" "}
        <code className="font-mono text-foreground">{branch}</code> branch with the text below, and commit it. It is made from
        this project&apos;s saved settings. If you change the runtime, commands, root directory or production branch, copy it
        again.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          <Swap value={copied} className="inline-flex items-center gap-1">
            {copied ? <CheckIcon /> : <CopyIcon />}
            {copied ? "Copied" : "Copy the workflow"}
          </Swap>
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onReload}>
          Make it again from saved settings
        </Button>
        <span aria-live="polite" className="sr-only">
          {copied ? "Workflow copied" : ""}
        </span>
      </div>
      <pre
        tabIndex={0}
        aria-label={`Contents of ${info.path}`}
        className="max-h-96 overflow-auto rounded-md bg-[var(--code-bg)] p-3 font-mono text-[12.5px] leading-5 shadow-border-base"
      >
        {info.workflow}
      </pre>
      <p className="text-label text-muted-foreground">
        A release can be up to {info.limits.maxArchiveMb} MB. The workflow stops with a message if it is larger.
      </p>
    </div>
  );
}

const STATUS = {
  pass: { word: "Passed", Icon: CheckCircleIcon, tone: "text-[var(--tone-success-icon)]" },
  fail: { word: "Failed", Icon: XCircleIcon, tone: "text-[var(--tone-error-icon)]" },
  not_checked: { word: "Not checked", Icon: MinusCircleIcon, tone: "text-muted-foreground" },
} as const;

function TestStep({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setReport(await api<Report>(`/api/projects/${projectId}/github-check`, { method: "POST" }));
    } catch (err) {
      setReport(null);
      setError(message(err, "Could not run the test"));
    } finally {
      setBusy(false);
    }
  }

  const failed = report?.checks.filter((c) => c.status === "fail").length ?? 0;
  const skipped = report?.checks.filter((c) => c.status === "not_checked").length ?? 0;

  return (
    <div className="mt-1 space-y-3">
      <p className="text-label text-muted-foreground">
        Looks at Egg&apos;s records and, read only, at your repository through the GitHub app. Run it after you commit the file.
        It cannot see your GitHub secrets or environment settings, so check by hand that the production secrets are in
        the egg-production environment, which is limited to your production branch, and not in the repository.
      </p>
      <Button type="button" variant="outline" onClick={() => void run()} loading={busy} disabled={busy}>
        {busy ? "Testing…" : report ? "Test again" : "Test connection"}
      </Button>

      <div role="status" aria-live="polite">
        {error ? (
          <Alert tone="error">{error}</Alert>
        ) : report ? (
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
            <div className="rounded-md bg-background-subtle p-3">
              <p className="text-label font-medium">What this test cannot check</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-label text-muted-foreground">
                {report.notChecked.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p className="mt-2 text-label text-muted-foreground">
                To see the secrets work end to end, push a commit and open the workflow run on GitHub.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
