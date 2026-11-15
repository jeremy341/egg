import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import "@/components/marketing/home.css";
import { BuildLogs } from "@/components/build-logs";
import { DeploymentsView } from "@/components/deployments-view";
import { GridFrame } from "@/components/marketing/grid-frame";
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
 * Text and two buttons, with the chicken (ChickenFieldLoader, in the layout) walking over the page
 * in the browser; without them the hero is the plain grid. The headline is scanned in a pixel column at a time and the
 * rest rises in while the scan finishes. The hero fills the first screen under the 60px header, so
 * nothing else shows on load; the frame below starts under the fold (see GridFrame). It is sized
 * in svh, not dvh, so it does not change height (and push the page) when a phone's toolbar
 * collapses during a scroll.
 */
function Hero() {
  return (
    <section data-no-ripple className="cf-hero flex min-h-[calc(100svh-3.75rem)] flex-col">
      <div className={cn(wrap, "cf-copy flex flex-1 flex-col items-center justify-center pt-16 pb-24 text-center xl:pb-16")}>
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
      <p className="cf-hint" aria-hidden="true">
        <span className="cf-fine">Click the grid to feed the chicken. Poke it, stroke it, pick it up.</span>
        <span className="cf-coarse">Tap the grid to feed the chicken. Tap it to poke it.</span>
      </p>
    </section>
  );
}


/** Below the hero every box is rounded up to whole 30px cells by GridFrame; spacing is in home.css. */
function Row({ cols, className, children }: { cols?: string; className?: string; children: React.ReactNode }) {
  return <div className={cn("vg-row", cols && `vg-cols ${cols}`, className)}>{children}</div>;
}

/** An empty band of grid between two sections. */
function Gap() {
  return <div aria-hidden="true" className="vg-gap" />;
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
      <Row cols="vg-c-list">
        <div className="vg-cell vg-top">
          <div className="vg-sticky">
            <h2 id="start-title" className="vg-h2 vg-h2-cell">
              Every push to GitHub goes live on your Nest.
            </h2>
          </div>
        </div>
        <ol className="vg-stack">
          {SETUP.map(([title, text], i) => (
            <li key={title} className={cn("vg-cell", i === 0 && "vg-top")}>
              <h3 className="vg-h3">
                <span className="mr-3 inline-block w-4 tabular text-muted-foreground">{i + 1}</span>
                {title}
              </h3>
              <p className="vg-p">{text}</p>
            </li>
          ))}
          <li className="vg-cell">
            <p className="vg-code vg-ink">$ git push</p>
            <p className="vg-p mt-2">After that, every push to your production branch deploys on its own.</p>
          </li>
        </ol>
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

function Product() {
  return (
    <section id="product" aria-labelledby="product-title" className="vg-sec scroll-mt-15">
      <Row>
        <div className="vg-cell vg-head vg-mid">
          <h2 id="product-title" className="vg-h2">
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
      <Row cols="vg-c-half">
        <div className="vg-cell">
          <p className="vg-lead">
            <strong>Previews.</strong> Any branch that is not production builds a preview on its own port, from{" "}
            {F.previewPortMin}. A pull request from the same repository gets one too, with a comment that updates
            as it finishes.
          </p>
        </div>
        <div className="vg-cell">
          <p className="vg-lead">
            <strong>Rollbacks.</strong> Production keeps your last {numberWord(F.releasesKept)} releases on the
            container. Rolling back switches to one of them, so nothing is rebuilt.
          </p>
        </div>
      </Row>
      <Row cols="vg-c-half">
        <div className="vg-cell">
          <p className="vg-lead">
            <strong>No config file.</strong> Egg reads your repo and picks the install, build and start commands.
            You can write your own for anything else.
          </p>
        </div>
        <div className="vg-cell vg-mid">
          {/* The longest command is wider than a phone: the list scrolls inside itself. */}
          <dl className="vg-code vg-scroll" tabIndex={0} aria-label="Default start commands">
            {(
              [
                ["Node.js", "npm start"],
                ["Python", "python3 app.py"],
                ["Static", `Egg static server on ${F.defaultPort}`],
              ] as const
            ).map(([runtime, command]) => (
              <div key={runtime} className="grid grid-cols-[72px_auto] gap-x-4">
                <dt className="text-muted-foreground">{runtime}</dt>
                <dd>{command}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Row>
    </section>
  );
}

function WhenItBreaks() {
  return (
    <section aria-labelledby="fail-title" className="vg-sec">
      <Row cols="vg-c-log">
        <div className="vg-solid vg-log order-2 lg:order-none">
          <BuildLogs deploymentId="sample" initialLines={SAMPLE_LOG} rawState="error" duration="48s" />
          <p className="vg-caption">Sample data</p>
        </div>
        <div className="vg-cell vg-top order-1 lg:order-none">
          <h2 id="fail-title" className="vg-h2 vg-h2-cell">
            A failed deploy puts the old release back.
          </h2>
          <div className="vg-items">
            <p className="vg-p">
              <strong>Health check.</strong> Egg waits up to {F.healthWaitSeconds} seconds for your app to answer
              on its port. If it never does, the previous release is put back.
            </p>
            <p className="vg-p">
              <strong>Logs.</strong> Build output streams to the page as it happens. Runtime logs come from your
              app&apos;s systemd service, and you can search or download them.
            </p>
            <p className="vg-p">
              <strong>Alerts.</strong> Egg checks each app every {F.checkIntervalMinutes} minutes. After{" "}
              {numberWord(F.failedChecksBeforeAlert)} failed checks in a row it tells you in Discord or Slack, if
              you gave the project a webhook.
            </p>
          </div>
        </div>
      </Row>
    </section>
  );
}

const TRUST: [string, string][] = [
  [
    "One key, only for Egg",
    "Each server gets its own ed25519 key, encrypted before it reaches the database. The first connection records Nest's host key, and if it ever changes Egg stops before sending anything.",
  ],
  [
    "Built on your container",
    "Your repo is built on your own Nest under a memory and CPU cap, or in GitHub Actions if you set that up. It is not built on the machine that runs Egg.",
  ],
  [
    "Terminal and file changes start off",
    `Both are off for every server until you turn them on, and that needs a Hack Club sign-in from the last ${F.reauthMinutes} minutes.`,
  ],
  [
    "Take access back any time",
    "Delete the key in your Nest dashboard. Egg's access ends at once, and your apps keep running.",
  ],
];

function Trust() {
  return (
    <section id="security" aria-labelledby="security-title" className="vg-sec scroll-mt-15">
      <Row cols="vg-c-list" className="vg-term vg-term-lead">
        <div className="vg-cell vg-head vg-mid">
          <h2 id="security-title" className="vg-h2 vg-h2-cell">
            The key can do what you can do.
          </h2>
        </div>
        <div className="vg-cell vg-mid">
          <p className="vg-lead vg-ink">
            SSH into Nest puts you in a root shell inside your own container, so the key Egg holds has the same
            reach. We say so before you add it.
          </p>
        </div>
      </Row>
      <dl>
        {TRUST.map(([name, text]) => (
          <Row key={name} cols="vg-c-list" className="vg-term">
            <dt className="vg-cell vg-h3">{name}</dt>
            <dd className="vg-cell vg-p">{text}</dd>
          </Row>
        ))}
      </dl>
      <Row cols="vg-c-list" className="vg-term vg-term-lead">
        <div className="vg-cell vg-mid">
          <p className="vg-p vg-ink">
            Egg is an independent project by a Hack Club member. It is not an official Hack Club product, and the
            Nest team does not run it.
          </p>
        </div>
        <div className="vg-cell vg-mid items-start">
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
      <Row cols="vg-c-list">
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

/** One row, left aligned. It does not repeat the hero. */
function Close() {
  return (
    <section aria-label="Get started" className="vg-sec">
      <Row cols="vg-c-half" className="vg-term vg-term-lead">
        <div className="vg-cell vg-head vg-mid">
          <p className="vg-lead vg-ink">Connect your Nest, then push.</p>
        </div>
        <div className="vg-cell vg-head flex flex-wrap items-center gap-3">
          <Link href="/login" className={cn(primary, "h-12 px-7 text-[15px]")}>
            Sign in with Hack Club
          </Link>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className={cn(secondary, "h-12 px-7 text-[15px]")}>
            View the source
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
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
        <Gap />
        <Product />
        <Gap />
        <WhenItBreaks />
        <Gap />
        <Trust />
        <Gap />
        <Faq />
        <Gap />
        <Close />
      </GridFrame>
    </div>
  );
}
