import Link from "next/link";
import { BuildLogs } from "@/components/build-logs";
import { DeploymentsView } from "@/components/deployments-view";
import { DEPLOY_BOT_SCOPES, HOME_FACTS, TOKEN_SCOPES, numberWord } from "@/components/marketing/home-facts";
import { StepMarker, StepTrackLine } from "@/components/marketing/step-track";
import { TerminalCta } from "@/components/marketing/terminal-cta";
import { curlExample, mcpConfigSnippet } from "@/lib/developer";
import { REPO_URL } from "@/lib/site";
import { SAMPLE_DEPLOYMENTS, SAMPLE_LOG } from "@/lib/sample";
import { cn } from "@/lib/utils";

export const metadata = {
  title: { absolute: "Egg: push to GitHub, live on your Nest" },
  description:
    "Egg is an add-on that connects to your Hack Club Nest container. Push to GitHub and it builds and runs your app there, with logs, rollbacks, branch previews and alerts.",
};

const F = HOME_FACTS;

const wrap = "mx-auto w-full max-w-[1400px] px-6";
const h2 =
  "font-pixel max-w-[17ch] text-[clamp(2.1rem,4vw,3.5rem)] leading-[1.02] font-medium text-balance";
const pill =
  "pressable inline-flex h-10 items-center rounded-full px-5 text-[14px] font-medium tracking-[-0.01em]";
const primary = cn(
  pill,
  "bg-foreground text-background hover:bg-[color-mix(in_oklab,var(--foreground)_86%,var(--background))]"
);
/** Anchored sections clear the 60px header. */
const section = "scroll-mt-15 py-16 lg:py-24";
const term = "font-pixel text-[21px] leading-6 font-medium";
const code = "font-mono text-[0.9em] text-foreground";

/** A crosshair at a corner of the frame. */
function Plus({ className }: { className: string }) {
  return (
    <span aria-hidden="true" className={cn("absolute size-[13px]", className)}>
      <span className="absolute top-1/2 left-0 h-px w-full bg-foreground" />
      <span className="absolute top-0 left-1/2 h-full w-px bg-foreground" />
    </span>
  );
}

/**
 * The one authored moment: the headline is scanned in a pixel column at a
 * time, and the text and buttons rise in while the scan finishes. The hero is
 * sized in svh, not dvh, so it does not change height (and push the page) when
 * a phone's toolbar collapses during a scroll.
 */
function Hero() {
  return (
    <section className="flex min-h-[calc(100svh-3.75rem)] flex-col">
      <div className={cn(wrap, "flex flex-1 flex-col items-center justify-center py-16 text-center")}>
        <h1 className="hero-wipe font-pixel mx-auto max-w-[12ch] text-[clamp(3.5rem,10.5vw,11rem)] leading-[0.92] font-medium text-balance">
          Deploy to your Nest.
        </h1>
        <p
          style={{ "--rise-delay": "0.55s" } as React.CSSProperties}
          className="hero-rise mx-auto mt-9 max-w-[46ch] text-[clamp(1.125rem,1.7vw,1.5rem)] leading-[1.5] text-muted-foreground text-balance"
        >
          Egg connects to the Hack Club Nest container you already have. Push to GitHub and your app
          builds and goes live on it, with logs, rollbacks and previews.
        </p>
        <div
          style={{ "--rise-delay": "0.65s" } as React.CSSProperties}
          className="hero-rise mt-10 flex flex-wrap justify-center gap-3"
        >
          <Link href="/login" className={cn(primary, "h-12 px-7 text-[15px]")}>
            Sign in with Hack Club
          </Link>
          <a
            href="#product"
            className={cn(pill, "shadow-border-base h-12 bg-background px-7 text-[15px] hover:bg-[var(--ds-gray-100)]")}
          >
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}

/**
 * The hairline frame with crosshair corners and a header bar. `tag` is the
 * small note on the right of the bar ("Sample data", "Example").
 */
function Frame({ label, tag, children }: { label: string; tag: string; children: React.ReactNode }) {
  return (
    <div className="relative">
      <Plus className="-top-1.5 -left-1.5 z-10" />
      <Plus className="-top-1.5 -right-1.5 z-10" />
      <Plus className="-bottom-1.5 -left-1.5 z-10" />
      <Plus className="-right-1.5 -bottom-1.5 z-10" />
      <div className="overflow-hidden border bg-background">
        <div className="text-caption flex h-10 items-center justify-between gap-4 border-b px-4 font-mono font-normal text-muted-foreground">
          <span className="truncate">{label}</span>
          <span className="shrink-0">{tag}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * A headline and the real UI under it, with a short note beside it. `flip`
 * puts the note on the right. The frame's header bar says the data is sample
 * data, because it is.
 */
function Showcase({
  id,
  title,
  note,
  detail,
  frameLabel,
  flip = false,
  after,
  children,
}: {
  id?: string;
  title: string;
  /** The one thing to know, in larger type. */
  note: string;
  /** A second, quieter paragraph under the note. */
  detail: string;
  /** The name in the frame's header bar. */
  frameLabel: string;
  flip?: boolean;
  /** Notes that sit under the frame, in the same column. */
  after?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={section}>
      <div
        className={cn(
          wrap,
          "grid gap-12 lg:gap-20",
          flip ? "lg:grid-cols-[minmax(0,1fr)_280px]" : "lg:grid-cols-[280px_minmax(0,1fr)]"
        )}
      >
        {/* Pinned under the header so the demo beside it can grow and shrink (collapsing the
            log, filtering the list) without moving this text. */}
        <div
          className={cn(
            "order-2 lg:row-start-1 lg:sticky lg:top-24 lg:self-start lg:pt-2",
            after && "lg:row-span-2",
            flip ? "lg:col-start-2" : "lg:col-start-1"
          )}
        >
          <p className="text-docs-lead text-reading max-w-[30ch]">{note}</p>
          <p className="text-body mt-5 max-w-[34ch] text-muted-foreground">{detail}</p>
        </div>
        <div className={cn("order-1 min-w-0 lg:row-start-1", flip ? "lg:col-start-1" : "lg:col-start-2")}>
          <h2 className={cn(h2, "max-w-[20ch]")}>{title}</h2>
          <div className="mt-12">
            <Frame label={frameLabel} tag="Sample data">
              {children}
            </Frame>
          </div>
        </div>
        {after && (
          <div className={cn("order-3 min-w-0 lg:row-start-2", flip ? "lg:col-start-1" : "lg:col-start-2")}>{after}</div>
        )}
      </div>
    </section>
  );
}

/** Terms with a pixel heading and a hairline above, two to a row from sm. */
function Notes({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
      {items.map(([name, text]) => (
        <div key={name} className="border-t pt-5">
          <dt className={term}>{name}</dt>
          <dd className="text-prose mt-3 max-w-[44ch] text-muted-foreground">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

const STEPS = [
  ["Sign in", "Sign in with Hack Club. It confirms who you are and has no route to your container."],
  [
    "Add the key",
    "Copy the public key Egg makes for your server, paste it into the SSH Keys page of your Nest dashboard, then press Test connection.",
  ],
  [
    "Import the repo",
    "Install the GitHub app on a repository and pick it. Check the runtime, port and commands it detected, then press Deploy.",
  ],
];

/**
 * A hairline runs across the top of each step with one lit square at its start.
 * The squares switch on one after another as the row arrives.
 */
function Start() {
  return (
    <section id="start" className={section}>
      <div className={wrap}>
        <h2 className={cn(h2, "max-w-[20ch]")}>Setup is one key and one repo.</h2>
        <p className="text-docs-lead text-reading mt-6 max-w-[48ch]">
          Do it once. After that, every push to your production branch deploys on its own.
        </p>
        <ol className="mt-16 grid md:grid-cols-3">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="relative pt-8 pr-8 pb-2 max-md:pb-8">
              <StepTrackLine />
              <StepMarker index={i} />
              <h3 className="font-pixel text-[24px] leading-none font-medium">{title}</h3>
              <p className="text-prose mt-4 max-w-[36ch] text-muted-foreground">{text}</p>
            </li>
          ))}
        </ol>
        <p className="text-prose mt-10 max-w-[64ch] text-muted-foreground">
          Already running something on your container? Before the first deploy, Egg looks for services, folders and
          ports that are in use. Anything it did not make is left alone: the deploy stops instead of overwriting it.
        </p>
      </div>
    </section>
  );
}

const RUNTIMES = [
  ["Node.js", "Reads your lockfile to choose npm, pnpm or yarn, then runs your build script if you have one.", "npm start"],
  ["Python", "Installs requirements.txt into a virtual environment on your Nest.", "python3 app.py"],
  ["Static site", "Builds if you have a build script, then serves the output folder you pick.", "a small file server"],
  ["Any command", "Skips detection. You write the install, build and start commands.", "your command"],
];

function Runtimes() {
  return (
    <section id="runtimes" className={section}>
      <div className={wrap}>
        <h2 className={cn(h2, "max-w-[20ch]")}>It reads your repo and picks the commands.</h2>
        <p className="text-docs-lead text-reading mt-6 max-w-[52ch]">
          No config file to write. Override any step in the project settings.
        </p>
        <div className="mt-14 border bg-background">
          <table className="w-full text-left max-md:block">
            <caption className="sr-only">What Egg runs for each kind of project</caption>
            <thead className="max-md:sr-only">
              <tr className="text-label border-b text-subtle-foreground">
                <th scope="col" className="w-[200px] px-6 py-3 font-normal">Runtime</th>
                <th scope="col" className="px-6 py-3 font-normal">Install and build</th>
                <th scope="col" className="w-[240px] px-6 py-3 font-normal">Starts with</th>
              </tr>
            </thead>
            <tbody className="max-md:block">
              {RUNTIMES.map(([name, text, start]) => (
                <tr key={name} className="border-b last:border-b-0 max-md:block max-md:px-4 max-md:py-5">
                  <th
                    scope="row"
                    className="font-pixel px-6 py-6 align-top text-[21px] leading-6 font-medium max-md:block max-md:p-0"
                  >
                    {name}
                  </th>
                  <td className="text-prose max-w-[52ch] px-6 py-6 align-top text-muted-foreground max-md:mt-2 max-md:block max-md:p-0">
                    {text}
                  </td>
                  <td className="px-6 py-6 align-top font-mono text-[14px] leading-7 max-md:mt-2 max-md:block max-md:p-0">
                    <span className="text-subtle-foreground md:sr-only">Starts with </span>
                    {start}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-prose mt-6 max-w-[60ch] text-muted-foreground">
          Whichever it is, your app listens on the <code className={code}>PORT</code> it is given, on{" "}
          <code className={code}>0.0.0.0</code>.
        </p>
      </div>
    </section>
  );
}

/**
 * Tokens, the API and MCP. The frame shows the two setup snippets the
 * Developer page gives, with a placeholder token and host.
 */
function Agents() {
  const origin = "https://your-egg";
  const note = "border-t pt-5";
  return (
    <section id="agents" className={section}>
      <div className={wrap}>
        <h2 className={cn(h2, "max-w-[20ch]")}>Scripts and AI agents can deploy too.</h2>
        <p className="text-docs-lead text-reading mt-6 max-w-[52ch]">
          Make an access token on the Developer page and tick only what the job needs. A script or an AI
          agent can then work with your projects without your password.
        </p>
        <div className="mt-14 grid gap-12 lg:grid-cols-2 lg:gap-20">
          <div className="min-w-0">
            <Frame label="API and MCP" tag="Example">
              <div className="space-y-6 p-4 sm:p-6">
                <div>
                  <p className="text-caption font-mono text-subtle-foreground">List your projects</p>
                  <pre
                    tabIndex={0}
                    role="region"
                    aria-label="curl example"
                    className="mt-2 overflow-x-auto py-1 font-mono text-[13px] leading-6"
                  >
                    {curlExample(origin).replace(" https://", " \\\n  https://")}
                  </pre>
                </div>
                <div>
                  <p className="text-caption font-mono text-subtle-foreground">Connect an AI agent</p>
                  <pre
                    tabIndex={0}
                    role="region"
                    aria-label="MCP client configuration"
                    className="mt-2 overflow-x-auto py-1 font-mono text-[13px] leading-6"
                  >
                    {mcpConfigSnippet(origin)}
                  </pre>
                </div>
              </div>
            </Frame>
          </div>
          <div className="space-y-8 lg:pt-2">
            <div className={note}>
              <h3 className={term}>Permissions and expiry</h3>
              <p className="text-prose mt-3 max-w-[48ch] text-muted-foreground">
                There are {TOKEN_SCOPES.length} permissions to pick from. A script that deploys and reads the
                result needs these {numberWord(DEPLOY_BOT_SCOPES.length)}:
              </p>
              <ul className="text-caption mt-4 grid max-w-[30rem] grid-cols-2 gap-x-5 gap-y-1 font-mono text-foreground">
                {DEPLOY_BOT_SCOPES.map((scope) => (
                  <li key={scope}>{scope}</li>
                ))}
              </ul>
              <p className="text-prose mt-4 max-w-[48ch] text-muted-foreground">
                A token lasts 7, 30, 90 or 365 days. You can rename it, change its permissions or revoke it at
                any time.
              </p>
            </div>
            <div className={note}>
              <h3 className={term}>An API and an MCP endpoint</h3>
              <p className="text-prose mt-3 max-w-[48ch] text-muted-foreground">
                The API lives under <code className={code}>/api/v1</code>, and an{" "}
                <a href="/api/v1/openapi.json" className="link font-medium text-foreground">
                  OpenAPI description
                </a>{" "}
                lists every call. The MCP endpoint at <code className={code}>/api/mcp</code> lets an AI agent list
                projects, deploy, read logs and check usage.
              </p>
            </div>
            <div className={note}>
              <h3 className={term}>Terminal and files, on a short leash</h3>
              <p className="text-prose mt-3 max-w-[48ch] text-muted-foreground">
                A token can use the terminal or change files only while you have that switched on for the
                server, and file changes stay inside the project&apos;s shared folder. Such a token expires within{" "}
                {F.shortLivedDays} days. No token can remove leftovers, change container permissions, or manage
                your account, sessions or tokens.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const PRODUCT_NOTES: [string, React.ReactNode][] = [
  [
    "Find the one you want",
    "Search by commit, branch, author or pull request number. Filter by status, environment, project and time, and sort the list. The sample above keeps to the status filter.",
  ],
  [
    "Previews for pull requests",
    "A pull request from the same repository builds a preview and gets one comment that updates as it finishes. Closing the pull request removes its preview. Pull requests from forks are never built.",
  ],
  [
    "Compare and clean up",
    "Pick two deployments to compare them side by side. Cancel builds, or delete old previews, in bulk.",
  ],
  [
    "See the whole container",
    "The Container page lists your projects, leftover services and folders with no project, and other processes listening on a port. A leftover is removed only after you confirm.",
  ],
];

const WATCH_NOTES: [string, React.ReactNode][] = [
  [
    "Uptime checks",
    `Egg checks each app every ${F.checkIntervalMinutes} minutes by default. After ${numberWord(F.failedChecksBeforeAlert)} failed checks in a row it counts as down, and you hear again when it is back.`,
  ],
  [
    "Alerts in Discord or Slack",
    "Paste a Discord or Slack webhook into a project. Get a message when the app goes down, when the container's memory, CPU or disk passes the limit you set, and when a deploy ends. Mute them when you need quiet.",
  ],
  [
    "A public status page",
    `Switch it on and the project gets a page that says whether it is answering, with outages from the last ${F.statusWindowDays} days. It shows no repository, port, server or commit, and you can switch it off at any time.`,
  ],
  [
    "Page views, if you want them",
    `Add one script tag to your site to count page views. It stores no IP address and sets no cookie, and the numbers are kept for ${F.pageviewDays} days. It is off until you turn it on.`,
  ],
];

/** What happens after a deploy: checks, alerts, the status page and page views. */
function Watch() {
  return (
    <section id="monitoring" className={section}>
      <div className={cn(wrap, "grid gap-12 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-20")}>
        <div>
          <h2 className="font-pixel max-w-[12ch] text-[clamp(2rem,3vw,2.75rem)] leading-[1.02] font-medium text-balance">
            Know when it stops answering.
          </h2>
          <p className="text-prose mt-5 max-w-[30ch] text-muted-foreground">
            Your container&apos;s CPU, memory and disk are on the Resources page too, over 24 hours or 7 days,
            with figures for each project.
          </p>
        </div>
        <Notes items={WATCH_NOTES} />
      </div>
    </section>
  );
}

const em = "font-medium text-foreground";

function Security() {
  return (
    <section id="security" className={section}>
      <div className={cn(wrap, "grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,600px)] lg:gap-20")}>
        <div>
          <h2 className={cn(h2, "max-w-[14ch]")}>The key can do what you can do.</h2>
          <p className="text-docs-lead text-reading mt-8 max-w-[40ch]">
            SSH into Nest puts you in a root shell inside your own container, so the key Egg holds has the
            same reach. We say so before you add it.
          </p>
        </div>
        <div className="text-prose space-y-6 text-muted-foreground lg:pt-3">
          <p>
            Each server gets its own <span className={em}>ed25519 key</span>, made for Egg and used for nothing
            else. It is encrypted with <span className={em}>AES-256-GCM</span> before it reaches the database,
            and tied to your server so it cannot be moved. The first connection records Nest&apos;s host key,
            and if it ever changes Egg stops before sending anything.
          </p>
          <p>
            Your repo is built in a sandbox outside your container, so your container&apos;s memory is for your
            app, and the source is deleted when the build ends. Environment variables are encrypted, masked in
            logs and never sent back to your browser. Sign-in is Hack Club Auth, which has no route to your
            container.
          </p>
          <p>
            The <span className={em}>terminal</span> and <span className={em}>file changes</span> are off for
            every server until you turn them on.
          </p>
          <ul className="space-y-3">
            {[
              `Turning either on needs a fresh Hack Club sign-in, made in the last ${F.reauthMinutes} minutes.`,
              "File changes can only touch the shared folder. The live release is read-only.",
              `An open terminal closes when you sign out or when its switch is turned off. It also ends after ${F.terminalIdleMinutes} minutes without input, or ${F.terminalMaxMinutes} minutes in total.`,
            ].map((line) => (
              <li key={line} className="flex gap-3">
                <span aria-hidden="true" className="mt-[11px] size-1.5 shrink-0 bg-foreground" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <p className={cn(em, "border-t pt-6")}>
            To take access back, delete the key in your Nest dashboard. It ends at once, and your apps keep
            running.
          </p>
          <Link href="/security" className="link inline-flex items-center py-2 text-[14px] font-medium text-foreground max-sm:py-2.5">
            How Egg protects your container
          </Link>
        </div>
      </div>
    </section>
  );
}

const FAQ: [string, React.ReactNode][] = [
  ["Is it free?", "Yes. Nest is free and so is Egg. Your apps run on your own Nest container, within its limits."],
  [
    "Is Egg part of Nest?",
    "No. Egg is an add-on that connects to a Nest container you already own. It is an independent project by a Hack Club member, not an official Hack Club product, and the Nest team does not run it.",
  ],
  ["Does it work with private repositories?", "Yes. Egg reads whatever repositories you give the GitHub app access to, and only those."],
  [
    "Can I use my own domain?",
    "Yes, with one manual step. Nest maps domains to ports on its own dashboard and has no API for it, so Egg shows you what to enter and checks your DNS.",
  ],
  [
    "Does it run databases?",
    "No. It deploys your app. If you need a database, run one in your Nest container yourself and point the app at it with an environment variable.",
  ],
  [
    "My container already runs apps. Will Egg break them?",
    "It checks first. Services, folders and ports that Egg did not make are yours, and a deploy that would clash with them stops instead of overwriting them.",
  ],
  [
    "Can an AI agent use it?",
    "Yes. Make an access token with only the permissions the job needs and point the agent at the MCP endpoint, so it can list projects, deploy, read logs and check usage.",
  ],
  [
    "Can it change my files or open a terminal?",
    `Only after you turn that on for a server and confirm with a Hack Club sign-in from the last ${F.reauthMinutes} minutes. Both start off. A token can use them only while they are on, and such a token expires within ${F.shortLivedDays} days.`,
  ],
  [
    "Where are the numbers on /stats from?",
    <>
      From this installation&apos;s own records, as rounded totals, with anything under 10 shown as
      &ldquo;fewer than 10&rdquo;. Nothing on the{" "}
      <Link href="/stats" className="link font-medium text-foreground">
        stats page
      </Link>{" "}
      identifies a person or a project.
    </>,
  ],
];

/**
 * One native details element per question: it opens and closes with the
 * keyboard and without scripts. The height eases open where the browser
 * supports it (see .faq in globals.css).
 */
function Faq() {
  return (
    <section id="faq" className={section}>
      <div className={cn(wrap, "grid gap-12 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-20")}>
        <div>
          <h2 className="font-pixel text-[clamp(2rem,3vw,2.75rem)] leading-none font-medium">Questions</h2>
          <p className="text-prose mt-5 max-w-[26ch] text-muted-foreground">
            Want to see how something works? The{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="link font-medium text-foreground">
              source is on GitHub
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            .
          </p>
        </div>
        <div className="faq divide-y border bg-background">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>
                <span className="text-body-lg font-medium">{q}</span>
                <span aria-hidden="true" className="faq-icon" />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section>
      <div className={cn(wrap, "py-24 lg:py-36")}>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:items-center lg:gap-20">
          <div>
            <h2 className="font-pixel max-w-[18ch] text-[clamp(2.75rem,6vw,5rem)] leading-[0.95] font-medium">
              Connect your Nest and push.
            </h2>
            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-1">
              <Link href="/login" className={cn(primary, "mr-1")}>
                Sign in with Hack Club
              </Link>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="link inline-flex items-center py-2 text-[14px] font-medium max-sm:py-2.5"
              >
                View the source
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </div>
          </div>
          <TerminalCta />
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <>
      <Hero />

      <Showcase
        id="product"
        title="Every push becomes a release."
        frameLabel="Deployments"
        note={`Push to your production branch, main unless you pick another, and it goes live. Any other branch builds a preview on its own port, from ${F.previewPortMin}.`}
        detail={`Production keeps your last ${numberWord(F.releasesKept)} releases on the container. Rolling back switches to one of them, so nothing is rebuilt.`}
        after={<Notes items={PRODUCT_NOTES} />}
      >
        {/* On a phone the demo is too narrow for commit and branch, so those drop out. */}
        <div className="p-3 sm:p-6 max-sm:[&_p.font-mono]:hidden">
          <DeploymentsView deployments={SAMPLE_DEPLOYMENTS} showProject={false} demo />
        </div>
      </Showcase>

      <Start />

      <Runtimes />

      <Agents />

      <Showcase
        flip
        title="A failed deploy puts the old release back."
        frameLabel="pixel-garden / a08c6f1"
        note={`Egg waits up to ${F.healthWaitSeconds} seconds for your app to answer on its port. If it never does, the previous release is put back.`}
        detail="Build output streams to this page as it happens. Runtime logs come from your app's systemd service. Show the last hour, day or week, only warnings and errors, search them, or download them as a text file."
      >
        <div className="p-4 sm:p-6">
          <BuildLogs deploymentId="sample" initialLines={SAMPLE_LOG} rawState="error" duration="48s" />
        </div>
      </Showcase>

      <Watch />
      <Security />
      <Faq />
      <Cta />
    </>
  );
}
