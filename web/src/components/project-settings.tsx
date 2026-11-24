"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CaretRightIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import { api } from "@/components/api";
import { Swap } from "@/components/motion/swap";
import { GithubBuildCard } from "@/components/github-build-card";
import { HomepageFeedCard } from "@/components/homepage-feed-card";
import { StatisticsCard } from "@/components/statistics-card";
import { AlertsCard, DeployHookCard, NotificationsCard, StatusPageCard } from "@/components/project-automation";
import { ScheduledJobsCard } from "@/components/scheduled-jobs-card";
import { PageHeader } from "@/components/page-header";
import { buildBody, ProjectBuildFields, toBuildForm, type BuildForm } from "@/components/project-build-fields";
import { EnvImportButton } from "@/components/env-import";
import { ENV_TARGET_LABEL, EnvHelp } from "@/components/env-help";
import { Card, Label } from "@/components/settings-ui";
import { SettingsNav } from "@/components/settings-nav";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PixelAvatar } from "@/components/ui/pixel-avatar";
import type { ProjectView } from "@/server/queries";
import { cn } from "@/lib/utils";
import { CleanupCard } from "@/components/cleanup-card";
import { AlertRulesCard } from "@/components/alert-rules-card";
import { ProjectMembersCard } from "@/components/project-members-card";
import { HostingOptions, StartCommandHelp, runtimeHint, type TargetCapabilities } from "@/components/hosting-options";
import { ContainerDeploymentFields, containerConfigurationError, containerDeploymentBody, defaultContainerForm } from "@/components/container-deployment-fields";

type EnvVar = { id: string; key: string; target: "all" | "production" | "preview" };

/** The cards inside the Automation "Advanced" disclosure. The settings nav links to their headings. */
const AUTOMATION_ADVANCED_IDS = ["alerts-heading", "status-page-heading", "homepage-feed-heading"];

/** One heading for a group of cards. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-6">
      <h2 id={id} className="border-b pb-2 text-sm font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A native disclosure for the rarely used options of a section. */
function Advanced({
  label = "Advanced",
  open,
  onOpenChange,
  className,
  children,
}: {
  label?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details
      className={cn("disclosure", className)}
      open={open}
      onToggle={onOpenChange ? (e) => onOpenChange(e.currentTarget.open) : undefined}
    >
      <summary className="touch-target -mx-1 w-fit items-center gap-1.5 rounded-sm px-1 py-1.5 text-label font-medium max-sm:min-h-10">
        <CaretRightIcon aria-hidden="true" className="disclosure-caret size-4" />
        {label}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

export function ProjectSettings({
  project,
  env: initialEnv,
}: {
  project: ProjectView;
  env: EnvVar[];
}) {
  const router = useRouter();

  // ---- build and run settings
  const [form, setForm] = useState({
    port: project.listenPort === null ? "" : String(project.listenPort),
    deploymentMode: project.deploymentMode,
    startCommand: project.startCommand ?? "",
    productionBranch: project.branch,
    healthPath: project.healthPath,
    autoDeploy: project.autoDeploy,
  });
  // Runtime, install, build, output and root directory load after the page does.
  const [build, setBuild] = useState<BuildForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [capabilities, setCapabilities] = useState<TargetCapabilities | null>(null);
  const [container, setContainer] = useState({
    dockerfilePath: project.dockerfilePath ?? defaultContainerForm.dockerfilePath,
    composeFilePath: project.composeFilePath ?? defaultContainerForm.composeFilePath,
    composeService: project.composeService ?? defaultContainerForm.composeService,
    containerPort: project.containerPort === null ? "" : String(project.containerPort ?? defaultContainerForm.containerPort),
  });
  const containerError = containerConfigurationError(form.deploymentMode, project.workloadKind, container);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const githubPush = project.repoUrl.startsWith("https://github.com/") && project.repo !== null;
  useEffect(() => {
    let live = true;
    api<TargetCapabilities>(`/api/servers/${project.serverId}/capabilities`).then((value) => { if (live) { setCapabilities(value); setCapabilityError(null); } }).catch((error) => { if (live) setCapabilityError(error instanceof Error ? error.message : "Could not load target capabilities."); });
    return () => { live = false; };
  }, [project.serverId, capabilityAttempt]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: {
          listenPort: project.workloadKind === "worker" ? (form.port.trim() === "" ? null : Number(form.port)) : Number(form.port),
          deploymentMode: form.deploymentMode,
          ...containerDeploymentBody(form.deploymentMode, project.workloadKind, container),
          startCommand: form.startCommand.trim() || null,
          productionBranch: form.productionBranch.trim(),
          ...(project.workloadKind === "web" ? { healthPath: form.healthPath.trim() || "/" } : {}),
          autoDeploy: githubPush && form.autoDeploy,
          ...(build ? buildBody(build) : {}),
        },
      });
      setSaveMsg({ ok: true, text: "Saved. Changes apply to the next deployment." });
      router.refresh();
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : "Could not save" });
    } finally {
      setSaving(false);
    }
  }

  // ---- environment variables
  const [env, setEnv] = useState(initialEnv);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [target, setTarget] = useState<EnvVar["target"]>("all");
  const [envError, setEnvError] = useState<string | null>(null);
  const [envSaving, setEnvSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const valueRef = useRef<HTMLInputElement>(null);

  /** Values are never sent back, so editing means typing a new one for the same name. */
  function editEnv(v: EnvVar) {
    setKey(v.key);
    setTarget(v.target);
    setValue("");
    setEditing(true);
    valueRef.current?.focus();
  }

  async function addEnv(e: React.FormEvent) {
    e.preventDefault();
    setEnvError(null);
    setEnvSaving(true);
    try {
      const res = await api<{ env: EnvVar[] }>(`/api/projects/${project.id}/env`, {
        method: "POST",
        body: { key, value, target },
      });
      setEnv(res.env);
      setKey("");
      setValue("");
      setEditing(false);
    } catch (err) {
      setEnvError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setEnvSaving(false);
    }
  }

  /**
   * Throws on failure so the confirm dialog can show the message. The row is
   * removed just after the dialog has closed, so focus can return somewhere
   * real instead of to a trigger that no longer exists.
   */
  async function removeEnv(id: string) {
    await api(`/api/projects/${project.id}/env/${id}`, { method: "DELETE" });
    window.setTimeout(() => {
      setEnv((list) => list.filter((v) => v.id !== id));
      if (window.matchMedia("(pointer: fine)").matches) {
        document.getElementById("env-key")?.focus();
      }
    }, 180);
  }

  // ---- danger zone
  const [confirm, setConfirm] = useState("");
  const [removeRemote, setRemoteRemoval] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [protectedNow, setProtectedNow] = useState(project.deletionProtected);
  const [protectionError, setProtectionError] = useState<string | null>(null);

  async function setProtection(on: boolean) {
    setProtectionError(null);
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", body: { deletionProtected: on } });
      setProtectedNow(on);
      router.refresh();
    } catch (err) {
      setProtectionError(err instanceof Error ? err.message : "Could not change deletion protection");
    }
  }

  async function destroy() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api(`/api/projects/${project.id}${removeRemote ? "?remote=1" : ""}`, {
        method: "DELETE",
      });
      router.push("/projects");
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete");
      setDeleting(false);
    }
  }

  const canDelete = confirm === project.slug;

  // ---- automation: open the Advanced group when a link points at a card inside it
  const [autoOpen, setAutoOpen] = useState(false);
  useEffect(() => {
    const reveal = () => {
      if (AUTOMATION_ADVANCED_IDS.includes(window.location.hash.slice(1))) setAutoOpen(true);
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);

  return (
    <div className="motion-enter w-full max-w-[936px]">
      <PageHeader
        leading={<PixelAvatar seed={project.slug} size={40} />}
        title="Settings"
        description={`${project.name} on ${project.nestUsername}.hackclub.app`}
      />
      <div className="grid gap-10 lg:grid-cols-[176px_minmax(0,720px)]">
        <SettingsNav />

        <div className="min-w-0 space-y-10">
          <Section id="section-build" title="Build">
          <Card
            id="run-heading"
            title="Build and Run"
            description="How this project starts on your Nest container."
            docsHref="/docs/projects#projects-settings"
            docsTopic="project settings"
            footer={
              <>
                <p
                  role="status"
                  className={cn(
                    "text-label",
                    saveMsg?.ok === false ? "text-destructive" : "text-muted-foreground"
                  )}
                >
                  <Swap value={saveMsg?.text ?? "idle"}>
                    {saveMsg?.text ?? "Changes apply to the next deployment."}
                  </Swap>
                </p>
                <Button type="submit" form="run-form" loading={saving} disabled={!build || Boolean(containerError)}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </>
            }
          >
            <form id="run-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
              <HostingOptions prefix="ps" workloadKind={project.workloadKind} workloadLocked deploymentMode={form.deploymentMode} capabilities={capabilities} onWorkloadChange={() => {}} onModeChange={(value) => setForm({ ...form, deploymentMode: value })} />
              {capabilityError && <Alert role="alert" tone="error" className="sm:col-span-2" action={<Button type="button" variant="outline" size="sm" onClick={() => { setCapabilityError(null); setCapabilityAttempt((attempt) => attempt + 1); }}>Try again</Button>}>Could not load target capabilities: {capabilityError} Container modes remain unavailable until the check succeeds.</Alert>}
              <ContainerDeploymentFields prefix="ps" mode={form.deploymentMode} workloadKind={project.workloadKind} value={container} onChange={setContainer} />
              {containerError && <p role="alert" className="text-label text-destructive sm:col-span-2">{containerError}</p>}
              <div>
                <Label htmlFor="ps-branch">Production branch</Label>
                <Input
                  id="ps-branch"
                  value={form.productionBranch}
                  onChange={(e) => setForm({ ...form, productionBranch: e.target.value })}
                  className="font-mono"
                />
              </div>
              <div>
                <Label htmlFor="ps-port">{project.workloadKind === "worker" ? "Listen port (optional)" : "Port"}</Label>
                <Input
                  id="ps-port"
                  inputMode="numeric"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  className="font-mono"
                />
                {project.workloadKind === "worker" && <p className="text-label text-muted-foreground">Fill this only if the bot must receive webhooks over HTTP. A domain can point at it once it is set. Leave it empty to keep the worker closed.</p>}
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="ps-start">Start command</Label>
                <Input
                  id="ps-start"
                  value={form.startCommand}
                  placeholder={runtimeHint(build?.runtime ?? project.runtime)}
                  onChange={(e) => setForm({ ...form, startCommand: e.target.value })}
                  className="font-mono"
                  aria-describedby="ps-start-help"
                />
                <StartCommandHelp runtime={build?.runtime ?? project.runtime} id="ps-start-help" />
              </div>
              <ProjectBuildFields
                projectId={project.id}
                workloadKind={project.workloadKind}
                build={build}
                onLoad={setBuild}
                onChange={setBuild}
                onCopy={(s) => {
                  if (project.workloadKind === "worker" && s.runtime === "static") {
                    setSaveMsg({ ok: false, text: "Static sites require a separate web project. These settings were not copied." });
                    return;
                  }
                  setBuild(toBuildForm(s));
                  setForm((f) => ({ ...f, startCommand: s.startCommand ?? "", healthPath: s.healthPath }));
                }}
              />
              {project.workloadKind === "web" && <div>
                <Label htmlFor="ps-health">Health check path</Label>
                <Input
                  id="ps-health"
                  value={form.healthPath}
                  onChange={(e) => setForm({ ...form, healthPath: e.target.value })}
                  className="font-mono"
                />
              </div>}
              <label className="touch-target inline-flex min-h-10 items-center gap-2 self-end sm:min-h-9">
                <input
                  type="checkbox"
                  checked={form.autoDeploy}
                  disabled={!githubPush}
                  onChange={(e) => setForm({ ...form, autoDeploy: e.target.checked })}
                />
                Deploy automatically on push
              </label>
              {!githubPush && <p className="text-label text-muted-foreground sm:col-span-2">Use manual deployments or the Deploy Hook below. Automatic push deployment needs a verified provider webhook.</p>}
            </form>
          </Card>

          <GithubBuildCard project={project} />
          </Section>

          <Section id="section-env" title="Environment">
          <Card
            id="env-heading"
            title="Environment Variables"
            description="Stored encrypted. Values are never shown again."
            docsHref="/docs/env"
            docsTopic="environment variables"
            docsLabel="Learn more"
          >
            <form
              onSubmit={addEnv}
              className="grid gap-3 sm:grid-cols-2 min-[1280px]:grid-cols-[1fr_1.4fr_130px_auto] sm:items-end"
            >
              <div>
                <Label htmlFor="env-key">Name</Label>
                <Input
                  id="env-key"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="API_KEY"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
              </div>
              <div>
                <Label htmlFor="env-value">Value</Label>
                <Input
                  id="env-value"
                  ref={valueRef}
                  placeholder={editing ? "New value" : undefined}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
              </div>
              <div>
                <Label htmlFor="env-target">Applies to</Label>
                <NativeSelect
                  id="env-target"
                  value={target}
                  onChange={(e) => setTarget(e.target.value as EnvVar["target"])}
                >
                  <option value="all">{ENV_TARGET_LABEL.all}</option>
                  <option value="production">{ENV_TARGET_LABEL.production}</option>
                  <option value="preview">{ENV_TARGET_LABEL.preview}</option>
                </NativeSelect>
              </div>
              {/* The stored value is never shown, so an update must carry a new one. Saving blank would erase it. */}
              <Button type="submit" disabled={!key.trim() || (editing && !value)} loading={envSaving}>
                {envSaving ? "Saving…" : editing ? "Update" : "Save"}
              </Button>
            </form>
            {envError ? (
              <Alert tone="error" role="alert" className="mt-3">
                {envError}
              </Alert>
            ) : null}

            <Advanced label="How variables work" className="mt-4">
              <EnvHelp />
            </Advanced>

            <EnvImportButton
              projectId={project.id}
              existing={env.map((v) => v.key)}
              onImported={setEnv}
            />

            {env.length > 0 ? (
              <ul className="hairline-y mt-4 overflow-hidden rounded-md shadow-border-base">
                {env.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0 truncate font-mono text-[13px]">{v.key}</span>
                    <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                      <span className="mr-2 text-label">{ENV_TARGET_LABEL[v.target]}</span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Change the value of ${v.key}`}
                        onClick={() => editEnv(v)}
                      >
                        <PencilSimpleIcon />
                      </Button>
                      <ConfirmDialog
                        tone="destructive"
                        title={`Delete ${v.key}?`}
                        description="Deployments after this one will not have it."
                        confirmLabel="Delete"
                        pendingLabel="Deleting…"
                        onConfirm={() => removeEnv(v.id)}
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label={`Delete ${v.key}`}>
                            <TrashIcon />
                          </Button>
                        }
                      />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-muted-foreground">No variables yet.</p>
            )}
          </Card>
          </Section>

          <Section id="section-automation" title="Automation">
            <DeployHookCard project={project} />

            <ScheduledJobsCard projectId={project.id} />

            <NotificationsCard project={project} />

            <StatisticsCard projectId={project.id} />

            <Advanced open={autoOpen} onOpenChange={setAutoOpen}>
              <div className="space-y-6">
                <AlertsCard project={project} />
                <AlertRulesCard project={project} />
                <StatusPageCard project={project} />
                <HomepageFeedCard project={project} />
              </div>
            </Advanced>
          </Section>

          <Section id="members-heading" title="Members">
            <ProjectMembersCard projectId={project.id} />
          </Section>

          <Section id="section-danger" title="Danger zone">
          <CleanupCard name={project.slug} projectId={project.id} />

          <Card
            id="protection-heading"
            title="Deletion protection"
            description="While this is on, the app cannot be deleted. Turn it off here first."
          >
            <label className="touch-target inline-flex min-h-10 items-center gap-2 sm:min-h-8">
              <input
                type="checkbox"
                checked={protectedNow}
                onChange={(e) => void setProtection(e.target.checked)}
              />
              Protect this app from deletion
            </label>
            {protectionError ? (
              <p role="alert" className="mt-2 text-label text-foreground">{protectionError}</p>
            ) : null}
            <p className="mt-3 text-label text-muted-foreground">
              Deleted apps are kept for 30 days. <a href="/projects/trash" className="link">See Recently deleted</a>.
            </p>
          </Card>

          <Card
            id="danger-heading"
            title="Delete Project"
            description="Removes the project from Egg. The lists below show what goes and what stays."
            tone="danger"
            footer={
              <>
                {deleteError ? (
                  <p role="alert" className="min-w-0 text-label text-foreground">
                    {deleteError}
                  </p>
                ) : null}
                <Button
                  variant={canDelete ? "destructive-solid" : "destructive"}
                  disabled={!canDelete}
                  loading={deleting}
                  onClick={() => void destroy()}
                  className="ml-auto"
                >
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
              </>
            }
          >
            <label className="touch-target mb-3 inline-flex min-h-10 items-center gap-2 sm:min-h-8">
              <input
                type="checkbox"
                checked={removeRemote}
                onChange={(e) => setRemoteRemoval(e.target.checked)}
              />
              Also stop the service and delete releases on {project.nestUsername}.hackclub.app
            </label>
            <div className="mb-4 grid gap-3 text-[13px] sm:grid-cols-2">
              <div>
                <p className="font-medium">Deleted</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  <li>The project in Egg moves to Recently deleted and is removed for good after 30 days. Deployment history and environment variables can be restored; logs and analytics cannot</li>
                  {removeRemote ? (
                    <li>On your container: the service, its scheduled jobs, previews and all releases</li>
                  ) : null}
                </ul>
              </div>
              <div>
                <p className="font-medium">Kept</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  <li>
                    The shared data folder, <span className="font-mono">~/.egg/{project.slug}/shared</span>
                  </li>
                  <li>Your GitHub repository and the GitHub App installation</li>
                  <li>DNS records for custom domains</li>
                  {removeRemote ? null : (
                    <li>The app and its scheduled jobs keep running on your container, but Egg no longer manages them</li>
                  )}
                </ul>
              </div>
            </div>
            <Label htmlFor="del-confirm">
              Type <span className="font-mono text-foreground">{project.slug}</span> to confirm
            </Label>
            <Input
              id="del-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              className="font-mono"
            />
          </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}
