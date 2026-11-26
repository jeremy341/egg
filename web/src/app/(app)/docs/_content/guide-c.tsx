import type { ReactNode } from "react";
import { repoLink } from "@/lib/developer";
import { B, C, Callout, ExternalLink, H2, InternalLink, List, P, Section, Table } from "../_components/prose";
import { docsHref } from "../_data/nav";

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
      intro="The four chapters of the guided first-project tour, in text: connect your container, import a repository, watch the first deployment and give it an address."
    >
      <P>
        The tour has four chapters, and this page follows them in order. Each item starts with the words the tour
        uses, then says which button on the real screen to press.
      </P>
      <P>You need three things before you start:</P>
      <List>
        <li>
          <B>A Nest container and your Nest username.</B> The username is the name you log in with.
        </li>
        <li>
          <B>A GitHub repository.</B> A public one can be imported by its address. A private one, and deploys on every
          push, need the GitHub app.
        </li>
        <li>
          <B>An app that listens on a port.</B> Egg sets <C>PORT</C> and <C>HOST</C> for it. A static site needs no code
          for this.
        </li>
      </List>
      <Callout tone="note" title="Not on Nest?">
        If you run your own copy of Egg, or deploy to a server you own, the steps are close but some words differ. Read{" "}
        <InternalLink href={docsHref("run-yourself")}>Run Egg yourself</InternalLink> first. The address chapter is the
        one that differs most.
      </Callout>

      <H2 id="getting-started-connect" />
      <P>The goal: Egg can reach your container and has checked what it can run.</P>
      <List ordered>
        {CONNECT.map((s) => (
          <Step key={s.title} step={s} />
        ))}
      </List>

      <H2 id="getting-started-import" />
      <P>The goal: a project that points at your repository, with settings you have checked.</P>
      <List ordered>
        {IMPORT.map((s) => (
          <Step key={s.title} step={s} />
        ))}
      </List>
      <Callout tone="warning" title="Your app has to listen on the right port">
        Egg starts your app with <C>PORT</C> set to the port you chose and <C>HOST</C> set to <C>0.0.0.0</C>. An app that
        binds only to <C>localhost</C> cannot be reached, and the health check fails.
      </Callout>

      <H2 id="getting-started-deploy" />
      <P>The goal: a release that is running on your container.</P>
      <List ordered>
        {DEPLOY.map((s) => (
          <Step key={s.title} step={s} />
        ))}
      </List>
      <P>
        If it fails, the{" "}
        <InternalLink href={`${docsHref("troubleshooting")}#troubleshooting-build`}>troubleshooting page</InternalLink>{" "}
        lists the usual causes of a failed build.
      </P>

      <H2 id="getting-started-address" />
      <P>The goal: a web address that opens your app.</P>
      <List ordered>
        {ADDRESS.map((s) => (
          <Step key={s.title} step={s} />
        ))}
      </List>
      <P>
        <B>Related:</B> <InternalLink href={docsHref("quickstart")}>Quick start</InternalLink> has the same path with
        every button, limit and error message. <InternalLink href={docsHref("servers")}>Servers</InternalLink>,{" "}
        <InternalLink href={docsHref("projects")}>Projects and runtimes</InternalLink>,{" "}
        <InternalLink href={docsHref("deployments")}>Deployments</InternalLink> and{" "}
        <InternalLink href={docsHref("domains")}>Domains</InternalLink> cover each part in full.
      </P>
    </Section>
  ),

  "run-yourself": () => (
    <Section
      id="run-yourself"
      intro="Egg is open source. You can run your own copy, with or without a Hack Club account. This is the short version."
    >
      <P>
        The full guide is in the repository:{" "}
        <ExternalLink href={repoLink("docs/selfhost/README.md")}>docs/selfhost/README.md</ExternalLink>. It has the exact
        steps for Windows, macOS and Linux, every setting, the GitHub app setup and a troubleshooting list. This page
        keeps to the choices that matter first.
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
        to, so Egg needs no Docker for a local copy. The server setup uses Docker Compose and Caddy, which gets and
        renews HTTPS by itself.
      </P>
      <P>
        Windows, macOS and Linux all work. Only Linux and macOS are in the automated checks. <C>pnpm fake-nest</C> needs
        WSL on Windows.
      </P>

      <H2 id="run-yourself-signin" />
      <P>Local mode is how you run without Hack Club. In short:</P>
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
        Egg stores only a salted hash of the password. Local mode makes one account, called Owner. It refuses to run when{" "}
        <C>APP_URL</C> is not localhost, unless you also set <C>LOCAL_MODE_ALLOW_REMOTE=1</C>. Use that only behind a VPN or
        an access proxy you control.
      </P>
      <List>
        <li>
          <B>Hack Club sign-in.</B> Set <C>HACKCLUB_CLIENT_ID</C> and <C>HACKCLUB_CLIENT_SECRET</C>. Anyone with a Hack
          Club account who can open your site can then sign in and gets their own account. Egg has no allow list.
        </li>
        <li>
          <B>Email and password.</B> The card on Account turns it on only within 5 minutes of a Hack Club sign-in, so it
          cannot be turned on without Hack Club. The local owner has no email address and cannot use it.
        </li>
        <li>
          <B>Confirming again.</B> Turning on Terminal or File changes needs a sign-in from the last 5 minutes. With local
          mode and no Hack Club, Egg counts you as signed in and does not ask. If you set Hack Club up as well, the
          local owner is sent to Hack Club, which cannot confirm it, and the switch stays off. Do not mix the two.
        </li>
      </List>
      <Callout tone="warning" title="One account without Hack Club">
        A production copy with no Hack Club has exactly one account, the local owner. For more than one person, set up
        Hack Club Auth, or run one copy of Egg for each person.
      </Callout>

      <H2 id="run-yourself-target" />
      <P>
        Egg reaches the server your apps run on by SSH, with a key made only for it. Hack Club Nest is what Egg was made
        for. A server you own is not tested.
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
          <B>Addresses.</B> The Domains page follows Nest’s rules. On your own server, put your own reverse proxy in front
          of the app and keep its port closed to the internet.
        </li>
      </List>
      <P>
        GitHub is optional. A public repository deploys from its address without any setup. Private repositories and
        deploys on push need a GitHub app that you create yourself. GitHub must be able to reach{" "}
        <C>/api/webhooks/github</C> on your Egg to send pushes, so a copy on localhost needs a tunnel for that, or you
        deploy by hand.
      </P>

      <Callout tone="warning" title="Rotate values used with public static sites">
        Before variables moved out of the release folder, a public static deployment could serve its <C>.env</C> file, so
        a value could be downloaded from <C>/.env</C>. If you ran one, rotate those values at their source and deploy
        again. Variables now live in the project’s <C>env/</C> folder on the server, outside every release, and the
        static server refuses any path that starts with a dot.
      </Callout>

      <H2 id="run-yourself-more" />
      <List>
        <li>
          <ExternalLink href={repoLink("docs/selfhost/README.md")}>The full guide</ExternalLink>, for each system, every
          setting and every error message.
        </li>
        <li>
          <InternalLink href={docsHref("selfhost")}>Running your own</InternalLink>, the reference page in these docs.
        </li>
        <li>
          <ExternalLink href={repoLink("docs/design/self-host-gaps.md")}>What does not work yet without Hack Club or Nest</ExternalLink>
          , ranked.
        </li>
        <li>
          <ExternalLink href={repoLink("docs/selfhost/customising.md")}>Customising</ExternalLink>, for the name, colours,
          ports and build memory.
        </li>
      </List>
    </Section>
  ),
};
