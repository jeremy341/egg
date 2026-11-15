/**
 * What is remembered about the guided first-project tour, and the facts it is worked out from.
 * Plain types and small pure functions, so the server, the browser and the tests share them.
 * See docs/design/onboarding-tour-plan.md.
 *
 * Only a mark per chapter is stored. Where a person is in a chapter is never stored: it is
 * worked out from the facts, so it cannot disagree with what really exists.
 */

/** The four chapters, in the order a person meets them. */
export const CHAPTERS = ["connect", "import", "deploy", "address"] as const;
export type Chapter = (typeof CHAPTERS)[number];

/**
 * done: the chapter's goal was reached, or the person finished it.
 * skipped: the person closed it. It does not start again by itself.
 * paused: it could not finish (a failed build). A later success can finish it.
 */
export const MARK_STATUSES = ["done", "skipped", "paused"] as const;
export type MarkStatus = (typeof MARK_STATUSES)[number];

export type Marks = Partial<Record<Chapter, MarkStatus>>;

export function isChapter(value: unknown): value is Chapter {
  return typeof value === "string" && (CHAPTERS as readonly string[]).includes(value);
}

export function isMarkStatus(value: unknown): value is MarkStatus {
  return typeof value === "string" && (MARK_STATUSES as readonly string[]).includes(value);
}

/**
 * Read the stored text (or an already parsed value). Anything that is not a known chapter with a
 * known status is dropped, so damaged or old data never breaks the page.
 */
export function parseMarks(raw: unknown): Marks {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Marks = {};
  for (const chapter of CHAPTERS) {
    const status = (value as Record<string, unknown>)[chapter];
    if (isMarkStatus(status)) out[chapter] = status;
  }
  return out;
}

/** What the tour needs to know about the person's account to decide what to show. */
export type OnboardingFacts = {
  /** One entry per connected or pending server, with the same status words the app uses. */
  servers: { status: string }[];
  projectCount: number;
  /** The person's oldest project, or null when they have none. */
  firstProject: { slug: string } | null;
  /** The newest deployment of that project, or null. `state` uses the deployment state words. */
  firstDeployment: { state: string } | null;
  /** True when any of the person's domains shows as active. */
  hasActiveDomain: boolean;
};
