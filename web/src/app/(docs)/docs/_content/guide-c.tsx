import type { ReactNode } from "react";
import { repoLink } from "@/lib/developer";
import { REPO_URL } from "@/lib/site";
import { CodeBlock } from "../_components/code-block";
import { B, C, Callout, ExternalLink, H2, InternalLink, List, P, Section, Table } from "../_components/prose";
import { docsHref } from "../_data/nav";

/** The closer on every page: a short list of where to read next. */
const related = (pages: [string, string][]) => (
  <P>
    <B>Related:</B>{" "}
    {pages.map(([id, title], i) => (
      <span key={id}>
        {i > 0 ? ", " : ""}
        <InternalLink href={docsHref(id)}>{title}</InternalLink>
      </span>
    ))}
    .
  </P>
);

/**
 * Two pages for a person who is starting: the four chapters of the guided first-project tour in
 * text, and the short version of the self-hosting guide. The tour's own copy is in
 * `lib/onboarding.ts`; each step below starts with that copy word for word, and
 * `docs-facts.test.ts` fails if the two drift apart. Numbers are pinned there too.
 */

type TourStep = { title: string; body: string; more?: ReactNode };

/** One tour step as a list item: the tour's title and sentence, then what to press on the real screen. */
function Step({ step }: { step: TourStep }) {
  return (
    <li>
      <B>{step.title}</B> {step.body}
      {step.more ? <> {step.more}</> : null}
    </li>
  );
}

const CONNECT: TourStep[] = [
  {
    title: "Put your app on Nest.",
    body: "Egg builds your GitHub repository and runs it on your Nest container. It takes about five minutes.",
    more: "Egg signs in to your container over SSH with a key made only for it.",
  },
  {
    title: "Connect your container first.",
    body: "Egg needs a way in. This sets it up.",
    more: (
      <>
        On Projects, with no server yet, press <B>Connect a server</B>. That opens Connect.
      </>
    ),
  },
  {
    title: "Your Nest username.",
    body: "The name you log in with, as in ssh username@hackclub.app. Then press Create key.",
    more: (
      <>
        Type it in <B>Nest username</B>. The status reads “Waiting for the key”.
      </>
    ),
  },
  {
    title: "Add the key in Nest.",
    body: "Copy it, open the Nest dashboard, and paste it on the SSH Keys page. Then come back.",
    more: (
      <>
        Copy the <B>Public key</B> and press <B>Open the Nest dashboard</B>.
      </>
    ),
  },
  {
    title: "Test the connection.",
    body: "Egg connects once and checks what your container can run.",
    more: (
      <>
        Press <B>Test connection</B>.
      </>
    ),
  },
  {
    title: "Check the fingerprint.",
    body: "Compare it with the one Nest shows for your server. Confirm only if they match. Egg refuses any other key afterwards.",
    more: (
      <>
        This appears the first time, in the “Confirm host key” box. Press <B>Confirm host key</B> yourself; nothing
        confirms it for you.
      </>
    ),
  },
  {
    title: "Connected.",
    body: "Next, pick a repository.",
    more: "The status turns to “Connected”.",
  },
];

const IMPORT: TourStep[] = [
  {
    title: "Pick your repository.",
    body: "Search, then press one.",
    more: (
      <>
        This is the version when the GitHub app is already installed: find it under <B>GitHub account</B> and press{" "}
        <B>Import</B>.
      </>
    ),
  },
  {
    title: "Connect GitHub.",
    body: "This lets Egg read your repositories and deploy on every push.",
    more: (
      <>
        This is the version when the app is set up on this Egg but not installed for you. Press{" "}
        <B>Install the GitHub App</B>, share the repository, then come back.
      </>
    ),
  },
  {
    title: "Paste a repository URL.",
    body: "A public one works without any setup.",
    more: (
      <>
        This is the version when this Egg has no GitHub app at all, as in a copy you run yourself. Paste an address
        like <C>https://github.com/owner/name</C> and press <B>Continue</B>. Pushes will not deploy on their own.
      </>
    ),
  },
  {
    title: "Check what Egg found.",
    body: "It guessed the name, runtime and port from your repository. Change anything that is wrong.",
    more: (
      <>
        The port starts at <C>3000</C>. Your app has to listen on that port; see the note below.
      </>
    ),
  },
  {
    title: "Something is already on your container.",
    body: "Items marked as blocking stop the deploy until you deal with them. Egg never changes anything it did not create.",
    more: "This appears only when the page lists things already on the container, under “What is already on this container”.",
  },
  {
    title: "Deploy.",
    body: "Egg builds on your container and starts the app. You can watch it happen.",
    more: (
      <>
        Press <B>Deploy</B>. You land on the deployment page.
      </>
    ),
  },
];

const DEPLOY: TourStep[] = [
  {
    title: "Watch it build.",
    body: "This is the live output from your container. A first build usually takes a few minutes. You can leave this page; the tour will not block you.",
    more: (
      <>
        It is the <B>Build Logs</B> card.
      </>
    ),
  },
  {
    title: "Your app is running.",
    body: "It listens on port N inside your container. It has no web address yet. The next step gives it one.",
    more: "The state reads Ready. N is the port you chose.",
  },
  {
    title: "The build failed.",
    body: "Read the last lines of the log to see why. The troubleshooting page lists the usual causes.",
    more: "The state reads Error and your earlier release keeps running or is put back.",
  },
];

const ADDRESS: TourStep[] = [
  {
    title: "Choose an address.",
    body: "Use your-nest-name.hackclub.app (or a subdomain of it), which Nest hands out with no DNS setup, or a domain you own. Pick this project; the port is the one it listens on.",
    more: (
      <>
        Open Domains, fill in <B>Add a domain</B> and press <B>Add domain</B>.
      </>
    ),
  },
  {
    title: "Do this in Nest.",
    body: "Egg cannot change Nest’s routing, so this one step is yours. The steps below are exact: open the Domains page in the Nest dashboard and enter the same domain and port. Then come back and press Check.",
    more: "The steps are in the panel headed “Next: finish setup for” and your domain.",
  },
  {
    title: "Check it.",
    body: "Egg looks at DNS and tells you whether it points here.",
    more: (
      <>
        Press <B>Check</B>. The status moves from “Waiting for DNS” to “Active”.
      </>
    ),
  },
  {
    title: "Your app is live at the address you chose.",
    body: "What next: add environment variables, set up a deploy hook, turn on analytics.",
    more: "The deployment page then shows the address.",
  },
];

/** The tour's copy, exported so the test can check each step against `lib/onboarding.ts`. */
export const GETTING_STARTED_STEPS = { connect: CONNECT, import: IMPORT, deploy: DEPLOY, address: ADDRESS } as const;

export const GUIDE_C: Record<string, () => ReactNode> = {
  "getting-started": () => (
    <Section
      id="getting-started"
      intro="Follow the four chapters of the guided first-project tour in text: connect your container, import a repository, watch the first deployment and give it an address."
    >
      <P>
        This page follows the tour in order. Each item gives you the words the tour uses, then the button to press on
        the real screen, so you can read along as you work.
      </P>
      <P>You need three things before you start:</P>
      <List>
        <li>
          <B>A Nest container and your Nest username.</B> You use the name you log in with.
        </li>
        <li>
          <B>A GitHub repository.</B> You can import a public one by its address. A private one, and deploys on every
          push, need the GitHub app.
        </li>
        <li>
          <B>An app that listens on a port.</B> Egg sets <C>PORT</C> and <C>HOST</C> for it, so a static site needs no
          code for this.
        </li>
      </List>
      <Callout tone="note" title="Not on Nest?">
        If you run your own copy of Egg, or deploy to a server you own, some words differ, so the address chapter is
        the one to watch. Read <InternalLink href={docsHref("run-yourself")}>Run Egg yourself</InternalLink> first.
      </Callout>

      <H2 id="getting-started-connect" />
      <P>In this chapter you connect your container, so Egg can reach it and check what it can run.</P>
      <List ordered>
        {CONNECT.map((s) => (
          <Step key={s.title} step={s} />
        ))}
      </List>

      <H2 id="getting-started-import" />
      <P>In this chapter you point a project at your repository, so Egg can read it and you can check the settings.</P>
      <List ordered>
        {IMPORT.map((s) => (
          <Step key={s.title} step={s} />
        ))}
      </List>
      <Callout tone="warning" title="Your app has to listen on the right port">
        Egg starts your app with <C>PORT</C> set to the port you chose and <C>HOST</C> set to <C>0.0.0.0</C>. If your app
        binds only to <C>localhost</C>, the health check fails.
      </Callout>

      <H2 id="getting-started-deploy" />
      <P>In this chapter you start a release, so a build runs on your container.</P>
      <List ordered>
        {DEPLOY.map((s) => (
          <Step key={s.title} step={s} />
        ))}
      </List>
      <P>
        If the build fails, read the last lines of the log, then open the{" "}
        <InternalLink href={`${docsHref("troubleshooting")}#troubleshooting-build`}>troubleshooting page</InternalLink>{" "}
        for the usual causes.
      </P>

      <H2 id="getting-started-address" />
      <P>In this chapter you give the app a web address, so you can open it in a browser.</P>
      <List ordered>
        {ADDRESS.map((s) => (
          <Step key={s.title} step={s} />
        ))}
      </List>
      <P>
        The first page below walks the same path with every button, limit and error message. The others cover each part
        in full.
      </P>
      {related([
        ["quickstart", "Quick start"],
        ["servers", "Servers"],
        ["projects", "Projects and runtimes"],
        ["deployments", "Deployments"],
        ["domains", "Domains"],
      ])}
    </Section>
  ),

  "run-locally": () => (
    <Section
      id="run-locally"
      intro="Set up a working copy of Egg on your computer, start the development server, sign in, add sample data and run the checks."
    >
      <P>
        Run every command on this page in the <C>web</C> folder, unless it says otherwise. To use a copy without changing
        it, read <InternalLink href={docsHref("run-yourself")}>Run Egg yourself</InternalLink>.
      </P>
      <P>Work through these steps in order:</P>
      <List ordered>
        <li>Check your Node.js version and turn on corepack.</li>
        <li>Clone the repository and install the dependencies.</li>
        <li>Create <C>web/.env.local</C> with <C>pnpm run setup</C>.</li>
        <li>Start the development server and sign in.</li>
        <li>Seed sample data, then run the checks and the production build.</li>
      </List>

      <H2 id="run-locally-prereqs" />
      <P>
        You need Node.js 22.13 or newer and Git. The repository pins pnpm 11.20.0 in <C>package.json</C>, so that pnpm
        needs Node 22.13. This block checks your Node version, turns on corepack, which comes with Node and installs the
        pinned pnpm, then prints the pnpm version.
      </P>
      <CodeBlock label="Terminal" code={"node -v\ncorepack enable\npnpm -v"} />
      <P>If your computer blocks corepack, install pnpm from pnpm.io at the pinned version.</P>

      <H2 id="run-locally-install" />
      <P>You download the code and install its dependencies here.</P>
      <CodeBlock label="Terminal" code={`git clone ${REPO_URL}.git\ncd egg/web\npnpm install`} />

      <H2 id="run-locally-env" />
      <P>
        This block creates <C>web/.env.local</C> with a new <C>APP_SECRET</C> and <C>LOCAL_MODE_SECRET</C>, so it never
        overwrites a file that exists. Type <C>pnpm run setup</C>, not <C>pnpm setup</C>, which is a different pnpm
        command.
      </P>
      <CodeBlock label="Terminal" code="pnpm run setup" />
      <P>
        The file starts with the variables below. These are the ones the code reads for a local copy. The Hack Club and
        GitHub app values are optional and stay empty. See{" "}
        <InternalLink href={docsHref("selfhost")}>Running your own</InternalLink> for every setting.
      </P>
      <CodeBlock
        label=".env.local"
        code={[
          "APP_SECRET=<32 or more random characters>",
          "LOCAL_MODE_SECRET=<32 or more random characters>",
          "APP_URL=http://localhost:3000",
          "DATABASE_URL=file:./data/egg.db",
          "LOCAL_MODE=1",
          "DEV_LOGIN=0",
          "RUN_WORKER=1",
        ].join("\n")}
      />
      <List>
        <li>
          <C>APP_SECRET</C> seals the SSH keys and variables in your database, so back it up with{" "}
          <C>web/data/egg.db</C>.
        </li>
        <li>
          <C>APP_URL</C> is the address you open in the browser, and <C>pnpm egg start</C> uses its port for the server.
        </li>
        <li>
          <C>RUN_WORKER=1</C> runs the deployment queue inside the same process.
        </li>
      </List>

      <H2 id="run-locally-dev" />
      <P>
        This block starts the development server. It listens on <C>127.0.0.1</C> at port 3000, the Next.js default, and
        reloads when you edit code. Open <C>http://localhost:3000/login</C> in your browser, so you reach the dashboard
        and not the public home page at <C>/</C>.
      </P>
      <CodeBlock label="Terminal" code="pnpm dev" />
      <P>
        This block checks the computer first, then starts the server on the port in <C>APP_URL</C> and opens the
        browser. Ctrl+C stops either way of starting it.
      </P>
      <CodeBlock label="Terminal" code="pnpm egg start --dev" />
      <P>
        This block only checks the computer: Node.js, pnpm, <C>.env.local</C>, <C>APP_SECRET</C>, the port and the data
        folder. It starts nothing.
      </P>
      <CodeBlock label="Terminal" code="pnpm run doctor" />

      <H2 id="run-locally-devlogin" />
      <P>
        Development sign-in lets you in as a made-up user, so you need no Hack Club account. Add this line to{" "}
        <C>.env.local</C> and restart the server.
      </P>
      <CodeBlock label=".env.local" code="DEV_LOGIN=1" />
      <List>
        <li>
          You then see a <B>Development sign-in</B> form with a name (<C>dev</C> by default, 40 characters at most) and a{" "}
          <B>Sign in</B> button. Egg stores the user as <C>dev:</C> plus the lowercase name.
        </li>
        <li>
          It works only in development, so in a production build the form is hidden and the route answers 404, whatever{" "}
          <C>DEV_LOGIN</C> says.
        </li>
        <li>
          With <C>LOCAL_MODE=1</C> on, as <C>pnpm run setup</C> leaves it, the form also asks for the local password, so
          set one first with <B>Sign in on this computer</B> and the recovery key from <C>.env.local</C>.
        </li>
        <li>
          <B>Origin rule.</B> Egg refuses a browser write whose <C>Origin</C> is not the origin of <C>APP_URL</C> or of
          the address the request came to, so it answers 403 “Cross-origin request blocked”. Open the site at the
          address in <C>APP_URL</C>, and change <C>APP_URL</C> if you use another port. After sign-in Egg redirects to{" "}
          <C>APP_URL</C> followed by <C>/projects</C>.
        </li>
        <li>
          <C>pnpm run doctor</C> counts <C>DEV_LOGIN</C> as a way to sign in only with <C>--dev</C>.
        </li>
      </List>

      <H2 id="run-locally-demo" />
      <P>
        This block fills your local database with sample projects, deployments and charts for the <C>dev</C> user, so
        you can see a full dashboard. Sign in with the development form and the name <C>dev</C>. Every sample row id
        starts with <C>demo-</C>.
      </P>
      <CodeBlock label="Terminal" code="pnpm seed:demo" />
      <P>
        The sample server points at <C>127.0.0.1</C> port 1, so pages that read it live, such as the Service card and
        runtime logs, show a connection error. This block removes exactly the rows the script made.
      </P>
      <CodeBlock label="Terminal" code="pnpm seed:demo --reset" />

      <H2 id="run-locally-checks" />
      <P>This block runs every test once, with Vitest as the test runner.</P>
      <CodeBlock label="Terminal" code="pnpm test" />
      <P>This block runs the tests in one file, so replace the path with any test file you have.</P>
      <CodeBlock label="Terminal" code="pnpm test src/server/config.test.ts" />
      <P>This block runs the linter, then the TypeScript check, which writes no files.</P>
      <CodeBlock label="Terminal" code={"pnpm lint\npnpm typecheck"} />

      <H2 id="run-locally-build" />
      <P>
        This block makes the production build and starts it on <C>127.0.0.1</C>, at port 3000 unless <C>PORT</C> is
        set. Development sign-in is off in this build, so sign in with local mode or Hack Club.
      </P>
      <CodeBlock label="Terminal" code={"pnpm build\npnpm start"} />
      <P>
        <C>pnpm egg start</C> does the same with the computer check first. It builds the first time by itself and uses
        the port in <C>APP_URL</C>.
      </P>
      {related([
        ["run-yourself", "Run Egg yourself"],
        ["selfhost", "Running your own"],
      ])}
    </Section>
  ),

  "run-yourself": () => (
    <Section
      id="run-yourself"
      intro="Egg is open source, so you can run your own copy with or without a Hack Club account. This is the short version."
    >
      <P>
        The full guide is in the repository:{" "}
        <ExternalLink href={repoLink("docs/selfhost/README.md")}>docs/selfhost/README.md</ExternalLink>. It gives the
        exact steps for Windows, macOS and Linux, every setting, the GitHub app setup and a troubleshooting list. This
        page keeps to the choices that matter first.
      </P>

      <H2 id="run-yourself-modes" />
      <Table
        caption="Ways to run Egg"
        head={["Setup", "Who it is for", "Sign-in", "Start it with"]}
        rows={[
          [
            "On this computer",
            "One person, using Egg privately.",
            "A local password. No outside account.",
            <C key="a">pnpm egg start</C>,
          ],
          [
            "On your own server",
            "You, or a few people you trust, at a domain with HTTPS.",
            "Hack Club, or local mode for one owner behind your own access control.",
            <C key="b">docker compose up -d --build</C>,
          ],
          [
            "A shared instance",
            "Several people, each with their own account.",
            "Hack Club only. Without Hack Club there is one account.",
            "The same, with the Hack Club values set",
          ],
          [
            "A trial with a stand-in server",
            "You want to see a deploy work with no Nest account.",
            "Any of the above.",
            <C key="d">pnpm fake-nest</C>,
          ],
        ]}
      />
      <P>
        You need Node.js 22.13 or newer, pnpm and Git on the computer that runs Egg. That computer only clones the
        repository, packs the source and uploads it. The install and the build run on the server your app is deployed
        to, so Egg needs no Docker for a local copy. The server uses Docker Compose and Caddy, which gets and renews
        HTTPS by itself.
      </P>
      <P>
        Windows, macOS and Linux all work, but only Linux and macOS are in the automated checks. <C>pnpm fake-nest</C>{" "}
        needs WSL on Windows.
      </P>

      <H2 id="run-yourself-signin" />
      <P>Local mode lets you run without Hack Club. Follow these steps:</P>
      <List ordered>
        <li>
          <C>pnpm run setup</C> writes <C>.env.local</C> with <C>LOCAL_MODE=1</C> and a private{" "}
          <C>LOCAL_MODE_SECRET</C>. <C>pnpm egg start</C> does this for you if the file is missing.
        </li>
        <li>
          On your first visit, the login page asks for that secret as the <B>recovery key</B>, and for a new password of
          at least 12 characters. Press <B>Set password and sign in</B>.
        </li>
        <li>
          Later you enter the password and press <B>Sign in on this computer</B>. If you forget it, use{" "}
          <B>Reset with the recovery key</B>.
        </li>
      </List>
      <P>
        Egg stores only a salted hash of your password. Local mode makes one account, called Owner, and refuses to run
        when <C>APP_URL</C> is not localhost unless you set <C>LOCAL_MODE_ALLOW_REMOTE=1</C>, so use that only behind a
        VPN or an access proxy you control.
      </P>
      <List>
        <li>
          <B>Hack Club sign-in.</B> Set <C>HACKCLUB_CLIENT_ID</C> and <C>HACKCLUB_CLIENT_SECRET</C>, so anyone with a
          Hack Club account who can open your site gets their own account. Egg has no allow list.
        </li>
        <li>
          <B>Email and password.</B> The card on Account turns it on only within 5 minutes of a Hack Club sign-in, so it
          cannot be turned on without Hack Club. The local owner has no email address and cannot use it.
        </li>
        <li>
          <B>Confirming again.</B> Turning on Terminal or File changes needs a sign-in from the last 5 minutes. With
          local mode and no Hack Club, Egg counts you as signed in, so it does not ask. If you set Hack Club up as well,
          the local owner is sent to Hack Club, which cannot confirm it, so the switch stays off. Do not mix the two.
        </li>
      </List>
      <Callout tone="warning" title="One account without Hack Club">
        A production copy with no Hack Club has exactly one account, the local owner, so a second person cannot sign in.
        Set up
        Hack Club Auth, or run one copy of Egg for each person.
      </Callout>

      <H2 id="run-yourself-target" />
      <P>
        Egg reaches the server your apps run on by SSH, with a key made only for it. Egg was made for Hack Club Nest, so
        a server you own is not tested.
      </P>
      <List>
        <li>
          <B>Nest.</B> Enter your Nest username, paste the public key into the SSH Keys page of the Nest dashboard, and
          press Test connection.
        </li>
        <li>
          <B>Your own server.</B> Set <C>NEST_HOST</C> and <C>NEST_PORT</C> in <C>.env.local</C> before you add the server,
          use the SSH user as the username, and add the public key to that user’s <C>authorized_keys</C>. Egg writes system
          service files and runs <C>systemctl</C> without sudo, so it expects root and a running systemd. Not tested on
          other hosts.
        </li>
        <li>
          <B>Addresses.</B> The Domains page follows Nest’s rules, so on your own server put a reverse proxy in front of
          the app and keep its port closed to the internet.
        </li>
      </List>
      <P>
        GitHub is optional, so a public repository deploys from its address with no setup. Private repositories and
        deploys on push need a GitHub app that you create yourself. GitHub must be able to reach{" "}
        <C>/api/webhooks/github</C> on your Egg to send pushes, so a copy on localhost needs a tunnel for that, or you
        deploy by hand.
      </P>

      <Callout tone="warning" title="Rotate values used with public static sites">
        A public static deployment could once serve its <C>.env</C> file, so a value could be downloaded from{" "}
        <C>/.env</C>. If you ran one, rotate those values at their source and deploy again. Variables now live in the
        project’s <C>env/</C> folder on the server, outside every release, and the static server refuses any path that
        starts with a dot.
      </Callout>

      <H2 id="run-yourself-more" />
      <P>
        Read <ExternalLink href={repoLink("docs/selfhost/README.md")}>the full guide</ExternalLink> for each system, every
        setting and every error message. <ExternalLink href={repoLink("docs/design/self-host-gaps.md")}>What does not work
        yet without Hack Club or Nest</ExternalLink> is ranked, and{" "}
        <ExternalLink href={repoLink("docs/selfhost/customising.md")}>Customising</ExternalLink> covers the name, colours,
        ports and build memory.
      </P>
      {related([
        ["run-locally", "Run Egg locally"],
        ["selfhost", "Running your own"],
      ])}
    </Section>
  ),
};
