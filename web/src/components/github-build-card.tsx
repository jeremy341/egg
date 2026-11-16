"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import { BuildLocationChoice } from "@/components/build-location-choice";
import {
  CredentialsStep,
  FirstBuildStep,
  SecretsStep,
  SetupProgress,
  SetupStep,
  STEP_IDS,
  TestStep,
  WorkflowStep,
  errorMessage,
  firstUnfinished,
  formatDate,
  type Made,
  type Report,
  type StepId,
  type WorkflowInfo,
} from "@/components/github-setup-steps";
import { Card } from "@/components/settings-ui";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import type { BuildLocation } from "@/server/db/schema";
import type { ProjectView } from "@/server/queries";
import { cn } from "@/lib/utils";

type CredentialInfo = { configured: boolean; credentials: { scope: string; createdAt: string; expiresAt: string; expired: boolean }[] };

const SAVED_NOTE: Record<BuildLocation, string> = {
  github: "Builds run on GitHub Actions.",
  container: "Builds run on your Nest container.",
};

/**
 * "Where builds run": the saved choice, and for GitHub Actions the guided setup. The choice changes only when the
 * person presses Save.
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
      setMsg({ ok: false, text: errorMessage(err, "Could not save") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      id="builds-heading"
      title="Where Builds Run"
      description="How Egg builds this project before releasing it to your container."
      docsHref="/docs/build-github-actions"
      docsTopic="building with GitHub Actions"
      docsLabel="Learn more"
      footer={
        <>
          <p role="status" className={cn("min-w-0 text-label", msg?.ok === false ? "text-destructive" : "text-muted-foreground")}>
            {msg?.text ?? (choice === saved ? `${SAVED_NOTE[saved]} Applies to the next deployment.` : "Not saved yet.")}
          </p>
          <Button type="submit" form="build-location-form" loading={saving} disabled={choice === saved}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <form id="build-location-form" onSubmit={save}>
        <BuildLocationChoice name="build-location" legend="Where builds run" value={choice} onChange={setChoice} />
      </form>

      {saved === "github" ? (
        <GithubSetup
          projectId={project.id}
          slug={project.slug}
          repo={project.repo}
          branch={project.branch}
          autoDeploy={project.autoDeploy}
          state={project.state}
        />
      ) : choice === "github" ? (
        <p className="mt-4 text-label text-muted-foreground">Save this choice to see the setup steps.</p>
      ) : null}
    </Card>
  );
}

/**
 * The guided setup. Progress is not stored anywhere: step 1 is done when Egg holds unexpired credentials, step 4
 * when the last test passed, and steps 2 and 3 when the person says so. A returning visitor therefore starts at
 * the first step Egg cannot confirm, and can open any step.
 */
function GithubSetup({
  projectId,
  slug,
  repo,
  branch,
  autoDeploy,
  state,
}: {
  projectId: string;
  slug: string;
  repo: string | null;
  branch: string;
  autoDeploy: boolean;
  state: string | null;
}) {
  const [info, setInfo] = useState<WorkflowInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [creds, setCreds] = useState<CredentialInfo | null>(null);
  const [credsLoaded, setCredsLoaded] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const [makeBusy, setMakeBusy] = useState(false);
  const [makeError, setMakeError] = useState<string | null>(null);
  const [secretsAck, setSecretsAck] = useState(false);
  const [workflowDone, setWorkflowDone] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  /** null: follow the first unfinished step. "none": the person closed the open step. */
  const [open, setOpen] = useState<StepId | "none" | null>(null);
  const focusAfter = useRef<StepId | null>(null);

  const fetchWorkflow = useCallback(() => api<WorkflowInfo>(`/api/projects/${projectId}/github-workflow`), [projectId]);
  const showWorkflow = useCallback((next: WorkflowInfo | null, err?: unknown) => {
    setInfo(next);
    setInfoError(next ? null : errorMessage(err, "Could not make the workflow. Try again."));
  }, []);

  useEffect(() => {
    let live = true;
    fetchWorkflow()
      .then((next) => live && showWorkflow(next))
      .catch((err) => live && showWorkflow(null, err));
    api<CredentialInfo>(`/api/projects/${projectId}/build-credentials`)
      .then((c) => live && setCreds(c))
      .catch(() => live && setCreds(null))
      .finally(() => live && setCredsLoaded(true));
    return () => {
      live = false;
    };
  }, [projectId, fetchWorkflow, showWorkflow]);

  const credsDone = Boolean(creds?.configured) && !creds?.credentials.some((c) => c.expired);
  const done: Record<StepId, boolean> = {
    credentials: credsDone,
    secrets: secretsAck,
    workflow: workflowDone,
    test: Boolean(report?.allPassed),
    build: false,
  };
  const expanded: StepId | null = !credsLoaded || open === "none" ? null : (open ?? firstUnfinished(done));
  const headerStep: StepId | null = credsLoaded ? (expanded ?? firstUnfinished(done)) : null;

  // After a step changes by a button, focus moves to the new step's header so keyboard and screen reader users follow it.
  useEffect(() => {
    if (focusAfter.current && focusAfter.current === expanded) {
      document.getElementById(`setup-${expanded}-header`)?.focus();
      focusAfter.current = null;
    }
  }, [expanded]);

  const goTo = (id: StepId) => {
    focusAfter.current = id;
    setOpen(id);
  };

  async function make() {
    setMakeBusy(true);
    setMakeError(null);
    try {
      const m = await api<Made>(`/api/projects/${projectId}/build-credentials`, { method: "POST" });
      setMade(m);
      setSecretsAck(false);
      setCreds({
        configured: true,
        credentials: ["upload_preview", "upload_production", "env_preview", "env_production"].map((scope) => ({
          scope,
          createdAt: m.createdAt,
          expiresAt: m.expiresAt,
          expired: false,
        })),
      });
      goTo("secrets");
    } catch (err) {
      setMakeError(errorMessage(err, "Could not make the credentials. Try again."));
      throw err;
    } finally {
      setMakeBusy(false);
    }
  }

  const earliest = creds?.configured ? creds.credentials.map((c) => c.expiresAt).sort()[0] : null;
  const expired = creds?.configured ? creds.credentials.some((c) => c.expired) : false;
  const credStatus =
    creds === null ? null : !creds.configured ? "None yet." : expired ? "They have expired. Make new ones." : `Made. They work until ${formatDate(earliest as string)}.`;

  const summaries: Record<StepId, string | null> = {
    credentials: credsDone ? credStatus : null,
    secrets: secretsAck ? "Saved on GitHub." : null,
    workflow: workflowDone ? "The workflow file is on the repository." : null,
    test: report ? (report.allPassed ? "Every check passed." : "Some checks failed.") : null,
    build: null,
  };

  const loadWorkflow = () => fetchWorkflow().then((next) => showWorkflow(next)).catch((err) => showWorkflow(null, err));

  const bodies: Record<StepId, React.ReactNode> = {
    credentials: (
      <CredentialsStep
        busy={makeBusy}
        error={makeError}
        days={info?.limits.credentialDays}
        status={credStatus}
        replacing={Boolean(creds?.configured)}
        onMake={() => void make().catch(() => {})}
        confirmSlot={
          <ConfirmDialog
            title="Make new credentials?"
            description="The old ones stop working at once. Replace all four secrets on GitHub with the new values, or the workflow will fail."
            confirmLabel="Make new credentials"
            pendingLabel="Making…"
            onConfirm={make}
            trigger={
              <Button type="button" variant="outline" disabled={makeBusy}>
                Make new credentials
              </Button>
            }
          />
        }
      />
    ),
    secrets: (
      <SecretsStep
        branch={branch}
        secrets={info?.secrets ?? null}
        made={made}
        acknowledged={secretsAck}
        onAcknowledge={() => {
          setSecretsAck(true);
          goTo("workflow");
        }}
      />
    ),
    workflow: (
      <WorkflowStep
        projectId={projectId}
        info={info}
        error={infoError}
        branch={branch}
        onReload={() => void loadWorkflow()}
        done={workflowDone}
        onDone={() => {
          setWorkflowDone(true);
          if (expanded === "workflow") goTo("test");
        }}
      />
    ),
    test: <TestStep projectId={projectId} report={report} onReport={setReport} onContinue={() => goTo("build")} />,
    build: <FirstBuildStep slug={slug} repo={repo} branch={branch} state={state} autoDeploy={autoDeploy} />,
  };

  return (
    <div className="mt-5 border-t pt-5">
      <SetupProgress current={headerStep} done={done} />
      <ol className="mt-3 divide-y divide-[var(--ds-gray-alpha-200)]">
        {STEP_IDS.map((id, i) => (
          <SetupStep
            key={id}
            id={id}
            number={i + 1}
            open={expanded === id}
            done={done[id]}
            summary={summaries[id]}
            onToggle={() => setOpen(expanded === id ? "none" : id)}
          >
            {bodies[id]}
          </SetupStep>
        ))}
      </ol>
      {info ? (
        <p className="mt-3 text-label text-muted-foreground">
          After setup, a push to {branch} builds on GitHub and Egg deploys the release, waiting up to {info.limits.waitMinutes}{" "}
          minutes for it.
        </p>
      ) : null}
    </div>
  );
}
