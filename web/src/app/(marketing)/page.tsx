import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import "@/components/marketing/home.css";
import { BuildLogs } from "@/components/build-logs";
import { DeploymentsView } from "@/components/deployments-view";
import { GridFrame } from "@/components/marketing/grid-frame";
import { ReleaseRail } from "@/components/marketing/release-rail";
import { TerminalCta } from "@/components/marketing/terminal-cta";
import { HOME_FACTS, numberWord } from "@/components/marketing/home-facts";
import { REPO_URL } from "@/lib/site";
import { feedRowsToViews, homepageListMode, LIVE_CAPTION, SAMPLE_CAPTION } from "@/lib/public-feed";
import { SAMPLE_DEPLOYMENTS, SAMPLE_LOG } from "@/lib/sample";
import { getPublicFeed } from "@/server/public-feed-cache";
import { cn } from "@/lib/utils";

export const metadata = {
  title: { absolute: "Egg: push to GitHub, live on your Nest" },
  description:
    "Egg is an add-on that connects to your Hack Club Nest container. Push to GitHub and it builds and runs your app there, with logs, rollbacks, branch previews and alerts.",
};

const F = HOME_FACTS;

const wrap = "mx-auto w-full max-w-[1400px] px-6";
const pill =
  "touch-target pressable inline-flex h-10 items-center rounded-full px-5 text-[14px] font-medium tracking-[-0.01em]";
/** The main action: ink fill, page-colour text. The same button as Sign in in the header. */
const primary = cn(
  pill,
  "bg-foreground text-background hover:bg-[color-mix(in_oklab,var(--foreground)_86%,var(--background))]"
);
/** The other action: a hairline pill on the page colour. */
const secondary = cn(pill, "shadow-border-base bg-background hover:bg-[var(--ds-gray-100)]");

/**
 * Text and two buttons, on the plain grid. The headline is scanned in a pixel column at a time and the
 * rest rises in while the scan finishes. The hero fills the first screen under the 60px header, so
 * nothing else shows on load; the frame below starts under the fold (see GridFrame). It is sized
 * in svh, not dvh, so it does not change height (and push the page) when a phone's toolbar
 * collapses during a scroll.
 */
function Hero() {
  return (
    <section data-no-ripple className="flex min-h-[calc(100svh-3.75rem)] flex-col">
      <div className={cn(wrap, "flex flex-1 flex-col items-center justify-center pt-16 pb-24 text-center xl:pb-16")}>
        <h1
          className="hero-wipe font-pixel mx-auto max-w-[12ch] text-[clamp(3.5rem,10.5vw,11rem)] leading-[0.92] font-medium text-balance"
        >
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
            href="#start"
            className={cn(pill, "shadow-border-base h-12 bg-background px-7 text-[15px] hover:bg-[var(--ds-gray-100)]")}
          >
            See how it works
          </a>
        </div>
        <p
          style={{ "--rise-delay": "0.75s" } as React.CSSProperties}
          className="hero-rise mt-7 max-w-[52ch] text-[14px] leading-6 text-muted-foreground text-balance"
        >
          Free. Made by a Hack Club member, and not an official Hack Club product.
        </p>
      </div>
    </section>
  );
}


/** Below the hero every box is rounded up to whole 30px cells by GridFrame; spacing is in home.css. */
function Row({ cols, className, children }: { cols?: string; className?: string; children: React.ReactNode }) {
  return <div className={cn("vg-row", cols && `vg-cols ${cols}`, className)}>{children}</div>;
}

/** A small amber square, used only for "this one is live / running". */
function Mark({ building = false }: { building?: boolean }) {
  return <span aria-hidden="true" className={cn("vg-mark", building && "vg-mark-building")} />;
}

const SETUP: [string, string][] = [
  ["Sign in", "With Hack Club. It confirms who you are and has no route to your container."],
  [
    "Add the key",
    "Egg makes a key for your server. Paste it into the SSH Keys page of your Nest dashboard and press Test connection.",
  ],
  [
    "Import the repo",
    "Install the GitHub app on a repository and pick it. Check the runtime, port and commands Egg detected, then press Deploy.",
  ],
];

function Start() {
  return (
    <section id="start" aria-labelledby="start-title" className="vg-sec scroll-mt-15">
      <Row>
        <div className="vg-head">
          <h2 id="start-title" className="vg-h1">
            Every push to GitHub goes live on your Nest.
          </h2>
        </div>
      </Row>
      <Row cols="vg-c-half">
        <div className="order-2 lg:order-none">
          <ol className="vg-steps">
            {SETUP.map(([title, text], i) => (
              <li key={title}>
                <span aria-hidden="true" className="vg-num">
                  {i + 1}
                </span>
                <div>
                  <h3 className="vg-h3">{title}</h3>
                  <p className="vg-p">{text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="vg-after">After that, every push to your production branch deploys on its own.</p>
        </div>
        <div className="vg-sticky-col order-1 lg:order-none">
          <div className="vg-sticky">
            <TerminalCta />
            <p className="vg-caption">Sample data</p>
          </div>
        </div>
      </Row>
    </section>
  );
}

/** The made-up list. It is the first paint of the product section and the fallback when the feed is short. */
function SampleDeployments() {
  return (
    <>
      <DeploymentsView deployments={SAMPLE_DEPLOYMENTS} showProject={false} demo />
      <p className="vg-caption">{SAMPLE_CAPTION}</p>
    </>
  );
}

/**
 * Real deployments of public projects whose owners chose to show them, when there are enough of them
 * (at least MIN_LIVE_ROWS); the sample list otherwise, and if the feed fails. The feed is read per
 * request from a cache that lives a minute (server/public-feed-cache.ts), so the page itself stays
 * a static shell and never touches the database at build time.
 */
async function Deployments() {
  await connection();
  const rows = await getPublicFeed().catch(() => []);
  if (homepageListMode(rows) === "sample") return <SampleDeployments />;
  return (
    <>
      <DeploymentsView deployments={feedRowsToViews(rows)} showProject={false} live />
      <p className="vg-caption">{LIVE_CAPTION}</p>
    </>
  );
}

const PREVIEWS: { name: string; port: number; building: boolean; kind: string }[] = [
  { name: "feat/pagination", port: F.previewPortMin, building: true, kind: "Branch" },
  { name: "fix/login-redirect", port: F.previewPortMin + 1, building: false, kind: "Branch" },
  { name: "#14 from feat/csv", port: F.previewPortMin + 2, building: false, kind: "Pull request" },
];

function Product() {
  return (
    <section id="product" aria-labelledby="product-title" className="vg-sec scroll-mt-15">
      <Row>
        <div className="vg-head">
          <h2 id="product-title" className="vg-h1">
            Every push becomes a release.
          </h2>
        </div>
      </Row>
      <Row>
        <div className="vg-solid vg-deploys">
          <Suspense fallback={<SampleDeployments />}>
            <Deployments />
          </Suspense>
        </div>
      </Row>
      <Row cols="vg-c-wide">
        <div className="vg-feature">
          <h3 className="vg-h2s">Rollbacks</h3>
          <p className="vg-p">
            Production keeps your last {numberWord(F.releasesKept)} releases on the container. Rolling back switches
            to one of them, so nothing is rebuilt.
          </p>
          <div className="vg-panel">
            <ReleaseRail />
          </div>
          <p className="vg-caption vg-caption-flush">Sample data. Try it.</p>
        </div>
        <div className="vg-feature">
          <h3 className="vg-h2s">Previews</h3>
          <p className="vg-p">
            Any branch that is not production builds a preview on its own port, from {F.previewPortMin}. A pull
            request from the same repository gets one too, with a comment that updates as it finishes.
          </p>
          <div className="vg-panel">
            <ul className="vg-previews" aria-label="Sample previews">
              {PREVIEWS.map((p) => (
                <li key={p.name}>
                  <Mark building={p.building} />
                  <span className="vg-prev-name">
                    <span className="vg-prev-kind">{p.kind}</span>
                    {p.name}
                  </span>
                  <span className="vg-prev-port">:{p.port}</span>
                  <span className="vg-prev-state">{p.building ? "Building" : "Ready"}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="vg-caption vg-caption-flush">Sample data</p>
        </div>
      </Row>
      <Row cols="vg-c-side">
        <div className="vg-feature">
          <h3 className="vg-h2s">No config file</h3>
          <p className="vg-p">
            Egg reads your repo and picks the install, build and start commands. You can write your own for anything
            else.
          </p>
        </div>
        <div className="vg-feature vg-mid">
          {/* The longest command is wider than a phone: the list scrolls inside itself. */}
          <div className="vg-panel">
            <p className="vg-panel-head">Start command when you set none</p>
            <dl className="vg-defaults vg-scroll" tabIndex={0} aria-label="Default start commands">
              {(
                [
                  ["Node.js", "npm start"],
                  ["Python", "python3 app.py"],
                  ["Static", `Egg static server on ${F.defaultPort}`],
                ] as const
              ).map(([runtime, command]) => (
                <div key={runtime}>
                  <dt>{runtime}</dt>
                  <dd>{command}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Row>
    </section>
  );
}

const SAFETY: { stat: string; unit: string; text: React.ReactNode }[] = [
  {
    stat: String(F.healthWaitSeconds),
    unit: "seconds",
    text: (
      <>
        <strong>Health check.</strong> Egg waits up to {F.healthWaitSeconds} seconds for your app to answer on its
        port. If it never does, the previous release is put back.
      </>
    ),
  },
  {
    stat: String(F.checkIntervalMinutes),
    unit: "minutes",
    text: (
      <>
        <strong>Checks.</strong> Egg checks each app every {F.checkIntervalMinutes} minutes.
      </>
    ),
  },
  {
    stat: String(F.failedChecksBeforeAlert),
    unit: "in a row",
    text: (
      <>
        <strong>Alerts.</strong> After {numberWord(F.failedChecksBeforeAlert)} failed checks in a row it tells you in
        Discord or Slack, if you gave the project a webhook.
      </>
    ),
  },
];

function WhenItBreaks() {
  return (
    <section aria-labelledby="fail-title" className="vg-sec">
      <Row>
        <div className="vg-head">
          <h2 id="fail-title" className="vg-h1">
            A failed deploy puts the old release back.
          </h2>
          <p className="vg-lead">
            Build output streams to the page as it happens. Runtime logs come from your app&apos;s systemd service,
            and you can search or download them.
          </p>
        </div>
      </Row>
      <Row cols="vg-c-logw">
        <div className="vg-solid vg-log">
          <BuildLogs deploymentId="sample" initialLines={SAMPLE_LOG} rawState="error" duration="48s" />
          <p className="vg-caption">Sample data</p>
        </div>
        <ul className="vg-stats">
          {SAFETY.map((s) => (
            <li key={s.unit}>
              <p className="vg-stat" aria-hidden="true">
                <span className="vg-stat-n">{s.stat}</span>
                <span className="vg-stat-u">{s.unit}</span>
              </p>
              <p className="vg-p">{s.text}</p>
            </li>
          ))}
        </ul>
      </Row>
    </section>
  );
}

const TRUST: { name: string; text: string; spec: string[] }[] = [
  {
    name: "One key, only for Egg",
    text: "Each server gets its own ed25519 key, encrypted before it reaches the database. The first connection records Nest's host key, and if it ever changes Egg stops before sending anything.",
    spec: ["ed25519", "host key pinned"],
  },
  {
    name: "Built on your container",
    text: "Your repo is built on your own Nest under a memory and CPU cap, or in GitHub Actions if you set that up. It is not built on the machine that runs Egg.",
    spec: [`${F.buildMemoryMb} MB build cap by default`],
  },
  {
    name: "Terminal and file changes start off",
    text: `Both are off for every server until you turn them on, and that needs a Hack Club sign-in from the last ${F.reauthMinutes} minutes.`,
    spec: ["terminal off", "file changes off"],
  },
  {
    name: "Take access back any time",
    text: "Delete the key in your Nest dashboard. Egg's access ends at once, and your apps keep running.",
    spec: ["apps keep running"],
  },
];

function Trust() {
  return (
    <section id="security" aria-labelledby="security-title" className="vg-sec scroll-mt-15">
      <Row>
        <div className="vg-head">
          <h2 id="security-title" className="vg-h1">
            The key can do what you can do.
          </h2>
          <p className="vg-lead">
            SSH into Nest puts you in a root shell inside your own container, so the key Egg holds has the same
            reach. We say so before you add it.
          </p>
        </div>
      </Row>
      <Row cols="vg-c-half" className="vg-trust">
        {TRUST.map((t) => (
          <div key={t.name} className="vg-feature">
            <h3 className="vg-h3">{t.name}</h3>
            <p className="vg-p">{t.text}</p>
            <p className="vg-spec">
              {t.spec.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </p>
          </div>
        ))}
      </Row>
      <Row>
        <div className="vg-band">
          <p className="vg-p vg-ink">
            Egg is an independent project by a Hack Club member. It is not an official Hack Club product, and the
            Nest team does not run it.
          </p>
          <Link href="/security" className={secondary}>
            How Egg protects your container
          </Link>
        </div>
      </Row>
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
    "Can a script or an AI agent deploy?",
    "Yes. Make an access token on the Developer page with only the permissions the job needs. There is an API and an MCP endpoint, so a script or an agent can list projects, deploy, read logs and check usage without your password.",
  ],
];

/** One native details element per question: it opens and closes with the keyboard and without scripts. */
function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="vg-sec scroll-mt-15">
      <Row cols="vg-c-side">
        <div className="vg-cell vg-head">
          <div className="vg-sticky">
            <h2 id="faq-title" className="vg-h2">
              Questions
            </h2>
            <p className="vg-p">
              The{" "}
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="link font-medium text-foreground">
                source is on GitHub
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
              .
            </p>
          </div>
        </div>
        <div className="vg-faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>
                <span>{q}</span>
                <span aria-hidden="true" className="vg-faq-icon" />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </Row>
    </section>
  );
}

/** One block, left aligned. It does not repeat the hero. */
function Close() {
  return (
    <section aria-labelledby="close-title" className="vg-sec">
      <Row>
        <div className="vg-head">
          <h2 id="close-title" className="vg-h1">
            Connect your Nest, then push.
          </h2>
          <div className="mt-[var(--vg-lead-gap)] flex flex-wrap items-center gap-3">
            <Link href="/login" className={cn(primary, "h-12 px-7 text-[15px]")}>
              Sign in with Hack Club
            </Link>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className={cn(secondary, "h-12 px-7 text-[15px]")}>
              View the source
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </div>
      </Row>
    </section>
  );
}

export default function HomePage() {
  return (
    <div className="egg-home">
      <Hero />
      <GridFrame>
        <Start />
        <Product />
        <WhenItBreaks />
        <Trust />
        <Faq />
        <Close />
      </GridFrame>
    </div>
  );
}
