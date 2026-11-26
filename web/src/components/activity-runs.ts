import type { ActivityKind } from "@/server/activity";

export type RunEntry<T> =
  | { type: "item"; item: T }
  | { type: "run"; kind: ActivityKind; items: T[] };

/** A run shorter than this stays as plain rows. */
export const MIN_RUN = 3;

/**
 * Folds neighbouring entries of the same kind into one run. Order and
 * membership are untouched, so every entry stays reachable inside its run.
 */
export function groupRuns<T extends { kind: ActivityKind }>(items: T[], min = MIN_RUN): RunEntry<T>[] {
  const out: RunEntry<T>[] = [];
  let i = 0;
  while (i < items.length) {
    let j = i + 1;
    while (j < items.length && items[j].kind === items[i].kind) j++;
    if (j - i >= min) {
      out.push({ type: "run", kind: items[i].kind, items: items.slice(i, j) });
    } else {
      for (const item of items.slice(i, j)) out.push({ type: "item", item });
    }
    i = j;
  }
  return out;
}

const NOUNS: Record<ActivityKind, string> = {
  projects: "project changes",
  deployments: "deployment events",
  domains: "domain changes",
  servers: "server changes",
  access: "token and access changes",
  monitoring: "monitoring changes",
  terminal: "terminal and file events",
  other: "other events",
};

/** "4 token and access changes". */
export function runLabel(kind: ActivityKind, count: number): string {
  return `${count} ${NOUNS[kind]}`;
}
