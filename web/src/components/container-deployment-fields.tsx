"use client";

import { Label } from "@/components/settings-ui";
import { Input } from "@/components/ui/input";
import type { DeploymentMode, WorkloadKind } from "@/components/hosting-options";

export type ContainerForm = { dockerfilePath: string; containerPort: string; composeFilePath: string; composeService: string };
export const defaultContainerForm: ContainerForm = { dockerfilePath: "Dockerfile", containerPort: "3000", composeFilePath: "compose.yaml", composeService: "app" };

export function containerDeploymentBody(mode: DeploymentMode, workloadKind: WorkloadKind, value: ContainerForm) {
  if (mode === "native") return {};
  return mode === "dockerfile"
    ? { dockerfilePath: value.dockerfilePath.trim(), containerPort: Number(value.containerPort) }
    : { composeFilePath: value.composeFilePath.trim(), composeService: value.composeService.trim(), containerPort: Number(value.containerPort) };
}

export function containerConfigurationError(mode: DeploymentMode, workloadKind: WorkloadKind, value: ContainerForm): string | null {
  if (mode === "native") return null;
  const file = (mode === "dockerfile" ? value.dockerfilePath : value.composeFilePath).trim();
  if (!file || file.startsWith("/") || file.includes("\\") || file.split("/").includes("..")) return "Use a relative file path inside the project root directory.";
  if (mode === "compose" && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value.composeService.trim())) return "Choose the Compose service that Egg should start and monitor.";
  const port = Number(value.containerPort);
  if (!value.containerPort.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
    return workloadKind === "web"
      ? "The internal container port must be a whole number from 1 to 65535."
      : "Give the port the app listens on inside the container. A worker without one is checked as a process instead of over HTTP.";
  }
  return null;
}

export function ContainerDeploymentFields({ prefix, mode, workloadKind, value, onChange }: {
  prefix: string; mode: DeploymentMode; workloadKind: WorkloadKind; value: ContainerForm; onChange: (value: ContainerForm) => void;
}) {
  if (mode === "native") return null;
  return <div className="grid gap-4 rounded-md bg-background-subtle p-3 sm:col-span-2 sm:grid-cols-2">
    <div className={mode === "dockerfile" ? "sm:col-span-2" : ""}>
      <Label htmlFor={`${prefix}-${mode === "dockerfile" ? "dockerfile" : "compose-file"}`}>{mode === "dockerfile" ? "Dockerfile path" : "Compose file path"}</Label>
      <Input id={`${prefix}-${mode === "dockerfile" ? "dockerfile" : "compose-file"}`} value={mode === "dockerfile" ? value.dockerfilePath : value.composeFilePath} required spellCheck={false} autoComplete="off" className="font-mono" onChange={(e) => onChange({ ...value, [mode === "dockerfile" ? "dockerfilePath" : "composeFilePath"]: e.target.value })} />
    </div>
    {mode === "compose" && <div><Label htmlFor={`${prefix}-compose-service`}>Compose service</Label><Input id={`${prefix}-compose-service`} value={value.composeService} required spellCheck={false} autoComplete="off" className="font-mono" onChange={(e) => onChange({ ...value, composeService: e.target.value })} /></div>}
    <div><Label htmlFor={`${prefix}-container-port`}>Port inside the container</Label><Input id={`${prefix}-container-port`} value={value.containerPort} required inputMode="numeric" className="font-mono" onChange={(e) => onChange({ ...value, containerPort: e.target.value })} /></div>
    <p className="text-label text-muted-foreground sm:col-span-2">File paths are relative to the project root. {workloadKind === "web" ? "Egg maps the public listen port to this internal port and checks the selected service before activation." : "Workers stay operational without a public port; readiness follows the selected process. A webhook bot can open one optional listen port in Settings."} Persistent data needs explicit volumes.</p>
  </div>;
}
