"use client";

import { Label } from "@/components/settings-ui";
import { NativeSelect } from "@/components/ui/native-select";
import type { Runtime } from "@/server/db/schema";

export const RUNTIME_OPTIONS = [
  { value: "node", label: "Node.js", hint: "npm start" },
  { value: "bun", label: "Bun", hint: "bun run start" },
  { value: "python", label: "Python", hint: ".venv/bin/python app.py" },
  { value: "go", label: "Go", hint: "./app" },
  { value: "rust", label: "Rust", hint: "./target/release/app" },
  { value: "ruby", label: "Ruby", hint: "bundle exec ruby app.rb" },
  { value: "php", label: "PHP", hint: "php -S 0.0.0.0:$PORT -t public" },
  { value: "java", label: "Java", hint: "java -jar app.jar" },
  { value: "static", label: "Static site", hint: "served for you" },
  { value: "command", label: "Custom command", hint: "./my-binary" },
] as const;

export const runtimeLabel = (runtime: string) => RUNTIME_OPTIONS.find((r) => r.value === runtime)?.label ?? runtime;
export const runtimeHint = (runtime: string) => RUNTIME_OPTIONS.find((r) => r.value === runtime)?.hint ?? "";
export type WorkloadKind = "web" | "worker";
export const workloadForRuntime = (runtime: string, chosen: WorkloadKind): WorkloadKind => runtime === "static" ? "web" : chosen;
export type DeploymentMode = "native" | "dockerfile" | "compose";
export type TargetCapabilities = {
  deploymentModes: Record<DeploymentMode, boolean>;
  docker: { available: boolean; composeAvailable: boolean; reason: string | null };
  runtimes: (Runtime | string)[];
};

/** Shared by creation and settings so readiness never implies an HTTP port for workers. */
export function HostingOptions({ prefix, workloadKind, deploymentMode, capabilities, workloadLocked = false, onWorkloadChange, onModeChange }: {
  prefix: string;
  workloadKind: WorkloadKind;
  deploymentMode: DeploymentMode;
  capabilities: TargetCapabilities | null;
  workloadLocked?: boolean;
  onWorkloadChange: (value: WorkloadKind) => void;
  onModeChange: (value: DeploymentMode) => void;
}) {
  const reason = capabilities?.docker.reason ?? "Docker target support has not been verified. Test the server connection before choosing a container mode.";
  return (
    <>
      <div>
        <Label htmlFor={`${prefix}-workload`}>Workload</Label>
        <NativeSelect id={`${prefix}-workload`} disabled={workloadLocked} value={workloadKind} onChange={(e) => onWorkloadChange(e.target.value as WorkloadKind)} aria-describedby={`${prefix}-workload-help`}>
          <option value="web">Web service</option>
          <option value="worker">Bot or background worker</option>
        </NativeSelect>
      </div>
      <div>
        <Label htmlFor={`${prefix}-mode`}>Deployment mode</Label>
        <NativeSelect id={`${prefix}-mode`} value={deploymentMode} onChange={(e) => onModeChange(e.target.value as DeploymentMode)} aria-describedby={`${prefix}-mode-help`}>
          <option value="native" disabled={capabilities?.deploymentModes.native === false}>Native process · systemd</option>
          <option value="dockerfile" disabled={!capabilities?.deploymentModes.dockerfile}>Dockerfile{!capabilities?.deploymentModes.dockerfile ? " · unavailable" : ""}</option>
          <option value="compose" disabled={!capabilities?.deploymentModes.compose}>Docker Compose{!capabilities?.deploymentModes.compose ? " · unavailable" : ""}</option>
        </NativeSelect>
      </div>
      <div className="space-y-2 text-label text-muted-foreground sm:col-span-2">
        <p id={`${prefix}-workload-help`}>
          {workloadLocked && <span className="mb-1 block">Create a separate project to change between a web service and a worker.</span>}
          {workloadKind === "worker"
            ? "For bots and background apps, such as a Discord bot, a Slack app or a queue worker. No HTTP health check: Egg keeps the process running under systemd and checks that it stays up. A bot that must receive webhooks can open one optional listen port."
            : "Your service must listen on PORT at 0.0.0.0. Egg checks HTTP health before routing traffic."}
          {" "}Scheduled jobs use the existing Scheduled Jobs section in project settings.
        </p>
        <p id={`${prefix}-mode-help`}>
          {deploymentMode === "native" ? "systemd manages startup, logs and restarts. Install and build commands run on your Nest container with its configured memory and CPU limits." : "Container builds require a working target Docker engine, resource limits, disk capacity and verified port mapping. Persistent data needs explicit volumes."}
          {(!capabilities?.deploymentModes.dockerfile || !capabilities?.deploymentModes.compose) && <span className="mt-1 block">{reason}</span>}
        </p>
      </div>
    </>
  );
}

export function StartCommandHelp({ runtime, id }: { runtime: string; id: string }) {
  return <p id={id} className="mt-1.5 text-label text-muted-foreground">
    {runtime === "node" ? <>Optional PM2: add it as a project dependency and use <code className="font-mono">pm2-runtime ecosystem.config.js</code> as the start command. Keep it in the foreground; systemd remains the service manager.</> : "Keep the process in the foreground so systemd can track its exit, logs and restarts. Install the required runtime on your target before deploying."}
  </p>;
}
