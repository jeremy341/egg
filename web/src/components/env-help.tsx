import type { ReactNode } from "react";

/** Matches the env_vars.target enum in server/db/schema.ts. */
export type EnvTarget = "all" | "production" | "preview";

export const ENV_TARGET_LABEL: Record<EnvTarget, string> = {
  all: "Both",
  production: "Production",
  preview: "Preview",
};

/**
 * Plain facts about environment variables, shown under the form.
 * Each line is backed by code: setEnvVar only writes the database (server/projects.ts),
 * the variables file env/<release id>.env is written during a deploy (server/deploy/pipeline.ts), and a rollback
 * switches the current.env link back to the target release's own file (remote.ts activateProduction).
 */
export function EnvHelp(): ReactNode {
  return (
    <ul className="mt-4 space-y-1.5 text-sm text-muted-foreground">
      <li>
        Applies to: Both means production and preview. A value for one environment wins over a Both value with the same name.
      </li>
      <li>Saving does not change the running app. Deploy again to send new values to your server.</li>
      <li>Rolling back restores the values that release was deployed with, not your current values.</li>
    </ul>
  );
}
