import { envForDeployment } from "@/server/deploy/pipeline";

/**
 * The variables a GitHub build is given: the same ones a deploy of that environment would run with
 * (names Egg reserves are left out). The values are never written to a log.
 */
export function readBuildEnv(projectId: string, env: "production" | "preview"): Promise<Record<string, string>> {
  return envForDeployment(projectId, env);
}
