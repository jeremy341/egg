"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  GitBranchIcon,
  GithubLogoIcon,
  HardDrivesIcon,
  MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { api } from "@/components/api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DetectedSummary,
  DetectionWarnings,
  EnvValueFields,
  useRepoDetection,
} from "@/components/env-import";
import { ProjectConflicts } from "@/components/project-conflicts";
import { HostingOptions, RUNTIME_OPTIONS, StartCommandHelp, runtimeHint, workloadForRuntime, type DeploymentMode, type TargetCapabilities, type WorkloadKind } from "@/components/hosting-options";
import { ProviderConnections } from "@/components/provider-connections";
import { SOURCE_PROVIDERS, providerLabel, repositoryUrl, type SourceProvider } from "@/components/repository-source";
import { ContainerDeploymentFields, containerConfigurationError, containerDeploymentBody, defaultContainerForm } from "@/components/container-deployment-fields";
import type { Conflict } from "@/server/adoption";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  LoadingRegion,
  Skeleton,
  SkeletonCard,
  SkeletonCircle,
  SkeletonRow,
  SkeletonText,
  skeletonWidth,
} from "@/components/ui/skeleton";

type Repo = {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string | null;
  cloneUrl: string;
};

type Source = {
  repoUrl: string;
  repoFullName: string | null;
  installationId: number | null;
  branch: string;
  sourceProvider: SourceProvider;
  providerConnectionId: string | null;
};

export type GithubState = {
  configured: boolean;
  installUrl: string | null;
  installations: { id: number; account: string; type: string }[];
  notice: string | null;
};

type Server = { id: string; nestUsername: string; status: string };

const RUNTIMES = RUNTIME_OPTIONS;

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-label text-muted-foreground">
      {children}
    </label>
  );
}

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "project"
  );
}

type ConflictCheck =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "error"; message: string }
  | { status: "ok"; conflicts: Conflict[] };

/**
 * Ask the chosen container, once the inputs are valid and the person has
 * stopped typing, what is already there. Read-only. A failed check does not
 * block: the deploy looks again before it changes anything.
 */
function useConflictCheck(args: {
  serverId: string;
  slug: string;
  port: number;
  repoFullName: string | null;
  enabled: boolean;
}): ConflictCheck {
  const { serverId, slug, port, repoFullName, enabled } = args;
  const key = enabled ? `${serverId}|${slug}|${port}|${repoFullName ?? ""}` : null;
  const [loaded, setLoaded] = useState<{ key: string; result: ConflictCheck } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api<{ conflicts: Conflict[] }>("/api/projects/conflicts", {
        body: { serverId, slug, port, repoFullName },
      })
        .then((r) => {
          if (!cancelled) setLoaded({ key, result: { status: "ok", conflicts: r.conflicts } });
        })
        .catch((e) => {
          if (!cancelled) {
            setLoaded({
              key,
              result: {
                status: "error",
                message: e instanceof Error ? e.message : "Could not check this container.",
              },
            });
          }
        });
    }, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // The key stands for every argument.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return { status: "idle" };
  if (!loaded || loaded.key !== key) return { status: "checking" };
  return loaded.result;
}

function Configure({
  source,
  servers,
  onBack,
}: {
  source: Source;
  servers: Server[];
  onBack: () => void;
}) {
  const router = useRouter();
  const repoName = (source.repoFullName ?? source.repoUrl).split("/").pop()?.replace(/\.git$/, "") ?? "project";
  const [name, setName] = useState(slugify(repoName));
  const [serverId, setServerId] = useState(servers[0]?.id ?? "");
  const [runtime, setRuntime] = useState<(typeof RUNTIMES)[number]["value"]>("node");
  const [workloadKind, setWorkloadKind] = useState<WorkloadKind>("web");
  /** Set when the person chooses the workload themselves, so a bot detection never overrides their choice. */
  const workloadTouched = useRef(false);
  const [deploymentMode, setDeploymentMode] = useState<DeploymentMode>("native");
  const [container, setContainer] = useState(defaultContainerForm);
  const [capabilityState, setCapabilityState] = useState<{ serverId: string; capabilities: TargetCapabilities | null; error: string | null } | null>(null);
  const [rootDir, setRootDir] = useState(".");
  const [branch, setBranch] = useState(source.branch);
  const [port, setPort] = useState("3000");
  const [startCommand, setStartCommand] = useState("");
  const [buildCommand, setBuildCommand] = useState("");
  const [installCommand, setInstallCommand] = useState("");
  const [outputDir, setOutputDir] = useState("");
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [adopted, setAdopted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Set once the project exists, so a retry after a failed env save does not create it twice.
  const createdRef = useRef<{ id: string; slug: string } | null>(null);

  useEffect(() => {
    if (!serverId) return;
    let live = true;
    api<TargetCapabilities>(`/api/servers/${serverId}/capabilities`).then((capabilities) => {
      if (live) setCapabilityState({ serverId, capabilities, error: null });
    }).catch((e: Error) => { if (live) setCapabilityState({ serverId, capabilities: null, error: e.message }); });
    return () => { live = false; };
  }, [serverId]);
  const capabilities = capabilityState?.serverId === serverId ? capabilityState.capabilities : null;
  const capabilityError = capabilityState?.serverId === serverId ? capabilityState.error : null;

  // Detect from the repository: what it is, and the env names it asks for.
  const repoForDetect = source.sourceProvider === "github"
    ? source.repoFullName ?? source.repoUrl.replace(/^https:\/\/github\.com\//, "")
    : source.providerConnectionId ? source.repoFullName ?? source.repoUrl : source.repoUrl;
  const detected = useRepoDetection(source.sourceProvider === "generic" ? null : {
    repo: repoForDetect,
    branch: branch.trim() || source.branch,
    installationId: source.installationId,
    rootDir,
    sourceProvider: source.sourceProvider,
    providerConnectionId: source.providerConnectionId,
  });
  const detection = detected.status === "ok" ? detected.detection : null;

  /**
   * The detection suggests "worker" for a bot repository. It is a default, so
   * it is applied while the person has not chosen a workload themselves, and
   * the picker stays editable afterwards.
   */
  useEffect(() => {
    const suggestion = detection?.suggestedWorkloadKind;
    if (!suggestion || workloadTouched.current || workloadKind === suggestion) return;
    if (runtime === "static") setRuntime("node");
    setWorkloadKind(suggestion);
    // The suggestion is worth one look, not one per render: it changes only when the detection does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection?.suggestedWorkloadKind]);

  /** Detected names from the repository plus the token names a detected bot framework reads. */
  const envRows = detection
    ? [...detection.env, ...detection.suggestedEnv.filter((s) => !detection.env.some((e) => e.name === s.name))]
    : [];

  /** The user confirms the suggestions by pressing the button; the fields stay editable. */
  function applyDetected() {
    if (!detection || !detection.runtime) return;
    setRuntime(detection.runtime);
    setWorkloadKind(detection.suggestedWorkloadKind ?? workloadForRuntime(detection.runtime, workloadKind));
    setInstallCommand(detection.commands.install ?? "");
    setBuildCommand(detection.commands.build ?? "");
    setStartCommand(detection.commands.start ?? "");
    setOutputDir(detection.outputDir ?? "");
  }

  // The button that opened this step is gone; focus belongs to the new step.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  const nameOk = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]?$/.test(name);
  const hint = runtimeHint(runtime);
  const modeReady = capabilities ? capabilities.deploymentModes[deploymentMode] === true : deploymentMode === "native";
  const runtimeReady = !capabilities || capabilities.runtimes.includes(runtime);
  const containerError = containerConfigurationError(deploymentMode, workloadKind, container);

  const portNumber = Number(port);
  const portOk = port.trim() !== "" && Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  const check = useConflictCheck({
    serverId,
    slug: name,
    port: portNumber,
    repoFullName: source.repoFullName ?? (source.sourceProvider === "github" ? repoForDetect.replace(/\.git$/, "") : null),
    enabled: workloadKind === "web" && servers.length > 0 && Boolean(serverId) && nameOk && portOk,
  });
  const blocking = check.status === "ok" ? check.conflicts.filter((c) => c.blocking) : [];

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (!createdRef.current) {
        const created = await api<{ project: { id: string; slug: string } }>("/api/projects", {
          body: {
            serverId,
            name,
            slug: name,
            repoUrl: source.repoUrl,
            repoFullName: source.repoFullName,
            installationId: source.installationId,
            sourceProvider: source.sourceProvider,
            providerConnectionId: source.providerConnectionId,
            productionBranch: branch,
            rootDir: rootDir || ".",
            runtime,
            workloadKind,
            deploymentMode,
            ...containerDeploymentBody(deploymentMode, workloadKind, container),
            startCommand: startCommand.trim() || null,
            installCommand: installCommand.trim() || null,
            buildCommand: buildCommand.trim() || null,
            outputDir: runtime === "static" ? outputDir.trim() || null : null,
            listenPort: workloadKind === "worker" ? (port.trim() === "" ? null : Number(port)) : Number(port),
            autoDeploy: source.sourceProvider === "github" && source.installationId !== null && !adopted,
            // The server turns automatic deploys off for an adopted project.
            adopted,
          },
        });
        createdRef.current = created.project;
      }
      const project = createdRef.current;
      // Only names the user gave a value become variables, through the normal env path.
      for (const e of envRows) {
        const value = envValues[e.name] ?? "";
        if (!value) continue;
        try {
          await api(`/api/projects/${project.id}/env`, { body: { key: e.name, value, target: "all" } });
        } catch (err) {
          throw new Error(
            `The project was created, but ${e.name} was not saved: ${err instanceof Error ? err.message : "error"}. Press Deploy to try again.`
          );
        }
      }
      const dep = await api<{ deployment: { id: string } }>(
        `/api/projects/${project.id}/deploy`,
        { body: {} }
      );
      router.push(`/projects/${project.slug}/deployments/${dep.deployment.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  if (servers.length === 0) {
    return (
      <div className="motion-enter mx-auto w-full max-w-[600px]">
        <EmptyState
          icon={<HardDrivesIcon />}
          title="Connect a server first"
          description="Projects are deployed to a Nest container."
          action={<Button render={<Link href="/connect" />}>Connect a server</Button>}
        />
      </div>
    );
  }

  return (
    <section
      aria-labelledby="new-heading"
      className="motion-enter mx-auto w-full max-w-[600px] rounded-lg bg-card p-5 shadow-border-small"
    >
      <h1
        id="new-heading"
        ref={headingRef}
        tabIndex={-1}
        className="text-title-2 focus:outline-none focus-visible:outline-none"
      >
        New project
      </h1>

      <div className="mt-5 rounded-md bg-[var(--ds-gray-100)] px-3 py-2.5">
        <p className="text-caption font-normal text-muted-foreground">Importing from {providerLabel(source.sourceProvider)}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex min-w-0 items-center gap-1.5 font-medium">
            {source.sourceProvider === "github" ? <GithubLogoIcon aria-hidden="true" className="size-4 shrink-0" /> : <GitBranchIcon aria-hidden="true" className="size-4 shrink-0" />}
            <span className="truncate">
              {source.repoFullName ?? source.repoUrl.replace("https://github.com/", "")}
            </span>
          </span>
        </p>
      </div>

      <div role="status" aria-live="polite" className="empty:hidden">
        {detected.status === "loading" ? (
          <p className="mt-5 text-label text-muted-foreground">Looking at the repository…</p>
        ) : detected.status === "error" ? (
          <p className="mt-5 text-label text-muted-foreground">
            {detected.message} You can still set everything by hand.
          </p>
        ) : null}
      </div>
      {detection ? (
        <>
          <DetectedSummary detection={detection} onUse={applyDetected} onPickRoot={setRootDir} />
          <DetectionWarnings warnings={detection.warnings} />
        </>
      ) : null}

      <div data-tour="project-settings" className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="np-server">Nest server</Label>
          <NativeSelect id="np-server" value={serverId} onChange={(e) => setServerId(e.target.value)}>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nestUsername}.hackclub.app
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="np-name">Project name</Label>
          <Input
            id="np-name"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            aria-invalid={!nameOk}
            aria-describedby={nameOk ? undefined : "np-name-error"}
            autoComplete="off"
            spellCheck={false}
          />
          {!nameOk ? (
            <p id="np-name-error" className="mt-1.5 text-label text-destructive">
              Use lowercase letters, numbers and hyphens.
            </p>
          ) : null}
        </div>
        <HostingOptions prefix="np" workloadKind={workloadKind} deploymentMode={deploymentMode} capabilities={capabilities} onWorkloadChange={(value) => { workloadTouched.current = true; setWorkloadKind(value); if (value === "worker" && runtime === "static") setRuntime("node"); }} onModeChange={setDeploymentMode} />
        {capabilityError && <p role="status" className="text-label text-muted-foreground sm:col-span-2">Could not check target capabilities: {capabilityError} Container deployment modes remain unavailable.</p>}
        <ContainerDeploymentFields prefix="np" mode={deploymentMode} workloadKind={workloadKind} value={container} onChange={setContainer} />
        {containerError && <p role="alert" className="text-label text-destructive sm:col-span-2">{containerError}</p>}
        <div>
          <Label htmlFor="np-runtime">Application preset</Label>
          <NativeSelect
            id="np-runtime"
            value={runtime}
            onChange={(e) => { const next = e.target.value as typeof runtime; setRuntime(next); setWorkloadKind(workloadForRuntime(next, workloadKind)); }}
          >
            {RUNTIMES.map((r) => (
              <option key={r.value} value={r.value} disabled={capabilities ? !capabilities.runtimes.includes(r.value) : false}>
                {r.label}{capabilities && !capabilities.runtimes.includes(r.value) ? " · unavailable" : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="np-branch">Production branch</Label>
          <Input id="np-branch" value={branch} onChange={(e) => setBranch(e.target.value)} className="font-mono" />
        </div>
        <div>
          <Label htmlFor="np-root">Root directory</Label>
          <Input id="np-root" value={rootDir} onChange={(e) => setRootDir(e.target.value)} className="font-mono" />
        </div>
        <div>
          <Label htmlFor="np-port">{workloadKind === "worker" ? "Listen port (optional)" : "Port your app listens on"}</Label>
          <Input id="np-port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} className="font-mono" />
          {workloadKind === "worker" && <p className="text-label text-muted-foreground">Only for bots that must receive webhooks over HTTP. Leave it empty for a closed background app.</p>}
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="np-install">Install command (optional)</Label>
          <Input id="np-install" value={installCommand} onChange={(e) => setInstallCommand(e.target.value)} placeholder="Leave empty to use the runtime preset" className="font-mono" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="np-start">Start command (optional)</Label>
          <Input id="np-start" value={startCommand} onChange={(e) => setStartCommand(e.target.value)} placeholder={hint} className="font-mono" aria-describedby="np-start-help" />
          <StartCommandHelp runtime={runtime} id="np-start-help" />
        </div>
        <div className={runtime === "static" ? "" : "sm:col-span-2"}>
          <Label htmlFor="np-build">Build command (optional)</Label>
          <Input id="np-build" value={buildCommand} onChange={(e) => setBuildCommand(e.target.value)} placeholder="Leave empty to use the runtime preset" className="font-mono" />
        </div>
        {runtime === "static" ? (
          <div>
            <Label htmlFor="np-out">Output directory</Label>
            <Input id="np-out" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="dist" className="font-mono" />
          </div>
        ) : null}
      </div>

      {detection ? (
        <EnvValueFields
          env={envRows}
          values={envValues}
          onChange={(name, value) => setEnvValues((v) => ({ ...v, [name]: value }))}
        />
      ) : null}

      <div className="mt-5">
        <label
          htmlFor="np-adopt"
          className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md bg-[var(--ds-gray-100)] px-3 py-2.5"
        >
          <input
            id="np-adopt"
            type="checkbox"
            className="mt-1 size-4 shrink-0"
            checked={adopted}
            onChange={(e) => setAdopted(e.target.checked)}
            aria-describedby="np-adopt-note"
          />
          <span className="min-w-0">
            <span className="block font-medium">Start with automatic deploys off</span>
            <span className="block text-label text-muted-foreground">
              For a repository you already run here by hand. Egg does not take over or stop that copy.
            </span>
          </span>
        </label>
        <p id="np-adopt-note" className="mt-1.5 text-label text-muted-foreground">
          {adopted
            ? "The first deploy is manual, and automatic deploys start only after you confirm that first deploy works. Egg changes nothing it did not create, so stop your old process yourself if it holds the port."
            : source.sourceProvider === "github" && source.installationId !== null
              ? "Tick this if you already run this repository here by hand. Otherwise automatic deploys stay on."
              : "Tick this if you already run this repository here by hand. This source uses manual deployments or a deploy hook; automatic push deployments are off."}
        </p>
      </div>

      <div className="mt-5">
        <div role="status" aria-live="polite" className="empty:hidden">
          {check.status === "checking" ? (
            <p className="text-label text-muted-foreground">Checking this container…</p>
          ) : check.status === "error" ? (
            <p className="text-label text-muted-foreground">
              Could not check this container just now: {check.message.replace(/\.$/, "")}. The deploy
              checks again before it changes anything.
            </p>
          ) : null}
        </div>
        {check.status === "ok" ? (
          <div data-tour={check.conflicts.length > 0 ? "container-conflicts" : undefined}>
            <ProjectConflicts conflicts={check.conflicts} className="mt-3" />
          </div>
        ) : null}
        {blocking.length > 0 ? (
          <Alert tone="error" role="alert" className="mt-3">
            <p id="np-blocked">
              Deploy is turned off because {blocking.length === 1 ? "one thing" : `${blocking.length} things`} on
              this container {blocking.length === 1 ? "is" : "are"} in the way. Egg will not stop or
              change {blocking.length === 1 ? "it" : "them"} for you. Fix {blocking.length === 1 ? "it" : "them"}{" "}
              on your container, or change the project name, server or port.
            </p>
            <p className="mt-1.5">
              <Link href="/container" target="_blank" rel="noopener" className="touch-target link inline-flex min-h-10 items-center">
                Open container status<span className="sr-only"> (opens in a new tab)</span>
              </Link>
            </p>
          </Alert>
        ) : null}
      </div>

      <p className="mt-4 text-label text-muted-foreground">Environment variables can be added in the project settings.</p>

      {error ? (
        <Alert tone="error" role="alert" className="mt-4">
          {error}
        </Alert>
      ) : null}

      <Button
        data-tour="deploy"
        className="mt-5 h-10 w-full"
        onClick={() => void submit()}
        loading={busy}
        disabled={!nameOk || !serverId || ((workloadKind === "web" || port.trim() !== "") && !portOk) || !modeReady || !runtimeReady || Boolean(containerError) || blocking.length > 0}
        aria-describedby={blocking.length > 0 ? "np-blocked" : undefined}
      >
        {busy ? "Starting deployment…" : "Deploy"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={onBack}
        className="mt-2 h-10 w-full text-label text-muted-foreground hover:text-foreground"
      >
        Import a different Git repository
      </Button>
    </section>
  );
}

/** Five rows the size of the real ones, so the list does not jump when it arrives. */
function RepoSkeleton() {
  return (
    <LoadingRegion label="Loading repositories…">
      <SkeletonCard>
        <div className="hairline-y">
          {Array.from({ length: 5 }, (_, i) => (
            <SkeletonRow key={i}>
              <SkeletonCircle size={20} />
              <SkeletonText size="body" width={skeletonWidth(i)} className="min-w-0 flex-1" />
              <Skeleton className="h-8 w-20 max-sm:h-10" />
            </SkeletonRow>
          ))}
        </div>
      </SkeletonCard>
    </LoadingRegion>
  );
}

function GithubRepos({
  installationId,
  query,
  onPick,
}: {
  installationId: number;
  query: string;
  onPick: (repo: Repo) => void;
}) {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ repos: Repo[] }>(`/api/github/repos?installation=${installationId}`)
      .then((r) => {
        if (!cancelled) setRepos(r.repos);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load repositories");
      });
    return () => {
      cancelled = true;
    };
  }, [installationId]);

  if (error) {
    return (
      <Alert tone="error" role="alert">
        {error}
      </Alert>
    );
  }
  if (!repos) return <RepoSkeleton />;

  const q = query.trim().toLowerCase();
  const list = q ? repos.filter((r) => r.fullName.toLowerCase().includes(q)) : repos;

  if (list.length === 0) {
    return (
      <div className="rounded-lg bg-card px-4 shadow-border-small">
        <EmptyState
          size="compact"
          icon={<GithubLogoIcon />}
          title={
            repos.length === 0
              ? "No repositories shared with the app yet."
              : `No repositories match “${query}”.`
          }
        />
      </div>
    );
  }

  return (
    <ul className="hairline-y overflow-hidden rounded-lg bg-card shadow-border-small">
      {list.map((r) => (
        <li
          key={r.id}
          className="flex min-h-12 items-center justify-between gap-3 px-4 py-3 transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)]"
        >
          <p className="flex min-w-0 items-center gap-3">
            <GithubLogoIcon aria-hidden="true" className="size-5 shrink-0" />
            <span className="truncate font-medium tracking-[-0.02em]">{r.fullName}</span>
            {r.private ? (
              <Badge variant="outline" className="text-muted-foreground">
                Private
              </Badge>
            ) : null}
          </p>
          <Button size="sm" onClick={() => onPick(r)} className="px-3">
            Import
            <span className="sr-only"> {r.fullName}</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function NewProjectFlow({
  servers,
  github,
  defaultBranch = "main",
}: {
  servers: Server[];
  github: GithubState;
  /** From Settings > Deploys: the production branch pre-filled for a repository URL. */
  defaultBranch?: string;
}) {
  const [source, setSource] = useState<Source | null>(null);
  const [installation, setInstallation] = useState<number | null>(github.installations[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [provider, setProvider] = useState<SourceProvider>("github");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [returned, setReturned] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Coming back from the configure step: focus the title, not the void.
  useEffect(() => {
    if (!source && returned) headingRef.current?.focus({ preventScroll: true });
  }, [source, returned]);

  if (source) {
    return (
      <Configure
        source={source}
        servers={servers}
        onBack={() => {
          setReturned(true);
          setSource(null);
        }}
      />
    );
  }

  function useUrl(e: React.FormEvent) {
    e.preventDefault();
    let normalized: string;
    try { normalized = repositoryUrl(provider, url); } catch (e) {
      setUrlError(e instanceof Error ? e.message : "Enter a repository URL.");
      return;
    }
    setUrlError(null);
    setSource({
      repoUrl: normalized,
      repoFullName: provider === "github" ? null : new URL(normalized).pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, ""),
      installationId: null,
      branch: defaultBranch,
      sourceProvider: provider,
      providerConnectionId: null,
    });
  }

  const hasInstall = github.configured && github.installations.length > 0 && installation;

  return (
    <div className="motion-enter mx-auto w-full max-w-[720px]">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-[32px] leading-10 font-semibold tracking-[-0.03em] focus:outline-none focus-visible:outline-none"
      >
        Let&apos;s build something new
      </h1>
      <p className="mt-2 text-muted-foreground">
        Import a Git repository and it will be built and run on your Nest server.
      </p>

      {github.notice ? (
        <Alert tone="info" role="status" className="mt-4">
          {github.notice}
        </Alert>
      ) : null}

      <section aria-labelledby="import-heading" className="mt-8">
        <h2 id="import-heading" className="mb-3 text-title-2">
          Choose a repository
        </h2>

        <div className="mb-4"><Label htmlFor="source-provider">Git provider</Label><NativeSelect id="source-provider" value={provider} onChange={(e) => { setProvider(e.target.value as SourceProvider); setUrl(""); setUrlError(null); }}>
          {SOURCE_PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </NativeSelect></div>
        <p className="-mt-2 mb-4 text-label text-muted-foreground">Other Git servers import over public HTTPS, and deploys are by hand.</p>

        {provider !== "github" && provider !== "generic" ? <ProviderConnections key={provider} provider={provider} onPick={(r, connectionId) => setSource({ repoUrl: r.cloneUrl, repoFullName: r.fullName, installationId: null, branch: r.defaultBranch, sourceProvider: provider, providerConnectionId: connectionId })} /> : provider === "generic" ? <div className="rounded-lg bg-card p-5 shadow-border-small"><h3 className="font-medium">Use another Git server</h3><p className="mt-1 text-label text-muted-foreground">Public HTTPS repositories only. Credentials do not belong in the repository URL.</p></div> : hasInstall ? (
          <div data-tour="repo-source" data-tour-state="installed">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label htmlFor="gh-install" className="sr-only">
                GitHub account
              </label>
              <NativeSelect
                id="gh-install"
                value={installation}
                onChange={(e) => setInstallation(Number(e.target.value))}
                className="w-56 max-w-full max-sm:w-full"
              >
                {github.installations.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.account}
                  </option>
                ))}
              </NativeSelect>
              <div className="relative min-w-[200px] flex-1 max-sm:basis-full">
                <MagnifyingGlassIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  aria-label="Search repositories"
                  placeholder="Search repositories…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <GithubRepos
              key={installation}
              installationId={installation}
              query={query}
              onPick={(r) =>
                setSource({
                  repoUrl: `https://github.com/${r.fullName}`,
                  repoFullName: r.fullName,
                  installationId: installation,
                  branch: r.defaultBranch,
                  sourceProvider: "github",
                  providerConnectionId: null,
                })
              }
            />
            {github.installUrl ? (
              <p className="mt-3 text-label">
                <a
                  href={github.installUrl}
                  className="link inline-flex items-center text-muted-foreground max-sm:min-h-10"
                >
                  Add another account or repository
                </a>
              </p>
            ) : null}
          </div>
        ) : github.configured ? (
          <div
            data-tour="repo-source"
            data-tour-state="not-installed"
            className="rounded-lg bg-card p-5 shadow-border-small"
          >
            <p className="font-medium tracking-[-0.02em]">Connect GitHub</p>
            <p className="mt-1 text-muted-foreground">
              Install the Egg GitHub App to pick repositories, deploy private ones, and deploy on every push.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {github.installUrl ? (
                <Button className="px-3" render={<a href={github.installUrl} />}>
                  <GithubLogoIcon aria-hidden="true" />
                  Install the GitHub App
                </Button>
              ) : null}
              <Button variant="outline" className="px-3" render={<a href="/api/github/connect" />}>
                I already installed it
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg bg-card p-5 shadow-border-small">
            <p className="font-medium tracking-[-0.02em]">Connect GitHub</p>
            <p className="mt-1 text-muted-foreground">
              Connect GitHub to pick from your repositories and deploy on every push. Whoever runs this Egg finishes
              that setup (the GITHUB_APP settings), and it is not done here yet, so the repository picker is missing.
              Public repositories work below in the meantime.
            </p>
            <div className="mt-4">
              <Button variant="outline" className="px-3" render={<Link href="/docs/github" />}>
                How GitHub setup works
              </Button>
            </div>
          </div>
        )}

        <form
          onSubmit={useUrl}
          {...(github.configured ? {} : { "data-tour": "repo-source", "data-tour-state": "not-configured" })}
          className="mt-6 rounded-lg bg-card p-5 shadow-border-small"
        >
          <label htmlFor="repo-url" className="font-medium tracking-[-0.02em]">
            {provider === "github" && github.configured ? "Or use a public repository URL" : "Public repository URL"}
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Input
              id="repo-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={SOURCE_PROVIDERS.find((p) => p.value === provider)?.example}
              aria-invalid={Boolean(urlError)}
              aria-describedby={urlError ? "repo-url-error" : undefined}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 basis-[240px] font-mono"
            />
            <Button type="submit" className="px-3" disabled={!url.trim()}>
              <GitBranchIcon aria-hidden="true" />
              Continue
            </Button>
          </div>
          {urlError ? (
            <p id="repo-url-error" role="alert" className="mt-2 text-label text-destructive">
              {urlError}
            </p>
          ) : null}
          {provider === "github" && !github.configured ? (
            <p className="mt-2 text-label text-muted-foreground">
              Pushes do not deploy automatically: there is no GitHub App here to hear them.
            </p>
          ) : null}
          {provider !== "github" && <p className="mt-2 text-label text-muted-foreground">{provider === "generic" ? "A public URL connects no account: deploy by hand or set up a deploy hook." : "A public URL does not connect an account. Private repositories need a connection above; push deploys require a configured webhook."}</p>}
          {provider === "github" ? (
            <p className="mt-2 text-label text-muted-foreground">
              Deploying a Discord, Slack or Telegram bot? Egg sets it up as a background app with no port. The{" "}
              <Link href="/docs/bots-discordjs" className="link max-sm:min-h-10">
                docs
              </Link>{" "}
              have guides for Discord, Slack and Telegram.
            </p>
          ) : null}
        </form>
      </section>
    </div>
  );
}
