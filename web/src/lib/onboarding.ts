/**
 * The guided first-project tour: its copy, its page segments, and the rule that decides which
 * segment (if any) should run right now. Pure code with no React and no browser; the host
 * component and the tests both use it. See docs/design/onboarding-tour-plan.md.
 *
 * Nothing here remembers where a person is inside a chapter. The only stored thing is a mark per
 * chapter (see onboarding-marks.ts). Everything else is worked out from the facts, so the tour
 * cannot disagree with what really exists.
 */

import type { Chapter, Marks, OnboardingFacts } from "@/lib/onboarding-marks";

/* ------------------------------------------------------------------------------------------ */
/* Types                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export type TourSide = "top" | "right" | "bottom" | "left";

export type TourLink = { label: string; href: string };

/**
 * Things only the page being shown can know. The host reads them from the page (props, the
 * state of the form, the URL) and passes them in; nothing in the facts can tell them.
 */
export type Variant = {
  /**
   * Which way the "pick a repository" step reads (chapter 2):
   * installed: the GitHub App is installed, so the person picks from a list.
   * not-installed: the App is configured on this instance but not installed for this person.
   * not-configured: no GitHub App at all (local mode or a self-hosted instance): paste a URL.
   */
  github: "installed" | "not-installed" | "not-configured";
  /** The first connection asked the person to confirm the server's fingerprint. */
  hostKeyPending: boolean;
  /** The new-project page lists things already on the container. */
  conflicts: boolean;
  /** The deployment being shown failed. */
  deploymentFailed: boolean;
  /** Local mode (no Hack Club sign-in). No copy here mentions sign-in, so it needs no variant text. */
  localMode: boolean;
};

export type Context = {
  /** The current page path. A query string or hash is ignored. */
  path: string;
  facts: OnboardingFacts;
  marks: Marks;
  variant: Variant;
  /**
   * Set when the person asked to see a chapter again. It ignores the marks and the "already has
   * it" rules for that chapter only, and no other chapter is considered.
   */
  replay?: Chapter;
};

export type TourStep = {
  /** The `data-tour` name of the element to point at. No anchor means a centred step. */
  anchor?: string;
  title: string;
  /** Plain text. May hold the token `{port}`; see `fillTokens`. */
  body: string;
  /**
   * read: the person reads it and presses the primary button (default).
   * do: the person has to use the highlighted control. The target stays clickable, there is no
   * primary button, and the step moves on when the data changes (a key appears, a server is
   * connected, a project exists) and never on a click the tour did not see.
   */
  kind?: "read" | "do";
  /** Where the step leads: the primary button of a read step goes there, or the control of a do step opens it. */
  next?: string;
  /** Which side of the target the popover sits on, chosen so it never covers the target's own helper text. */
  side?: TourSide;
  /** A step for which this returns false is left out. Must be pure. */
  when?: (ctx: Context) => boolean;
  /** Label of the primary button of a read step. The host falls back to "Next". */
  button?: string;
  /** Label of the leave button when it is not "Skip tour" (only the welcome step). */
  skip?: string;
  link?: TourLink;
};

export type Segment = {
  id: string;
  chapter: Chapter;
  /** Matches the normalised page path (no query, no trailing slash). */
  path: RegExp;
  /** The same path in words, for readers and for error messages. */
  route: string;
  /** A segment-level condition on top of the chapter rules. Must be pure. Ignored on replay. */
  startsWhen?: (ctx: Context) => boolean;
  steps: TourStep[];
};

/* ------------------------------------------------------------------------------------------ */
/* Tokens                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/**
 * The copy holds one placeholder, `{port}` (chapter 3: "It listens on port {port}"). The context
 * has no port, because the port belongs to one project and the facts are about the account. So
 * it is a documented token the host fills in with `fillTokens(step.body, { port })`, using the
 * port of the deployment on screen. A token with no value is left as written so the gap is
 * visible in testing. The tests check that `{port}` is the only token anywhere in the copy.
 */
export function fillTokens(text: string, values: Record<string, string | number | undefined>): string {
  return text.replace(/\{([a-z]+)\}/g, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : String(value);
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Paths                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** Drop the query and the hash and a trailing slash, so `/connect/?x=1` is `/connect`. */
export function normalisePath(path: string): string {
  const bare = path.split("#")[0]!.split("?")[0]!;
  return bare.length > 1 ? bare.replace(/\/+$/, "") || "/" : bare || "/";
}

const DEPLOYMENT_PATH = /^\/projects\/([^/]+)\/deployments\/[^/]+$/;

/** The project slug in `/projects/<slug>/deployments/<id>`, or null for any other path. */
export function deploymentSlug(path: string): string | null {
  const match = DEPLOYMENT_PATH.exec(normalisePath(path));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1]!;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Where the person is, from the data                                                         */
/* ------------------------------------------------------------------------------------------ */

export type Stage =
  | "no-server"
  | "server-pending"
  | "connected-no-project"
  | "project-not-ready"
  | "ready-no-domain"
  | "complete";

/**
 * One word for where the person's account stands. A project wins over a server: someone with a
 * project is past the connecting stages whatever their server says now.
 */
export function stageOf(facts: OnboardingFacts): Stage {
  if (facts.projectCount > 0) {
    if (facts.firstDeployment?.state !== "ready") return "project-not-ready";
    return facts.hasActiveDomain ? "complete" : "ready-no-domain";
  }
  if (facts.servers.some((s) => s.status === "connected")) return "connected-no-project";
  return facts.servers.length > 0 ? "server-pending" : "no-server";
}

const hasConnectedServer = (facts: OnboardingFacts) => facts.servers.some((s) => s.status === "connected");
const deploymentReady = (facts: OnboardingFacts) => facts.firstDeployment?.state === "ready";

/* ------------------------------------------------------------------------------------------ */
/* Copy                                                                                       */
/* ------------------------------------------------------------------------------------------ */

const NEST_DASHBOARD: TourLink = { label: "Open the Nest dashboard", href: "https://dashboard.hackclub.app" };

export const SEGMENTS: readonly Segment[] = [
  /* Chapter 1: connect your container ------------------------------------------------------ */
  {
    id: "connect-projects",
    chapter: "connect",
    path: /^\/projects$/,
    route: "/projects",
    // The empty projects page only offers the connect button to someone with no server yet.
    startsWhen: (ctx) => ctx.facts.servers.length === 0,
    steps: [
      {
        title: "Put your app on Nest.",
        body: "Egg builds your GitHub repository and runs it on your Nest container. It takes about five minutes. We will point at each thing to press.",
        kind: "read",
        button: "Start",
        skip: "Not now",
      },
      {
        anchor: "connect-server",
        title: "Connect your container first.",
        body: "Egg needs a way in. This sets it up.",
        kind: "do",
        next: "/connect",
        side: "bottom",
      },
    ],
  },
  {
    id: "connect-setup",
    chapter: "connect",
    path: /^\/connect$/,
    route: "/connect",
    steps: [
      {
        anchor: "nest-username",
        title: "Your Nest username.",
        body: "The name you log in with, as in ssh username@hackclub.app. Then press Create key.",
        kind: "do",
        // A wide field with helper text under it: the popover goes beside it.
        side: "right",
        // Once a server exists its key was already made, so this step is behind the person.
        when: (ctx) => ctx.facts.servers.length === 0,
      },
      {
        anchor: "public-key",
        title: "Add the key in Nest.",
        body: "Copy it, open the Nest dashboard with the link below, and paste it on the SSH Keys page. Then come back. We will wait here.",
        kind: "read",
        side: "top",
        link: NEST_DASHBOARD,
      },
      {
        anchor: "test-connection",
        title: "Test the connection.",
        body: "Egg connects once and checks what your container can run.",
        kind: "do",
        side: "top",
      },
      {
        // The tour points at the fingerprint text and never at the Confirm button, and never
        // moves on for a click it did not see: the person confirms by themselves.
        anchor: "host-key",
        title: "Check the fingerprint.",
        body: "Compare it with the one Nest shows for your server. Confirm only if they match. Egg refuses any other key afterwards.",
        kind: "do",
        side: "top",
        when: (ctx) => ctx.variant.hostKeyPending,
      },
      {
        title: "Connected.",
        body: "Next, pick a repository.",
        kind: "read",
        button: "Continue",
        next: "/new",
      },
    ],
  },

  /* Chapter 2: import a repository --------------------------------------------------------- */
  {
    id: "import-new",
    chapter: "import",
    path: /^\/new$/,
    route: "/new",
    steps: [
      {
        anchor: "repo-source",
        title: "Pick your repository.",
        body: "Search, then press one.",
        kind: "do",
        side: "right",
        when: (ctx) => ctx.variant.github === "installed",
      },
      {
        anchor: "repo-source",
        title: "Connect GitHub.",
        body: "This lets Egg read your repositories and deploy on every push.",
        kind: "do",
        side: "right",
        when: (ctx) => ctx.variant.github === "not-installed",
      },
      {
        anchor: "repo-source",
        title: "Paste a repository URL.",
        body: "A public one works without any setup.",
        kind: "do",
        side: "right",
        when: (ctx) => ctx.variant.github === "not-configured",
      },
      {
        anchor: "project-settings",
        title: "Check what Egg found.",
        body: "It guessed the name, runtime and port from your repository. Change anything that is wrong.",
        kind: "read",
        side: "right",
      },
      {
        anchor: "container-conflicts",
        title: "Something is already on your container.",
        body: "Items marked as blocking stop the deploy until you deal with them. Egg never changes anything it did not create.",
        kind: "read",
        side: "top",
        when: (ctx) => ctx.variant.conflicts,
      },
      {
        // Pressing it creates the project and opens its deployment page; that path holds the
        // new project's id, so there is no fixed `next` to give here.
        anchor: "deploy",
        title: "Deploy.",
        body: "Egg builds on your container and starts the app. You can watch it happen.",
        kind: "do",
        side: "top",
      },
    ],
  },

  /* Chapter 3: the first deployment -------------------------------------------------------- */
  {
    id: "deploy-deployment",
    chapter: "deploy",
    path: DEPLOYMENT_PATH,
    route: "/projects/<slug>/deployments/<id>",
    steps: [
      {
        anchor: "build-logs",
        title: "Watch it build.",
        body: "This is the live output from your container. A first build usually takes a few minutes. You can leave this page; the tour will not block you.",
        kind: "read",
        button: "Got it",
        side: "top",
        // Nothing to watch once it is ready or has failed.
        when: (ctx) => !ctx.variant.deploymentFailed && !deploymentReady(ctx.facts),
      },
      {
        // Shown when the page shows ready; the host waits for the anchor to appear.
        anchor: "deployment-status",
        title: "Your app is running.",
        body: "It listens on port {port} inside your container. It has no web address yet. The next step gives it one.",
        kind: "read",
        button: "Give it an address",
        next: "/domains",
        side: "bottom",
        when: (ctx) => !ctx.variant.deploymentFailed,
      },
      {
        // Replaces the step above. The chapter is then marked paused, not done.
        anchor: "error-summary",
        title: "The build failed.",
        body: "Read the last lines of the log to see why. The troubleshooting page lists the usual causes.",
        kind: "read",
        button: "Got it",
        side: "bottom",
        link: { label: "Troubleshooting", href: "/docs/troubleshooting#troubleshooting-build" },
        when: (ctx) => ctx.variant.deploymentFailed,
      },
    ],
  },

  /* Chapter 4: give it an address ---------------------------------------------------------- */
  {
    id: "address-domains",
    chapter: "address",
    path: /^\/domains$/,
    route: "/domains",
    steps: [
      {
        anchor: "domain-form",
        title: "Choose an address.",
        body: "Use your-nest-name.hackclub.app (or a subdomain of it), which Nest hands out with no DNS setup, or a domain you own. Pick this project; the port is the one it listens on.",
        kind: "do",
        side: "right",
      },
      {
        anchor: "domain-steps",
        title: "Do this in Nest.",
        body: "Egg cannot change Nest's routing, so this one step is yours. The steps below are exact: open the Domains page in the Nest dashboard and enter the same domain and port. Then come back and press Check.",
        kind: "read",
        side: "top",
        link: NEST_DASHBOARD,
      },
      {
        anchor: "domain-check",
        title: "Check it.",
        body: "Egg looks at DNS and tells you whether it points here.",
        kind: "do",
        side: "top",
      },
    ],
  },
];

/**
 * The closing card of chapter 4. It is shown on the deployment page once a domain is active, so
 * it is not part of a segment: by then the chapter's goal is reached and the chapter rules would
 * refuse to start it. The host shows it once, after it has marked the chapter done.
 */
export const LIVE_CARD_STEP: TourStep = {
  anchor: "visit",
  title: "Your app is live at the address you chose.",
  body: "What next: add environment variables, set up a deploy hook, turn on analytics.",
  kind: "read",
  button: "Open it",
  side: "bottom",
};

/** One line, trimmed, cut at a word, and ended with a full stop, for text that comes from the page. */
function asSentence(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return "";
  const cut = line.length > max ? `${line.slice(0, max).replace(/\s+\S*$/, "")}…` : line;
  return /[.!?…]$/.test(cut) ? cut : `${cut}.`;
}

/**
 * Step 5 of chapter 1 when the key test failed: "That did not work." with the reason the page
 * already shows. It is not part of a segment because the page owns the failure; the host swaps it
 * in for the "Test the connection" step while the failure is on screen. `reason` is the text of
 * the page's own message, so it is cut to one line.
 */
export function failedTestStep(reason: string | null): TourStep {
  const why = reason ? asSentence(reason, 160) : "";
  return {
    anchor: "test-connection",
    title: "That did not work.",
    body: `${why ? `${why} ` : ""}Fix that, then press Test connection again.`,
    kind: "do",
    side: "top",
    link: { label: "Read the connecting guide", href: "/docs/servers#servers-connection" },
  };
}

/** The steps of a segment that apply to this context, in order. */
export function resolveSteps(segment: Segment, ctx: Context): TourStep[] {
  return segment.steps.filter((step) => !step.when || step.when(ctx));
}

/** Every `data-tour` name any step uses, sorted, with no repeats. Derived, never typed twice. */
export const ANCHORS: readonly string[] = [
  ...new Set(
    [...SEGMENTS.flatMap((s) => s.steps), LIVE_CARD_STEP]
      .map((step) => step.anchor)
      .filter((name): name is string => typeof name === "string"),
  ),
].sort();

/* ------------------------------------------------------------------------------------------ */
/* Which segment runs now                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** The person already has what finishing the chapter would give them. */
function alreadyHas(chapter: Chapter, ctx: Context): boolean {
  const { facts, marks } = ctx;
  switch (chapter) {
    case "connect":
      return hasConnectedServer(facts);
    case "import":
      return facts.projectCount > 0;
    case "deploy":
      return deploymentReady(facts) && marks.deploy === "done";
    case "address":
      return facts.hasActiveDomain;
  }
}

/** Where the person is, for a chapter that starts by itself. Marks on this chapter are checked by the caller. */
function mayStartByItself(chapter: Chapter, ctx: Context): boolean {
  const { facts, marks, path } = ctx;
  const stage = stageOf(facts);
  switch (chapter) {
    case "connect": {
      // Once, for a person with no server and no marks at all. A server that exists but is not
      // connected yet counts too, so the chapter resumes after a trip to the Nest dashboard.
      const otherMarks = Object.keys(marks).some((k) => k !== "connect");
      return !otherMarks && (stage === "no-server" || stage === "server-pending");
    }
    case "import":
      // After connecting (done, or the same position without marks). Never after a skipped chapter 1.
      return marks.connect !== "skipped" && stage === "connected-no-project";
    case "deploy": {
      if (marks.import === "skipped") return false;
      if (facts.projectCount === 0 || !facts.firstProject) return false;
      if (deploymentSlug(path) !== facts.firstProject.slug) return false;
      // Chapter 2 finished, or a retry after a failure, or the same position as someone who
      // finished chapter 2: their first deployment is under way (not ready) right now.
      return marks.import === "done" || marks.deploy === "paused" || !deploymentReady(facts);
    }
    case "address":
      if (marks.deploy === "skipped") return false;
      if (facts.projectCount === 0) return false;
      // Chapter 3 finished, or the same position: a ready deployment and no domain.
      return marks.deploy === "done" || stage === "ready-no-domain";
  }
}

/**
 * Decide what the tour should run now, or null for nothing.
 *
 * The host calls this when a page loads and again when the facts change, and ends the running
 * segment on every route change. A segment that is already running is the host's to finish: this
 * function is about starting, so for example the closing step of chapter 1 is shown by the
 * segment that is running when the server becomes connected, not by a new start.
 */
export function selectSegment(ctx: Context): Segment | null {
  const path = normalisePath(ctx.path);

  // A replay looks at one chapter only and ignores marks, "already has it" and where the
  // person's data says they are. It still needs the page to be one the chapter runs on.
  if (ctx.replay) {
    return SEGMENTS.find((s) => s.chapter === ctx.replay && s.path.test(path)) ?? null;
  }

  // A server and a project and no marks at all is someone who was here before the tour existed.
  // The tour is never started for them (a replay is their only way in).
  const noMarks = Object.keys(ctx.marks).length === 0;
  if (noMarks && ctx.facts.projectCount > 0) return null;

  const withPath = { ...ctx, path };
  for (const segment of SEGMENTS) {
    if (!segment.path.test(path)) continue;
    // done and skipped never start again by themselves; absent and paused may.
    const own = ctx.marks[segment.chapter];
    if (own === "done" || own === "skipped") continue;
    if (alreadyHas(segment.chapter, ctx)) continue;
    if (segment.startsWhen && !segment.startsWhen(ctx)) continue;
    if (!mayStartByItself(segment.chapter, withPath)) continue;
    return segment;
  }
  return null;
}
