/** Plain-language labels for the per-project statistics switches. Shared by the settings card and tests. */
export const STATISTIC_COPY = {
  deployCount: {
    title: "Deploy count",
    sentence: "How many deployments ran each day. Counts production and preview deployments.",
  },
  deploySuccess: {
    title: "Deploy success rate",
    sentence: "The share of deployments that went live, over the last 30 days.",
  },
  buildTime: {
    title: "Build time",
    sentence: "How long the build step took for each deployment, from the deployment records.",
  },
  visitors: {
    title: "Visitors",
    sentence: "Visitor counts from analytics. Needs analytics turned on for this project.",
  },
} as const;

export const STATISTIC_ORDER = ["deployCount", "deploySuccess", "buildTime", "visitors"] as const;
