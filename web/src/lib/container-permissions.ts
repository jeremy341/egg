/**
 * Pure helpers for the per-server container permissions: the switch names,
 * their plain-language descriptions, the defaults, and the typed confirmation
 * for turning the terminal or file changes on. No server or browser code, so it is safe to
 * import anywhere and easy to test.
 *
 * The server enforces these switches. The UI only hides or disables what is
 * off, and says so.
 */

export type ContainerPermissions = {
  terminal: boolean;
  fileWrites: boolean;
  orphanRemoval: boolean;
};

export type PermissionKey = keyof ContainerPermissions;

/** Order the switches are shown in. */
export const PERMISSION_KEYS: readonly PermissionKey[] = ["terminal", "fileWrites", "orphanRemoval"];

/**
 * Every switch starts off. The terminal is a root shell, a file change can change
 * the code the app runs on its next restart, and leftover removal deletes
 * services and folders. Servers connected before this default kept the value
 * they already had; only servers connected from now on start with all three off.
 * Anything unreadable falls back to off too, never to on.
 */
export const DEFAULT_PERMISSIONS: Readonly<ContainerPermissions> = {
  terminal: false,
  fileWrites: false,
  orphanRemoval: false,
};

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  terminal: "Terminal",
  fileWrites: "File changes",
  orphanRemoval: "Removing leftovers",
};

/**
 * What each switch can do, written for someone who already has apps running on
 * the container: say what is reached, and what is not.
 */
export const PERMISSION_DESCRIPTIONS: Record<PermissionKey, string> = {
  terminal:
    "A shell on your container, running as root. Off by default. Anything you type runs for real, so it can stop or change any app on the container, including apps Nest Deploy did not deploy. Anyone with access to your Nest Deploy account can use it while it is on.",
  fileWrites:
    "Create, edit, rename, delete and upload files in each project's shared/ folder only. Nothing else on the container is written to, and the live release (current/) is always read only. Off by default, because a file change can change the code your app runs the next time it restarts, which makes this close to terminal access.",
  orphanRemoval:
    "Stop and remove services whose names start with nd- and folders inside ~/.nest-deploy that no project uses any more. Off by default. Anything outside those names is never touched, but a service or folder you made yourself with a matching name would look like a leftover, so each removal asks you to confirm.",
};

/** The paragraph under the Account section heading. */
export const SECTION_INTRO =
  "Choose which features can reach each of your containers. A feature that is off is blocked by Nest Deploy itself, not only hidden from the page. The terminal, file changes and removing leftovers are off until you turn them on. File changes were turned off for all servers once, in an update; after that, each switch keeps the value you set. Turning the terminal or file changes on asks you to sign in with Hack Club again first. Turning a switch on or off never restarts an app, and never touches anything Nest Deploy did not create.";

/** Words for the visible state next to a switch (never colour alone). */
export const PERMISSION_STATE: Record<"on" | "off", string> = { on: "On", off: "Off" };

/** Shown where a feature is off. */
export const OFF_MESSAGES: Record<PermissionKey, string> = {
  terminal: "The terminal is turned off for this server.",
  fileWrites: "File changes are turned off for this server.",
  orphanRemoval: "Removing leftovers is turned off for this server.",
};

/** The words in the confirmation dialog for turning one of those switches on. */
export type EnableCopy = { title: string; description: (serverLabel: string) => string; button: string };

export const ENABLE_COPY: Record<"terminal" | "fileWrites", EnableCopy> = {
  terminal: {
    title: "Turn on the terminal?",
    description: (serverLabel) =>
      `This opens a shell on ${serverLabel} that runs as root. Anyone who can sign in to your Nest Deploy account can use it while it is on. You can turn it off again here at any time.`,
    button: "Turn on terminal",
  },
  fileWrites: {
    title: "Turn on file changes?",
    description: (serverLabel) =>
      `This lets Nest Deploy create, edit, rename, delete and upload files in the shared/ folder of each project on ${serverLabel}. A file change can change the code your app runs the next time it restarts, so treat this like terminal access. The live release (current/) stays read only. Anyone who can sign in to your Nest Deploy account can change files while this is on. You can turn it off again here at any time.`,
    button: "Turn on file changes",
  },
};

/** The switches that need a fresh Hack Club sign-in before they turn on. */
export type FreshSignInKey = keyof typeof ENABLE_COPY;

export function needsFreshSignIn(key: PermissionKey): key is FreshSignInKey {
  return Object.hasOwn(ENABLE_COPY, key);
}

/** Shown in the file manager inside current/, whatever the switch says. */
export const LIVE_RELEASE_NOTICE = {
  title: "current/ is the live release and is read only.",
  body: "Changing it here would change the code your app runs. Make code changes in your repository and deploy. Files that must last, like data or settings, belong in shared/.",
} as const;

/** Where the switches live. The id is the heading of the Account section. */
export const PERMISSIONS_HREF = "/account#container-permissions-heading";

/**
 * Turn whatever came back (a row, a JSON body, nothing) into a full set of
 * switches. Anything that is not a real boolean falls back to the default, so
 * a failed or partial read never turns the terminal on.
 */
export function normalizePermissions(raw: unknown): ContainerPermissions {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = (key: PermissionKey): boolean =>
    typeof src[key] === "boolean" ? (src[key] as boolean) : DEFAULT_PERMISSIONS[key];
  return { terminal: pick("terminal"), fileWrites: pick("fileWrites"), orphanRemoval: pick("orphanRemoval") };
}

/** Run a loader and return its permissions, or the defaults if it throws. */
export async function permissionsOrDefault(load: () => Promise<unknown>): Promise<ContainerPermissions> {
  try {
    return normalizePermissions(await load());
  } catch {
    return { ...DEFAULT_PERMISSIONS };
  }
}

export type TypedConfirm = {
  /** What the person has to type (the server's Nest username). */
  expected: string;
  /**
   * True when `typed` is the expected text. Exact match only: the case must be
   * the same and nothing may be added or missing. The only leniency is spaces,
   * tabs or line breaks at the very start and end of what was typed.
   */
  matches: (typed: string) => boolean;
};

/**
 * The typed confirmation for turning the terminal or file changes on for one
 * server. This is a guard in the UI only; the API accepts the owner's request
 * without it, and turning a switch off never asks.
 */
export function typedConfirmFor(serverName: string): TypedConfirm {
  const expected = serverName.trim();
  return {
    expected,
    // An empty name must never be satisfied by an empty field.
    matches: (typed) => expected.length > 0 && typed.trim() === expected,
  };
}
