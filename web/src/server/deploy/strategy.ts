import { DEPLOY_STRATEGIES, type DeployStrategy } from "@/server/db/schema";

export { DEPLOY_STRATEGIES, type DeployStrategy };

export const DEPLOY_STRATEGY_LABELS: Record<DeployStrategy, string> = {
  rolling: "Rolling: start the new copy, then stop the old one",
  recreate: "Recreate: stop the old copy, then start the new one",
  blue_green: "Blue/green: run the new copy beside the old one, then switch",
};

/**
 * Why an app cannot use this strategy, or null when it can. An app with a volume must use
 * "recreate": two copies must never mount the same volume at once. This is the one rule the
 * save path and the deploy path both apply, so they agree.
 */
export function strategyRefusal(input: { strategy: DeployStrategy; hasVolume: boolean }): string | null {
  if (input.hasVolume && input.strategy !== "recreate") {
    return "This app mounts a volume, so it must use the recreate strategy. Rolling and blue/green would run two copies at once, and both would need the same volume.";
  }
  return null;
}
