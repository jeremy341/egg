import { PULL_POLICIES, type PullPolicy } from "@/server/db/schema";

export { PULL_POLICIES, type PullPolicy };

export const PULL_POLICY_LABELS: Record<PullPolicy, string> = {
  auto: "Automatic: pull only when the image is not on the server",
  always: "Always pull: fetch the image on every deploy",
  cached: "Use cached: never pull; run the image already on the server",
};

/** The `docker run --pull=` value for each policy. */
export function pullFlagFor(policy: PullPolicy): "--pull=missing" | "--pull=always" | "--pull=never" {
  switch (policy) {
    case "auto":
      return "--pull=missing";
    case "always":
      return "--pull=always";
    case "cached":
      return "--pull=never";
  }
}
