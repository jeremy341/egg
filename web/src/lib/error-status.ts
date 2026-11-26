/**
 * Status of an error group (a set of errors with the same fingerprint).
 * Pure, so the server, the routes and the browser agree on what each action does.
 */

export const ERROR_GROUP_STATUSES = ["open", "resolved", "ignored"] as const;
export type ErrorGroupStatus = (typeof ERROR_GROUP_STATUSES)[number];

export const ERROR_GROUP_ACTIONS = ["resolve", "reopen", "ignore", "assign"] as const;
export type ErrorGroupAction = (typeof ERROR_GROUP_ACTIONS)[number];

export function parseErrorGroupStatus(value: string | null | undefined): ErrorGroupStatus | "all" {
  return value === "open" || value === "resolved" || value === "ignored" ? value : "all";
}

/**
 * The status after an action, or null when the action does not apply to the
 * current status (for example, resolving a group that is already resolved).
 * `assign` never changes the status; it only changes who the group belongs to.
 *
 *   open     -> resolve -> resolved     open     -> ignore -> ignored
 *   resolved -> reopen  -> open         resolved -> ignore -> ignored
 *   ignored  -> reopen  -> open         ignored  -> resolve -> resolved
 */
export function nextErrorStatus(current: ErrorGroupStatus, action: ErrorGroupAction): ErrorGroupStatus | null {
  switch (action) {
    case "resolve":
      return current === "resolved" ? null : "resolved";
    case "reopen":
      return current === "open" ? null : "open";
    case "ignore":
      return current === "ignored" ? null : "ignored";
    case "assign":
      return current;
  }
}
