import type { ReactNode } from "react";
import { B, C, Callout, H2, H3, InternalLink, List, P, Section, Table } from "../_components/prose";
import {
  Limits,
  Steps,
  WhatCanGoWrong,
  WorkedExample,
  type LimitItem,
  type ProblemItem,
  type StepItem,
} from "../_components/worked-example";
import { docsHref, getSection } from "../_data/nav";

// Small adapters so each page below reads as data. Every block takes the
// page id for unique heading ids. A page with nav subsections nests its
// blocks one level down (h3) so the heading order stays right.
const levelOf = (page: string) => (getSection(page)?.subsections.length ? 3 : 2);

type Step = { title: string; body?: ReactNode; code?: StepItem["code"]; path?: string[] };
const toStep = (s: Step): StepItem => ({ title: s.title, children: s.body, code: s.code, path: s.path });

const steps = (page: string, items: Step[]) => (
  <Steps id={`${page}-steps`} items={items.map(toStep)} level={levelOf(page)} />
);

const limits = (page: string, rows: [string, string, ReactNode, string?][]) => {
  const items: LimitItem[] = rows.map(([name, value, atLimit, source]) => ({
    name,
    source,
    value,
    atLimit,
  }));
  return (
    <Limits id={`${page}-limits`} items={items} level={levelOf(page)}>
      These numbers are read from the code that enforces them. Under each message is the file that holds the number,
      relative to the web/src folder.
    </Limits>
  );
};

/** The short reason behind a choice that is not obvious. */
const why = (children: ReactNode) => (
  <Callout tone="note" title="Why it works this way">
    {children}
  </Callout>
);

/** A message (starts with a quote or a number) shows as code; a description shows as text. */
const wrong = (page: string, rows: [string, ReactNode][]) => {
  const items: ProblemItem[] = rows.map(([symptom, fix]) => ({
    symptom: /^[“0-9]/.test(symptom) ? symptom : <span>{symptom}</span>,
    fix,
  }));
  return <WhatCanGoWrong id={`${page}-wrong`} items={items} level={levelOf(page)} />;
};

const example = (
  page: string,
  e: { title: string; given: ReactNode; steps: Step[]; result: ReactNode }
) => (
  <WorkedExample
    id={`${page}-example`}
    title={e.title}
    given={e.given}
    steps={e.steps.map(toStep)}
    result={e.result}
    level={levelOf(page)}
  />
);

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
 * The core feature guides. Every number here is read from the code that
 * enforces it (the file is named in the docs inventory), and every message is
 * quoted as the product prints it. Titles come from `_data/nav.ts`.
 */
export const GUIDE_A: Record<string, () => ReactNode> = {
  overview: () => (
    <Section
      id="overview"
      intro="Egg builds your GitHub repository and runs it on your Nest container as a service. It is an independent project, not an official Hack Club product."
    >
      <P>
        Nest gives each member a small Linux container that you reach over SSH. Egg connects with a key
        you control, uploads a finished build and runs it as a systemd service on a port. Nest’s own proxy then
        maps your domain to that port. Egg does the work you would otherwise do by hand in a terminal.
      </P>
      <P>
        You need a Hack Club account, a Nest container and a GitHub repository. Nothing else is installed on
        your container ahead of time.
      </P>
      <H3 id="overview-push" />
      {steps("overview", [
        {
          title: "GitHub tells Egg about the push",
          body: (
            <>
              GitHub sends the push to Egg with a signed request. Only projects that match the
              repository and have <B>Deploy automatically on push</B> turned on get a deployment.
            </>
          ),
        },
        {
          title: "The deployment joins a queue",
          body: (
            <>
              A worker picks up queued deployments, two at a time by default. It never runs two deployments of
              the same project together.
            </>
          ),
        },
        {
          title: "The worker builds in a sandbox",
          body: (
            <>
              It clones the branch, then runs your install and build commands inside a Docker container on the
              Egg side, with 2 GB of memory by default (you can change it per server on the Container page) and 2 CPUs.
              Your container’s memory stays free for your app.
            </>
          ),
        },
        {
          title: "The release goes to your container",
          body: (
            <>
              The build is packed into one archive and uploaded over SSH into its own folder. Production
              dependencies are installed there and your environment variables are written to a file that only
              the service reads.
            </>
          ),
        },
        {
          title: "The service switches over",
          body: (
            <>
              For production, the <C>current</C> link points at the new release and the service restarts. A
              preview starts its own service on its own port.
            </>
          ),
        },
        {
          title: "Egg waits for an answer",
          body: (
            <>
              It checks the app on its port for up to 45 seconds. If it never answers, the previous release is
              switched back on and the deployment is marked Error.
            </>
          ),
        },
      ])}
      <P>
        Pushes to your production branch go live. Pushes to any other branch build a preview on a port of its
        own. The source folder in the worker is deleted when the deployment ends.
      </P>
      <Callout tone="note" title="What it does not do">
        It does not run databases, give a preview a public address on its own, or promise that any application
        works on Nest. It runs the runtimes listed under Projects and runtimes, and any start command that
        listens on the <C>PORT</C> it is given. A Dockerfile in your repository is ignored: Egg
        does not build Docker images.
      </Callout>
      {limits("overview",
        [
          ["Deployments per project at once", "One", "The others wait as Queued."],
          ["Deployments running at once, all projects", "2 by default", "The rest wait. A self-hosted worker can change this."],
          ["Clone", "5 minutes", "The deployment fails with “Could not clone the repository.”"],
          ["Build time", "15 minutes by default", "The deployment fails with “The build timed out.”"],
          ["Build sandbox", "2 GB memory, 2 CPUs", "A build that needs more fails inside the sandbox."],
          ["Build output", "500 MB", "The deployment fails with the size it found."],
          ["Wait for the app to answer", "45 seconds", "The release is marked Error and the previous one is restored."],
        ],
      )}
      {wrong("overview", [
        [
          "A push did not start a deployment",
          <>
            Open the project’s Settings, Build and Run, and check that <B>Deploy automatically on push</B> is
            ticked. A project made from a pasted public repository URL is never built by a push, because it
            does not store the repository name GitHub sends. Press Deploy, or use a deploy hook.
          </>,
        ],
        [
          "“The new release did not become healthy on port N. Make sure your app listens on the PORT environment variable and on 0.0.0.0.”",
          <>
            The app started but nothing answered on its port. Read the last log lines, fix the port or the
            address it binds to, and deploy again.
          </>,
        ],
        [
          "“The worker stopped while this deployment was running. Try again.”",
          <>
            The Egg worker restarted mid-build. Redeploy. A running job is treated as dead after one
            hour.
          </>,
        ],
      ])}
      {example("overview", {
        title: "Push a fix to a bot",
        given: (
          <>
            Sam has a Discord bot for sharing recipes in a repository called <C>sam-r/recipe-bot</C>. It runs on
            Node.js, and a Nest container called <C>sam-r</C> is already connected.
          </>
        ),
        steps: [
          { title: "Push to the production branch", body: <>Sam pushes a fix to <C>main</C> from a laptop.</> },
          { title: "Open the Deployments tab", body: <>Sam opens the project’s Deployments tab and watches the new row.</> },
        ],
        result: (
          <>
            A new deployment appears as Queued, then Building, then Deploying, then Ready. The Build Logs card
            shows the clone, the install and the build, and ends with the app answering on its port. The bot
            restarts with the fix and no one logged in to the container.
          </>
        ),
      })}
      {related([
        ["quickstart", "Quick start"],
        ["deployments", "Deployments"],
        ["github", "GitHub and previews"],
      ])}
    </Section>
  ),

  quickstart: () => (
    <Section
      id="quickstart"
      intro="From nothing to a running app on your Nest container, in four steps. Every button name here is the one on screen."
    >
      <P>
        Egg signs in to your Nest container with a key made only for it, builds your GitHub repository on its own
        side, copies the finished build to the container and runs it there as a service. This page is the shortest
        path through that. Each part has its own page with the full detail.
      </P>
      <P>You need four things before you start:</P>
      <List>
        <li>
          <B>A Hack Club account.</B> Sign-in is with Hack Club, and Hack Club only confirms who you are.
        </li>
        <li>
          <B>A Nest container and your Nest username.</B> This is the name you log in with, as in{" "}
          <C>ssh username@hackclub.app</C>.
        </li>
        <li>
          <B>A GitHub repository.</B> A public one can be imported by its address. A private one, and automatic
          deploys on push, need the Egg GitHub app installed on it.
        </li>
        <li>
          <B>An app that listens on a port.</B> See the warning below. A static site is served for you, so it needs
          no code for this.
        </li>
      </List>
      {steps("quickstart", [
        {
          title: "Sign in",
          body: (
            <>
              Open the log in page and press <B>Continue with Hack Club</B>. Approve the sign-in at Hack Club and
              you land on Projects. A new account sees “Connect your Nest container first” with a{" "}
              <B>Connect a server</B> button. The sign-in lasts 30 days, and the handshake with Hack Club has to
              finish within 10 minutes in one browser.
            </>
          ),
        },
        {
          title: "Connect your server",
          body: (
            <>
              Open Connect, titled “Connect a Nest server”. Under <B>Add your server</B>, type your Nest username
              in <B>Nest username</B> and press <B>Create key</B>. The status reads “Waiting for the key”. Copy
              the <B>Public key</B>, press <B>Open the Nest dashboard</B> and paste the key on the SSH Keys page
              there. Come back and press <B>Test connection</B>. The first time, check the fingerprint
              in the “Confirm host key” box and press <B>Confirm host key</B>. The status turns to “Connected” and a
              “Reached your container” panel appears.
            </>
          ),
        },
        {
          title: "Import a repository",
          body: (
            <>
              Press <B>New project</B>, which opens “Let’s build something new”. Press <B>Install the GitHub App</B>,
              share the repository, then pick it under <B>GitHub account</B> and press <B>Import</B>. To use a
              public repository without the app, paste its address under “Or use a public repository URL” and
              press <B>Continue</B>. While Egg reads the repository the page says “Looking at the repository…”.
              Then press <B>Use these settings</B> under “We found” to fill in the runtime and commands it
              detected. That button only appears when a runtime was recognised.
            </>
          ),
        },
        {
          title: "Check the form and deploy",
          body: (
            <>
              Check <B>Nest server</B>, <B>Project name</B>, <B>Application preset</B>, <B>Production branch</B>,{" "}
              <B>Root directory</B> and <B>Port your app listens on</B>. The port starts at <C>3000</C>. Fill in
              any <B>Environment variables</B> the example env file asked for; an empty field is skipped. Watch
              the “What is already on this container” panel. If a line there carries the badge “Blocks the
              deploy”, the button stays off until you fix it. Press <B>Deploy</B>. The button reads “Starting
              deployment…” and you land on the deployment page.
            </>
          ),
        },
        {
          title: "Watch the first deployment",
          body: (
            <>
              The <B>Build Logs</B> card streams the clone, the install and the build, then the upload and the
              start. When the state reads Ready, the app is running on your container, and the log ends with “Live
              on port N. Map your domain to this port in the Nest dashboard.” Pushes to the production branch
              deploy on their own from now on.
            </>
          ),
        },
      ])}
      <Callout tone="warning" title="Your app has to listen on the right port">
        Egg starts your app with <C>PORT</C> set to the port you chose and <C>HOST</C> set to <C>0.0.0.0</C>.
        Listen on both. An app that binds only to <C>localhost</C> cannot be reached, and the health check fails
        after 45 seconds. A bot that opens no port still needs a tiny web server so the check has something to
        answer.
      </Callout>
      {why(
        <>
          Egg judges a release by asking the app a question on its port: it requests the health check path, which is{" "}
          <C>/</C> unless you change it, and a status from 200 to 499 counts as up. A program that never opens a
          port can never answer, so the check can only fail, and then the previous release is put back. That is
          also why it waits for an answer before it calls a deployment Ready: Ready means “answering”, not just
          “started”.
        </>
      )}
      {limits("quickstart", [
        ["Servers per account", "5", "“You can connect up to 5 servers.”", "server/servers.ts"],
        [
          "Nest username",
          "Letters, digits, dot, underscore and hyphen; 1 to 32 characters; starts with a letter or digit",
          "“That does not look like a Nest username. Use the name you log in with, for example sam-r.”",
          "server/servers.ts",
        ],
        [
          "Project name",
          "1 to 60 characters. Its address-safe form is lowercase letters, digits and hyphens, up to 40",
          "“The project name must use lowercase letters, digits and hyphens (up to 40).”",
          "server/projects.ts and server/deploy/layout.ts",
        ],
        [
          "Port",
          "1024 to 65535, and not 20000 to 29999",
          "20000 to 29999 is kept for previews. The form allows a lower port; the server refuses it with “port: Too small: expected number to be >=1024”.",
          "server/projects.ts",
        ],
        [
          "Public repository address",
          "https://github.com/owner/name",
          "“Enter a GitHub repository URL such as https://github.com/owner/name”",
          "components/new-project-flow.tsx",
        ],
        ["Clone", "5 minutes", "The deployment fails with “Could not clone the repository.”", "server/deploy/build.ts"],
        [
          "Build time",
          "15 minutes by default",
          "The deployment fails with “The build timed out.”",
          "server/config.ts, BUILD_TIMEOUT_SECONDS",
        ],
        ["Wait for the app to answer", "45 seconds", "The deployment ends as Error and the previous release is put back.", "server/deploy/pipeline.ts"],
        ["Container checks while you fill the form", "20 a minute", "“Too many checks. Wait N seconds and try again.”", "app/api/projects/conflicts/route.ts"],
      ])}
      {wrong("quickstart", [
        [
          "“Hack Club sign-in is not set up on this installation yet.”",
          <>This copy of Egg has no Hack Club app configured, so the button is off. Only the person running it can fix that.</>,
        ],
        [
          "“You did not approve the sign-in. Try again when you are ready.”",
          <>You pressed cancel at Hack Club. Press Continue with Hack Club again.</>,
        ],
        [
          "“The sign-in took too long or came from another browser. Please try again.”",
          <>Start again from the log in page, in one browser, and finish within 10 minutes.</>,
        ],
        [
          "“That sign-in link was not valid. Please try again.” or “Hack Club could not sign you in. Please try again in a moment.”",
          <>Try again. If it repeats, Hack Club may be having a problem.</>,
        ],
        [
          "“Connect a server first”",
          <>
            You have no connected server yet, so there is nowhere to deploy. Press <B>Connect a server</B>.
          </>,
        ],
        [
          "The Connect page shows “Could not connect”",
          <>
            Read the red message under the server name. Most often the public key was not pasted on the SSH Keys
            page, or the username is not exactly your Nest username. The Servers page lists each message.
          </>,
        ],
        [
          "“Could not read this repository. If it is private, install the GitHub App so it can be read. You can still set everything by hand.”",
          <>The repository is private or the name is wrong. Install the GitHub app on it, or set the fields yourself.</>,
        ],
        [
          "“Port N is already used by another project on this server.”",
          <>Each project on a server needs its own port. Pick another one.</>,
        ],
        [
          "“Deploy is turned off because N things on this container are in the way.”",
          <>
            The container already holds a service, folder or program that Egg did not create. It will not stop or
            change it. Change the project name or port, or deal with it yourself. Projects has the full
            explanation.
          </>,
        ],
        [
          "“The project was created, but NAME was not saved: reason. Press Deploy to try again.”",
          <>The project exists. Press Deploy again; it does not create a second one.</>,
        ],
        [
          "“The new release did not become healthy on port N. Make sure your app listens on the PORT environment variable and on 0.0.0.0.”",
          <>The app started but nothing answered. Read the last log lines, fix the port or the address, and deploy again.</>,
        ],
      ])}
      {example("quickstart", {
        title: "Put recipe-bot online",
        given: (
          <>
            Sam has <C>sam-r/recipe-bot</C>, a Node.js Discord bot with a <C>start</C> script. The bot only talks
            out to Discord, so Sam adds a small web server that answers on the port Egg gives it. Sam’s Nest
            username is <C>sam-r</C>.
          </>
        ),
        steps: [
          {
            title: "Add a tiny web server",
            body: (
              <>
                Sam adds this line to <C>index.js</C> and pushes it:{" "}
                <C>{`http.createServer((_, res) => res.end("ok")).listen(process.env.PORT, "0.0.0.0")`}</C>.
              </>
            ),
          },
          { title: "Sign in and connect", body: <>Sam presses Continue with Hack Club, then creates a key for <C>sam-r</C>, pastes it in Nest and presses Test connection.</> },
          { title: "Import", body: <>Sam presses New project, installs the GitHub app on <C>recipe-bot</C>, presses Import and presses Use these settings. The summary said Node.js with npm.</> },
          { title: "Keep the defaults", body: <>Sam keeps the production branch <C>main</C> and the port <C>3000</C>, and presses Deploy.</> },
        ],
        result: (
          <>
            The deployment goes Queued, Building, Deploying, Ready. The Build Logs card ends with “Live on port
            3000. Map your domain to this port in the Nest dashboard.” The project’s Service card shows Running,
            and the Logs page shows the line the bot prints when it logs in to Discord.
          </>
        ),
      })}
      {related([
        ["servers", "Servers"],
        ["projects", "Projects and runtimes"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),

  servers: () => (
    <Section
      id="servers"
      intro="A server is one Nest account. You can connect up to five, and each has its own projects and usage."
    >
      <P>
        Connecting a server gives Egg a way into your Nest container and nothing else. You make a key, paste its
        public half into the Nest dashboard, and Egg uses that key to deploy, restart and read logs. You need a
        Nest account and your Nest username, the name you log in with, for example <C>sam-r</C>.
      </P>
      <H3 id="servers-connection" />
      <P>
        Egg makes a dedicated ed25519 key for each server and uses it for nothing else. The key’s comment reads{" "}
        <C>egg:</C> followed by your username. You paste the public half into the Nest dashboard. Nest’s
        bastion routes the connection to your container as <C>root</C>, so this key can do anything you can do
        there. The page says so before you add it: “This key gives Egg the same access as your own login,
        because SSH into Nest lands in a root shell inside your container. Only connect a container you are happy
        to deploy to.”
      </P>
      <P>
        The private key is sealed with AES-256-GCM, tied to that server, before it is stored. It is never shown.
        The first time you press Test connection, Egg reaches the host, reads its host key, hangs up and shows the
        SHA-256 fingerprint under “Confirm host key”. Nothing is sent to the server until you press{" "}
        <B>Confirm host key</B>. The fingerprint is then recorded, and any other host key stops the connection
        before anything is sent. Until it is confirmed, no deploy, file change or terminal can connect. The
        address is <C>hackclub.app</C> on port 22. A self-hosted copy can change both with the{" "}
        <C>NEST_HOST</C> and <C>NEST_PORT</C> settings.
      </P>
      {why(
        <>
          A key made for one server means you can end Egg’s access without touching your own login: delete the key
          in the Nest dashboard and access stops at once. Pinning the host key matters because Egg sends your
          environment variables and your build to whatever answers. If something else answers, the connection stops
          instead of handing it over.
        </>
      )}
      {steps("servers", [
        {
          title: "Create the key",
          body: (
            <>
              Open Connect. Under <B>Add your server</B> (the heading reads “Add another server” once you have
              one), type your Nest username in <B>Nest username</B> and press <B>Create key</B>. The status reads
              “Waiting for the key”, and the card shows the <B>Public key</B>.
            </>
          ),
        },
        {
          title: "Paste it into Nest",
          body: (
            <>
              Copy the <B>Public key</B> field with its copy button. Press <B>Open the Nest dashboard</B>, which
              opens <C>dashboard.hackclub.app</C> in a new tab, and paste the key on the SSH Keys page.
            </>
          ),
        },
        {
          title: "Test the connection",
          body: (
            <>
              Back on Connect, press <B>Test connection</B>. The button reads “Connecting…”. The first time, the
              page stops at a “Confirm host key” box that says “This is the first connection to NAME.hackclub.app”
              and shows a fingerprint. Check that it matches the one Nest shows for your server, then press{" "}
              <B>Confirm host key</B> (“Confirming…”). Egg then reads your container. On success the
              status reads “Connected” and a “Reached your container” panel lists System, Logged in as, Node.js,
              Python, systemd and Key fingerprint. That last row is the fingerprint of the key Egg made, not of
              Nest’s host key. If a tool is missing, the panel shows “not installed” for it.
            </>
          ),
        },
        {
          title: "Read the warnings",
          body: (
            <>
              Under the panel, red and amber boxes list anything missing on your container. The table below says
              what each one means.
            </>
          ),
        },
      ])}
      <H3 id="servers-manage" />
      <List>
        <li>
          <B>Test connection</B> opens an SSH session, asks you to confirm the host key the first time, and reads
          what your container has: operating system, user, Node.js and Python versions, which tools exist,
          systemd, CPU, memory and disk. It can be pressed at any time. A failure saves the message and the status
          becomes “Could not connect”; the next success clears it.
        </li>
        <li>
          <B>New key</B> replaces the key pair. A dialog titled “Generate a new key?” says “The old key stops
          working once you remove it in the Nest dashboard, and you must add the new one.” Confirm with{" "}
          <B>Generate key</B>. Egg uses the new private key from that moment, so deploys fail with “Nest rejected
          the key” until you paste the new public key and test again. The server goes back to “Waiting for the key”
          and the saved reading is cleared. The pinned host key is kept. Remove the old public key in the Nest
          dashboard to end its access. The change is recorded in Activity.
        </li>
        <li>
          <B>Disconnect</B> opens “Disconnect NAME?”, with the text “This closes its terminals and removes our key
          for it. Your running apps are not touched. Remove the key from the Nest dashboard to end our access.” If
          the server has projects, the dialog also shows a checkbox, “Also delete the project on this server” or
          “Also delete the N projects on this server”, which starts unticked. Unticked, the projects are kept:
          “Their apps keep running, but Egg stops managing them until you connect this server again.” Ticked, they
          are deleted with their deployments, logs, environment variables, hook and status page, and the apps still
          keep running on the container. Either way Egg’s key is removed, any terminal open on that server closes,
          and the change is recorded in Activity.
        </li>
      </List>
      <Callout tone="note" title="Coming back after a disconnect">
        A disconnected server drops out of the list and no longer counts toward the limit of five. Its kept projects
        stay in Egg but cannot be deployed or read: any attempt answers “NAME is disconnected. Connect it again to
        manage its projects.” To bring them back, add the same Nest username again on Connect. You get a new key and
        a new host key to confirm, and the kept projects attach to it. Egg never touches the apps on your container while
        the server is disconnected.
      </Callout>
      <Table
        caption="Warnings after a test"
        head={["Message", "Shown as", "What it means"]}
        rows={[
          [
            "systemd is not available in this container, so Egg cannot keep your apps running or restart them.",
            "Error",
            "Apps run as systemd services. Without it nothing can be started or restarted.",
          ],
          [
            "SSH did not log in as root. Nest normally does; without root, installing the service files may fail.",
            "Warning",
            "Writing the service file needs root.",
          ],
          [
            "tar is not installed.",
            "Error",
            "Releases are unpacked on the container with tar.",
          ],
          [
            "sha256sum is missing, so uploads cannot be verified.",
            "Warning",
            "The upload still goes through, without the checksum comparison.",
          ],
          [
            "curl is missing. Health checks fall back to a plain TCP connection check.",
            "Warning",
            "The health check only tests that the port accepts a connection, not what it answers.",
          ],
          [
            "Neither Node.js nor Python 3 is installed. Only projects that ship their own binary can run.",
            "Warning",
            "Node.js projects install their production dependencies on the container, Python projects create a virtual environment there, and static sites need one of the two to be served.",
          ],
          [
            "Only N MB of disk is free. Releases are kept for rollback, so deploys may fail.",
            "Warning",
            "Shown when under 1024 MB is free.",
          ],
        ]}
      />
      <P>
        These are warnings about your container. Egg only shows them. It does not stop a deploy because of one, so
        fix the ones that match what you want to run. After a test, the Projects page also shows a usage card with
        CPU load, memory and disk from that reading, or “No reading yet. Press Test connection on the Connect
        page.” when there is none. It shows the first connected server.
      </P>
      <Callout tone="note" title="Taking access back">
        Delete the key in your Nest dashboard. Access ends at once and your apps keep running, because they are
        ordinary services in your container.
      </Callout>
      <H2 id="servers-reference" title="Limits, errors and an example" />
      {limits("servers", [
        ["Servers per account", "5, not counting disconnected ones", "“You can connect up to 5 servers.”", "server/servers.ts, MAX_SERVERS_PER_USER"],
        [
          "Nest username",
          "Letters, digits, dot, underscore and hyphen; 1 to 32 characters; starts with a letter or digit",
          "“That does not look like a Nest username. Use the name you log in with, for example sam-r.”",
          "server/servers.ts",
        ],
        ["Servers per Nest username", "One per account", "“NAME is already connected.”", "server/servers.ts"],
        ["Connect timeout", "20 seconds", "“Timed out connecting to Nest. Your container may be stopped or starting; try again in a minute.”", "server/ssh/connection.ts"],
        ["Connection read", "30 seconds", "The test fails and the Connect page shows the error.", "server/ssh/probe.ts"],
        ["Host key", "Pinned when you confirm it on the first Test connection", "Until then nothing connects: a deploy answers “Confirm host key: open the Connect page, check the fingerprint of this server and confirm it first.” Any other key stops the connection. Only Disconnect, then adding the server again, clears the pin.", "server/servers.ts"],
        ["Free disk before a warning", "1024 MB", "An amber warning after a test.", "server/ssh/probe.ts"],
      ])}
      {wrong("servers", [
        [
          "“Nest rejected the key. Check that you pasted the public key on the SSH Keys page of the Nest dashboard, and that the username is exactly your Nest username.”",
          <>Paste the key again, copying the whole Public key field, and check the username. After New key, this is expected until the new key is pasted.</>,
        ],
        [
          "“Timed out connecting to Nest. Your container may be stopped or starting; try again in a minute.”",
          <>Wait, then press Test connection again.</>,
        ],
        [
          "“Could not reach the Nest SSH host (reason).”",
          <>The connection failed before login. Try again in a minute, and check that Nest itself is up.</>,
        ],
        [
          "“Confirm host key: open the Connect page, check the fingerprint of this server and confirm it first.”",
          <>
            The server has no confirmed host key yet, so a deploy, file change or terminal will not connect to it.
            Open Connect, press <B>Test connection</B> and then <B>Confirm host key</B>.
          </>,
        ],
        [
          "“The host key of HOST changed (was OLD, now NEW). Nothing was sent. If you expected this, reconnect the server.”",
          <>
            Egg refuses on purpose. If you know the host key changed, press <B>Disconnect</B> and add the server
            again. Leave the project checkbox unticked and the projects reattach, because Disconnect clears the
            pinned host key.
          </>,
        ],
        [
          "“SSH error: message”",
          <>Anything else the SSH library reported. The message is the clue; try the test again once.</>,
        ],
        [
          "“That does not look like a Nest username. Use the name you log in with, for example sam-r.”",
          <>Use the name you log in to Nest with, without <C>@hackclub.app</C>.</>,
        ],
        [
          "“You can connect up to 5 servers.” or “NAME is already connected.”",
          <>Disconnect one you no longer use, or use the server you already added.</>,
        ],
        [
          "“NAME is disconnected. Connect it again to manage its projects.”",
          <>The server was disconnected and its projects kept. Add the same Nest username again on Connect.</>,
        ],
      ])}
      {example("servers", {
        title: "Connect sam-r and replace the key",
        given: (
          <>
            Sam’s Nest username is <C>sam-r</C>. Sam has not connected a server yet. Two months later Sam shares a
            laptop and wants a fresh key.
          </>
        ),
        steps: [
          { title: "Create the key", body: <>Sam opens Connect, types <C>sam-r</C> and presses Create key.</> },
          { title: "Paste it in Nest", body: <>Sam pastes the public key on the Nest dashboard’s SSH Keys page.</> },
          { title: "Test and confirm", body: <>Sam presses Test connection, checks the fingerprint in the “Confirm host key” box and presses Confirm host key.</> },
          { title: "Replace the key later", body: <>Sam presses New key, then Generate key, pastes the new public key in Nest, removes the old one there and presses Test connection again.</> },
        ],
        result: (
          <>
            The first test shows “Reached your container” with the system, Node.js and systemd rows, and the status
            reads “Connected”. After the replacement the status goes to “Waiting for the key” and back to
            “Connected”. The host key was not asked for again, because it was confirmed the first time. Sam’s projects and apps were not touched.
          </>
        ),
      })}
      {related([
        ["quickstart", "Quick start"],
        ["projects", "Projects and runtimes"],
        ["security", "Security"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),

  projects: () => (
    <Section id="projects" intro="A project ties one GitHub repository to one app on one server.">
      <P>
        A project holds everything Egg needs to build and run one app: which repository and branch, which Nest
        server, which runtime and commands, which port, and the variables, hook and alerts that go with it. You
        need a connected server. A private repository, and automatic deploys on push, need the Egg GitHub app
        installed on the repository.
      </P>
      <H3 id="projects-settings" />
      {steps("projects", [
        {
          title: "Pick a repository",
          body: (
            <>
              Press <B>New project</B>. Pick the account under <B>GitHub account</B>, find the repository with{" "}
              <B>Search repositories…</B> and press <B>Import</B>. Or paste a public address under “Or use a public
              repository URL” and press <B>Continue</B>; it has to look like{" "}
              <C>https://github.com/owner/name</C>. A pasted address starts on your Default branch from Settings, which is <C>main</C> until you
              change it. With no
              server connected the page shows “Connect a server first”.
            </>
          ),
        },
        {
          title: "Read what Egg found",
          body: (
            <>
              The “We found” summary lists the package manager, runtime, install, build and start commands and
              output folder it read from the repository, with notes under them. Nothing is applied until you press{" "}
              <B>Use these settings</B>, which fills <B>Application preset</B> and the four command and folder
              fields. It does not touch the name, branch, root directory or port. If the repository holds several
              apps, “Apps in this repository” shows a button for each folder; pressing one sets the root
              directory.
            </>
          ),
        },
        {
          title: "Fill in the fields",
          body: (
            <>
              Choose <B>Nest server</B>, <B>Project name</B>, <B>Application preset</B> (Node.js, Python, Static
              site or Custom command), <B>Production branch</B>, <B>Root directory</B> and{" "}
              <B>Port your app listens on</B>. <B>Install command (optional)</B>, <B>Start command (optional)</B>,{" "}
              <B>Build command (optional)</B> and, for static sites, <B>Output directory</B> can stay empty to use
              the defaults. The project name is also the folder and service name on your container
              (<C>egg-NAME.service</C>), so the form only accepts lowercase letters, digits and hyphens and says
              “Use lowercase letters, numbers and hyphens.” otherwise.
            </>
          ),
        },
        {
          title: "Fill in variables and deploy",
          body: (
            <>
              If the repository has an example env file, an <B>Environment variables</B> group shows one empty
              field per name. A name with a value becomes a variable for All environments; an empty one is
              skipped. Press <B>Deploy</B>. The project is created, the values are saved and the first deployment
              is queued.
            </>
          ),
        },
        {
          title: "Change settings later",
          body: (
            <>
              Open the project, Settings, <B>Build and Run</B>, change a field and press <B>Save</B>. The page
              says “Saved. Changes apply to the next deployment.” The server and the repository cannot be changed.
              To move an app, make a new project.
            </>
          ),
        },
      ])}
      <Table
        caption="Project settings"
        head={["Setting", "What it does", "Default"]}
        rows={[
          ["Production branch", "A push here deploys to production. Any other branch builds a preview.", "The repository’s default branch; a pasted address starts at your Default branch from Settings (main unless you changed it)"],
          ["Root directory", "The folder inside the repository to build, for monorepos. For a subfolder, a help line shows what GitHub has there: package.json, Lockfile, requirements.txt and Start script.", <C key="r">.</C>],
          ["Runtime", "How to install, build and run it. See Runtimes.", "Node.js"],
          ["Install command, Build command, Start command", "Override a command. Each is one line of at most 500 characters.", "Detected from the runtime"],
          ["Output directory", "Static sites only: the folder to serve.", "The root"],
          ["Port", "The port the app listens on. Unique on a server.", <C key="p">3000</C>],
          ["Health check path", "The path requested to decide the app is up. Starts with a slash. It is not on the New project form, so set it in Settings.", <C key="h">/</C>],
          ["Deploy automatically on push", "Build on every push to a branch of the repository.", "On"],
        ]}
      />
      <P>The “We found” step reads the repository from GitHub before anything is created. This is what it looks at.</P>
      <List>
        <li>
          <B>Language.</B> A <C>package.json</C> means Node.js. Otherwise <C>requirements.txt</C> or{" "}
          <C>pyproject.toml</C> means Python. A <C>go.mod</C>, <C>Gemfile</C> or <C>Cargo.toml</C> is named as not
          supported yet, with a hint to try the Custom command preset. A <C>Dockerfile</C> is mentioned and ignored,
          because Egg does not build Docker images.
        </li>
        <li>
          <B>Package manager.</B> The <C>packageManager</C> field in <C>package.json</C>, else a lockfile
          (<C>pnpm-lock.yaml</C>, <C>yarn.lock</C>, <C>package-lock.json</C>, <C>bun.lock</C> or{" "}
          <C>bun.lockb</C>), else npm. More than one lockfile gives a warning to delete the ones you do not use.
          Bun is detected but not built yet. The build itself picks the package manager from the lockfile only, so
          keep the lockfile and the field in agreement.
        </li>
        <li>
          <B>Static site.</B> A Vite or Astro project with no <C>start</C> script is suggested as a Static site
          with output folder <C>dist</C>. A Node.js project with no <C>start</C> script gets the note “package.json
          has no &quot;start&quot; script. Add one, or set a start command yourself.”
        </li>
        <li>
          <B>Monorepo.</B> Workspaces, <C>pnpm-workspace.yaml</C>, or <C>package.json</C> files under{" "}
          <C>packages/*</C> and <C>apps/*</C> give the note “This looks like a monorepo. Set the root directory to
          the app you want to deploy.” Up to 20 folders are offered as buttons.
        </li>
        <li>
          <B>Variable names.</B> Only <C>package.json</C> and the example env files <C>.env.example</C>,{" "}
          <C>.env.sample</C>, <C>.env.template</C> and <C>.env.local.example</C> are read, and only for their names.
          Values are discarded. At most 100 names are listed, and invalid or reserved names are dropped. A committed{" "}
          <C>.env</C>, <C>.env.local</C>, <C>.env.production</C> or <C>.env.production.local</C> is never read, and
          gives the warning “A .env file is committed to this repository. Remove it from git and rotate the
          values.”
        </li>
        <li>
          <B>Size.</B> A file over 200,000 bytes is skipped, paths deeper than 3 folders under the root are
          ignored, and a huge repository adds “This repository is very large, so some files may not have been looked
          at.” GitHub gets 10 seconds for the file list and 8 seconds for each file.
        </li>
      </List>
      <P>These are the other controls on the form and in Settings.</P>
      <List>
        <li>
          <B>Copy build settings from another project</B> fills the form from a project on the same server:
          runtime, install, build and start commands, output directory, root directory and health path. Choose a
          project and press <B>Copy</B>. The page says “Copied from NAME. Review the fields below, then press Save.
          Nothing is saved yet.” Variables, hooks, notifications, the port and the repository are not copied.
        </li>
        <li>
          <B>Adopt an existing checkout</B> is for a repository that already runs on this container. The project is
          created with automatic deploys off, and the form says “Adopted means the first deploy is manual, and
          automatic deploys start only after you confirm that first deploy works.” Nothing turns them on for you:
          tick <B>Deploy automatically on push</B> in Settings when the first manual deploy works.
        </li>
        <li>
          <B>The container check.</B> Once the name, server and port are valid, the form waits 600 milliseconds and
          then asks your container, read only, whether the project would collide with something there. The result
          is the “What is already on this container” panel. A line with the badge “Blocks the deploy” turns the
          Deploy button off. “Made by Egg” and “Good to know” lines are information only. The same check
          runs again at the start of every deploy, before anything is written.
        </li>
        <li>
          <B>Delete Project</B> asks you to type the project name. With “Also stop the service and delete releases
          on NAME.hackclub.app” ticked, which is the default, the service, the production and preview releases and
          the <C>current</C> link are removed from the container, but only if Egg created them. The <C>shared/</C>{" "}
          folder is kept. Unticked, only the records go and the app keeps running. A project with a deployment that
          is Queued, Building or Deploying cannot be deleted.
        </li>
      </List>
      <Table
        caption="What the container check looks for"
        head={["It finds", "Blocks the deploy?", "What to do"]}
        rows={[
          [
            "A service egg-NAME.service that Egg did not create, or one that systemd already has",
            "Yes",
            "Choose another project name. Egg will not replace it.",
          ],
          [
            "The folder ~/.egg/NAME is a link, a file, a git checkout that is not Egg’s, or holds other files",
            "Yes",
            "Choose another project name, or clear the folder yourself.",
          ],
          [
            "The port is already used by another program",
            "Yes",
            "Choose another port, or stop that program yourself first. Egg will not stop it.",
          ],
          [
            "A program or service already runs from the project folder",
            "Yes, while it runs",
            "Stop it first, or choose another project name.",
          ],
          [
            "The same repository already runs by hand from another checkout",
            "Yes, but only for the first production deploy",
            "Stop it yourself if you want Egg to take over, or use Adopt an existing checkout.",
          ],
          [
            "Leftovers from an earlier Egg project with this name",
            "No",
            "“It will be reused.”",
          ],
          [
            "The listening ports could not be read, a stopped service for the same repository, or a checkout that just sits there",
            "No",
            "Shown as information. A checkout is never touched.",
          ],
        ]}
      />
      <H3 id="projects-runtimes" />
      <Table
        caption="Runtimes"
        head={["Runtime", "Install and build", "Default start"]}
        rows={[
          [
            "Node.js",
            "Picks pnpm, then yarn, then npm from your lockfile (npm install if there is none) and runs your build script if you have one. The install step uses a frozen lockfile. Your container then installs production dependencies only. node_modules is not uploaded.",
            <C key="n">npm start</C>,
          ],
          [
            "Python",
            "No build step. Your container creates a virtual environment in .venv and installs requirements.txt into it, if the file exists. Your install and build commands, if you set them, run in the sandbox first.",
            <C key="p">python3 app.py</C>,
          ],
          [
            "Static site",
            "Builds if there is a build script, then ships only the Output directory. It is served with Python 3, or a short built-in Node.js server if Python is missing.",
            <C key="s">python3 -m http.server PORT --bind 0.0.0.0</C>,
          ],
          ["Custom command", "No detection and no install on the container. You give the install, build and start commands.", "Your command"],
        ]}
      />
      <P>
        Builds run in <C>node:22-bookworm</C> for Node.js, Static site and Custom command, and in{" "}
        <C>python:3.12-bookworm</C> for Python. For Node.js the install command is <C>npm ci</C>,{" "}
        <C>corepack enable && pnpm install --frozen-lockfile</C> or{" "}
        <C>corepack enable && yarn install --frozen-lockfile</C>, and the build command is{" "}
        <C>npm run build</C>, <C>pnpm build</C> or <C>yarn build</C>. The service runs your start command through a
        login shell, so tools installed with nvm are on the path. Go, Ruby and Rust are named as not supported by
        detection; use Custom command if you can run a prebuilt binary. Bun is detected but not built yet.
      </P>
      {why(
        <>
          The build runs on the Egg side, not on your container, so a build that needs a gigabyte of memory cannot
          crowd out your running app. Only the finished build travels over SSH, and your container installs just the
          production dependencies, which keeps the upload small and the install matched to the machine that runs
          it. Container checks look before they touch anything for the same reason: the container is yours and may
          hold things Egg did not make.
        </>
      )}
      <H3 id="projects-guarantees" />
      <List>
        <li>
          It runs from its release folder with <C>PORT</C>, <C>HOST=0.0.0.0</C> and <C>NODE_ENV=production</C> set.
          Production runs from the <C>current</C> link, and a preview from its own release folder.
        </li>
        <li>
          systemd restarts it three seconds after it exits (<C>Restart=always</C>, <C>RestartSec=3</C>), so a crash
          is not the end of the app, and it starts again when the container boots.
        </li>
        <li>
          It sees your environment variables from a file only the service reads. The names <C>PORT</C>,{" "}
          <C>HOST</C>, <C>PATH</C>, <C>HOME</C> and <C>EGG</C> are reserved, in any letter case.
        </li>
        <li>
          Files in <C>shared/</C> are never touched by a deploy, so data the app keeps there survives new releases.
          Write data there, not into the release folder, which is replaced on every deploy.
        </li>
      </List>
      <H2 id="projects-reference" title="Limits, errors and an example" />
      {limits("projects", [
        ["Project name", "1 to 60 characters", "“name: Too big: expected string to have <=60 characters”", "server/projects.ts"],
        [
          "Address-safe name (slug)",
          "1 to 40 lowercase letters, digits and hyphens; starts and ends with a letter or digit",
          "“The project name must use lowercase letters, digits and hyphens (up to 40).”",
          "server/deploy/layout.ts",
        ],
        ["Commands", "500 characters, one line", "“startCommand: Commands must be a single line” or “startCommand: Too big: expected string to have <=500 characters”", "server/projects.ts"],
        [
          "Root directory",
          "Relative, no “..”, 200 characters",
          "“rootDir: Root directory must be a relative path inside the repository”, or at deploy time “The root directory “DIR” does not exist in this repository.”",
          "server/projects.ts, server/deploy/build.ts",
        ],
        [
          "Branch",
          "200 characters; letters, digits and . _ - /; no leading hyphen; no “..”",
          "“productionBranch: Branch names may use letters, digits, . _ - and /” or “productionBranch: Invalid branch name”",
          "server/projects.ts",
        ],
        [
          "Port",
          "1024 to 65535, and not 20000 to 29999; unique on a server",
          "“port: Ports 20000 to 29999 are reserved for previews”, “port: Too small: expected number to be >=1024”, “Port N is already used by another project on this server.” (in Settings: “Port N is already used on this server.”)",
          "server/projects.ts",
        ],
        ["Health check path", "Starts with a slash, 200 characters", "“healthPath: Must start with /”", "server/projects.ts"],
        [
          "Repository address",
          "https, github.com only, no credentials",
          "“Only plain https repository URLs are supported.” or “Repositories on HOST are not supported yet. Supported: github.com.”",
          "server/deploy/build.ts, assertCloneUrl",
        ],
        ["Detection reads", "Files up to 200,000 bytes, 3 folders deep, 100 variable names, 20 app folders", "The rest is skipped.", "server/repo-read.ts, server/repo-detect.ts"],
        ["Container checks while you fill the form", "20 a minute", "“Too many checks. Wait N seconds and try again.”", "app/api/projects/conflicts/route.ts"],
        ["Environment variables per project", "100", "See Environment variables.", "server/projects.ts"],
      ])}
      {wrong("projects", [
        [
          "“You already have a project called “name”.”",
          <>Project names are unique for you, across servers. Pick another name.</>,
        ],
        [
          "“Deploy is turned off because N things on this container are in the way.”",
          <>
            The conflict check found a service, folder or port that Egg did not create. It will not stop or change
            them. The panel above lists each one. Change the project name, server or port, or fix it on your
            container. The link “Open container status” opens the Container page in a new tab.
          </>,
        ],
        [
          "“Could not check this container just now: reason. The deploy checks again before it changes anything.”",
          <>The form could not ask your container. You can still deploy; the check runs again at the start.</>,
        ],
        [
          "“Nothing was changed on your container.” followed by details",
          <>
            The same check, run at deploy time, stopped the deployment before it wrote anything. The first three
            reasons are quoted.
          </>,
        ],
        [
          "“Set a start command for this project (for example ./my-binary).”",
          <>A Custom command project has no default start. Fill in the Start command.</>,
        ],
        [
          "“Static sites need Python 3 or Node.js on your Nest container to be served.”",
          <>Install one of them on the container, or use another runtime.</>,
        ],
        [
          "“Could not read this repository. If it is private, install the GitHub App so it can be read. You can still set everything by hand.”",
          <>Install the app on the repository. “Could not find the BRANCH branch of REPO.” means the branch name is wrong.</>,
        ],
        [
          "“GitHub did not answer (STATUS). Try again later.” or “Could not reach GitHub to look. Try again in a moment.”",
          <>GitHub is not answering. The form still works with fields you fill by hand.</>,
        ],
        [
          "No folder called “DIR” on the BRANCH branch.",
          <>The root directory does not exist on that branch. Other lines say “That path is a file, not a folder.” or “That root directory is not a valid relative path.”</>,
        ],
        [
          "“The project was created, but NAME was not saved: reason. Press Deploy to try again.”",
          <>The project exists. Press Deploy again; it does not create a second project.</>,
        ],
        [
          "“A deployment is still running for this project. Cancel it or wait for it to finish, then delete the project.”",
          <>Cancel the deployment on the Deployments tab, then delete the project.</>,
        ],
        [
          "“Could not remove the project from your container.”",
          <>The container did not finish the removal. Test the connection and try again. The records are kept so you can retry.</>,
        ],
        [
          "“Pick a different project to copy from.” or “You can only copy from a project on the same server.”",
          <>Choose another project from the same server in the Copy list. “There are no other projects on this server to copy from.” means there is none.</>,
        ],
      ])}
      <Callout tone="note" title="Pasted URLs do not deploy on push">
        A project made from a pasted public repository URL stores no repository name, so a push never builds it. It
        is built by Deploy, a deploy hook or the API. Import through the GitHub app if you want pushes to deploy.
      </Callout>
      {example("projects", {
        title: "Set up recipe-bot and change its health path",
        given: (
          <>
            Sam imports <C>sam-r/recipe-bot</C>. The “We found” summary says Node.js with <C>npm</C>, with the
            build command left empty because there is no build script, and Sam’s <C>package.json</C> has a{" "}
            <C>start</C> script. The repository has a <C>.env.example</C> naming <C>DISCORD_TOKEN</C>.
          </>
        ),
        steps: [
          { title: "Import and accept", body: <>Sam presses Use these settings, names the project <C>recipe-bot</C>, keeps the production branch <C>main</C> and the port <C>3000</C>.</> },
          { title: "Fill the variable", body: <>Sam pastes the Discord token into the <C>DISCORD_TOKEN</C> field and presses Deploy.</> },
          { title: "Change the health path", body: <>Later Sam opens Settings, Build and Run, sets Health check path to <C>/health</C> and presses Save.</> },
        ],
        result: (
          <>
            The project and the first deployment are created, and <C>DISCORD_TOKEN</C> exists for All environments.
            After the Save, the page reads “Saved. Changes apply to the next deployment.” The next deploy checks{" "}
            <C>/health</C> instead of <C>/</C>.
          </>
        ),
      })}
      {related([
        ["env", "Environment variables"],
        ["deployments", "Deployments"],
        ["container", "Container, terminal and files"],
        ["limits", "Limits"],
      ])}
    </Section>
  ),

  deployments: () => (
    <Section
      id="deployments"
      intro="Every build is a deployment, with its own log, commit and port. Production and preview deployments are kept apart."
    >
      <P>
        A deployment is one attempt to build a commit and put it on your container. It starts Queued, ends as Ready,
        Error or Canceled, and keeps its log. Where it came from is its source: <C>manual</C> (the Deploy button or
        the API), <C>webhook</C> (a push or a pull request), <C>hook</C> (a deploy hook), <C>redeploy</C> or{" "}
        <C>rollback</C>. You need a project. API tokens need the <C>deployments:write</C> permission to start,
        redeploy, cancel or roll back.
      </P>
      <H3 id="deployments-states" />
      <Table
        caption="Deployment states"
        head={["State", "Meaning"]}
        rows={[
          ["Queued", "Waiting. A project runs one deployment at a time, and the worker runs 2 deployments at once across all projects."],
          ["Building", "Cloning, installing, building and packing in the sandbox on the Egg side."],
          ["Deploying", "Uploading, unpacking, starting the service and waiting for it to answer. A rollback also shows as Deploying."],
          ["Ready", "Started and answering."],
          ["Error", "A step failed. The error text, at most 500 characters, is on the deployment page."],
          ["Canceled", "You canceled it, or its pull request closed."],
        ]}
      />
      <P>
        The lists draw Deploying as Building. The Compare table shows all six words. In the Deployments page status
        filter, Building also lists Queued, and Error also lists Canceled.
      </P>
      <P>
        If a production deployment fails after the switch, the previous release is put back and checked for 20
        seconds. The log says “The previous release is serving traffic again.” or “The previous release did not come
        back either. Check the logs.” A preview that fails to start is stopped and removed, so it does not stay
        behind as a service that keeps restarting.
      </P>
      <P>
        The deployment page has a Details card (Created, Duration, Environment, Address, Port and Source with the
        branch and commit) and a Build Logs card. A log reads in this order: “Deploying NAME (production) to
        USER@HOST”, the clone, “Commit abc1234: message”, “Building: COMMAND” (or “No build step for this
        project.”), “Packed release: N MB”, “Connecting to your Nest container”, “Uploading N MB”, the steps on the
        container, “Waiting for the app to answer on port N” and a line that starts “Healthy:”. Production ends with
        “Live on port N. Map your domain to this port in the Nest dashboard.” The Build Logs card starts open while a
        deployment runs or has failed, and collapsed once it is Ready. It has a count of lines and a{" "}
        <B>Find in logs…</B> box. Build logs cannot be downloaded.
      </P>
      <H3 id="deployments-actions" />
      {steps("deployments", [
        {
          title: "Deploy",
          body: (
            <>
              Open the project and press the button at the top. It reads <B>Deploy</B> until a production release
              is live and <B>Redeploy</B> after that. Either way it queues a new build of the tip of the production
              branch. It does not rebuild an older commit. If a deployment is already running, the new one waits as
              Queued.
            </>
          ),
        },
        {
          title: "Redeploy one commit",
          body: (
            <>
              In the Deployments list, open <B>Actions for deployment</B> on a row and choose <B>Redeploy</B>. This
              builds the same commit again into the same environment. If GitHub no longer has the commit, the log
              says “Could not fetch SHA; building the branch tip instead.” The menu also has <B>View logs</B>.
            </>
          ),
        },
        {
          title: "Roll back",
          body: (
            <>
              Press <B>Instant rollback</B> on the project page, or choose it from a row’s menu. It points{" "}
              <C>current</C> at an earlier Ready production release that is still on your container and restarts
              the service. Nothing is rebuilt, but it still waits for the app to answer, for up to 45 seconds. If
              the older release is not healthy, the release that was live is put back and the new rollback row ends
              as Error. The log ends with “Rollback complete. Database changes are not reversed.” The project page
              button targets the newest Ready production release that is not live. Its tooltip says “Switches back
              to the previous release. Database changes are not reversed.”
            </>
          ),
        },
        {
          title: "Cancel",
          body: (
            <>
              Choose <B>Cancel</B> on a row that is Queued, Building or Deploying. A running build stops within
              about two seconds, because the worker looks every two seconds. The build checks again after the
              build, after the upload and after the service is registered. Once the release has been switched, a
              cancel can no longer undo it: the deployment finishes as Ready.
            </>
          ),
        },
        {
          title: "Restart without building",
          body: (
            <>
              On the project page’s Service card, press <B>Restart</B> and confirm “Restart the service?”. It
              restarts the production service and builds nothing. The app is offline for a few seconds.
            </>
          ),
        },
      ])}
      <P>
        On the Deployments page you can search with <B>Search by commit, branch, author or #pr…</B>. Every word must
        match the project, branch, commit message, short commit, author, how it started, environment or pull
        request (type <C>#14</C> or <C>pr 14</C>). Sort with <B>Sort deployments</B> (Newest first, Oldest first,
        Longest build, Shortest build) and filter by <B>Filter by status</B>, <B>Filter by environment</B>,{" "}
        <B>Filter by project</B> and <B>Filter by time</B> (Any time, Last 24 hours, Last 7 days, Last 30 days).{" "}
        <B>Clear filters</B> resets them. Tick rows to use <B>Compare</B> (exactly two rows), <B>Cancel</B> (previews
        that are not finished) or <B>Delete previews</B> (previews that are not live and are at least 24 hours
        old). Deleting asks “Delete N previews?” and says each preview is stopped and its files removed from your
        container, and that production releases and the live release are never deleted. The record stays in the
        list.
      </P>
      <P>
        The Deployments page for all projects loads the newest 100 deployments and shows 25 at a time with a{" "}
        <B>Show N more</B> button. A single project’s Deployments tab works differently, so a long history does not
        have to load at once. It loads the newest 25 and a <B>Load older</B> button (“Loading older…”) fetches the
        next 25. Search, status, environment and time are answered by the server, not by the rows already on the
        page, so a match is found however far back it is. The search waits until you stop typing. Sorting only
        reorders the rows loaded so far, and the page says so under the list. If a page cannot be loaded the rows
        already shown stay, and the button tries again.
      </P>
      <P>
        To keep a record outside the dashboard, open a project’s Deployments tab and press <B>Export CSV</B>. The
        file holds that project’s newest 5,000 deployments with the time (UTC), commit, branch, environment, state,
        duration in seconds and deployment id. It never includes variables, logs, ports or addresses. You can make
        10 exports a minute; after that the answer is “Too many exports. Wait N seconds and try again.”
      </P>
      <H3 id="deployments-releases" />
      <P>
        Each release lives in its own folder on your container, under <C>~/.egg/NAME/releases/</C>. After
        every successful deploy, production keeps the five newest Ready releases plus the live one, so up to six can
        exist after a rollback. Previews, all branches together, keep the two newest Ready ones. Older ones are
        stopped and deleted. A release that was removed cannot be rolled back to. Failed and canceled deployments
        leave nothing on the container. If the cleanup fails over SSH, the records are still marked as cleaned up,
        so a leftover folder can stay on the container while the page says it is gone. The Container page lists
        such leftovers.
      </P>
      <H3 id="deployments-previews" />
      <P>
        Any branch other than the production branch builds as a preview, with its own service on the lowest free
        port from 20000 to 29999 on that server. Nest does not give previews an address on its own. The log says
        “Preview is running on port N. Map a domain to it in the Nest dashboard to open it.” Build a preview by
        pushing a branch, opening a pull request, calling a deploy hook with a branch, or using the API. Previews
        use the variables set for All or Preview. The project page lists them under Active branches, one row per
        branch.
      </P>
      <Callout tone="tip" title="A failed deploy leaves production alone">
        If the new release never answers on its port, the previous release is switched back on, so a failed deploy
        does not leave you on a broken version. If the app crashes at start, the check stops at once with “Service
        crashed on start” instead of waiting the full 45 seconds.
      </Callout>
      {why(
        <>
          A release is a folder, and going live is moving one link, so rolling back is the same move in the other
          direction and takes seconds. That is also why a rollback cannot restore a release that was cleaned up, and
          why it cannot reverse changes your app made to its own database: only the code folder changes. A
          project runs one deployment at a time because two builds would otherwise race to switch the same link.
        </>
      )}
      <H2 id="deployments-reference" title="Limits, errors and an example" />
      {limits("deployments", [
        ["Releases kept in production", "5 Ready, plus the live one", "Older ones are deleted and cannot be rolled back to.", "server/deploy/layout.ts, KEEP_RELEASES"],
        ["Previews kept", "2 newest Ready", "Older previews are stopped and removed.", "server/deploy/layout.ts, KEEP_PREVIEWS"],
        ["Preview ports", "20000 to 29999 per server", "“No free preview ports on this server.”", "server/projects.ts"],
        ["Deployments at once, all projects", "2 by default", "The rest wait as Queued. A self-hosted worker can change it with WORKER_CONCURRENCY.", "instrumentation.ts"],
        ["Deployments at once, one project", "1", "The others wait as Queued.", "server/jobs.ts"],
        ["Clone", "5 minutes", "“Could not clone the repository…”", "server/deploy/build.ts"],
        ["Fetching one commit for a redeploy", "3 minutes", "The branch tip is built instead.", "server/deploy/build.ts"],
        ["Build time", "15 minutes by default", "“The build timed out.”", "server/config.ts, BUILD_TIMEOUT_SECONDS"],
        ["Build sandbox", "2 GB of memory by default with no extra swap, 2 CPUs, 2048 processes", "A build that needs more fails inside the sandbox.", "server/deploy/build.ts"],
        ["Build output", "500 MiB (524,288,000 bytes), measured on the compressed archive", "“The build output is N MB, over the 524.288 MB limit.”", "server/deploy/build.ts, MAX_ARCHIVE_BYTES"],
        ["One step on your container", "2 minutes; 15 minutes for unpacking and installing", "“Command timed out after 120s” (or 900s).", "server/deploy/pipeline.ts"],
        ["Wait for the app to answer", "45 seconds, then 20 seconds for the old release", "The release is marked Error and the previous one is restored.", "server/deploy/pipeline.ts"],
        ["A running job counts as dead after", "1 hour", "“The worker stopped while this deployment was running. Try again.”", "server/jobs.ts"],
        ["Log lines per deployment", "20,000, each cut at 4000 characters", "“Further log output was dropped: this deployment reached its log limit.”", "server/deploy/logger.ts"],
        ["Build log lines loaded on a page", "1000", "A finished deployment shows its first 1000 lines. A running one streams new lines as they arrive.", "server/projects.ts"],
        ["Live build stream", "About 3.75 hours", "The stream stops; reload the page.", "app/api/deployments/[id]/stream/route.ts"],
        ["Bulk actions", "50 deployments at a time", "Each one runs on its own; one failure does not stop the others.", "server/deployments-bulk.ts, MAX_BULK"],
        ["Delete previews", "Not live, not cleaned up, not running, 24 hours old or more", "“Only old previews that are not live or removed can be deleted in bulk.”", "lib/deployments-filter.ts"],
        ["Deployments page, all projects", "Newest 100, shown 25 at a time", "Older ones do not appear on the page. Open the project’s Deployments tab for them.", "server/queries.ts, components/deployments-view.tsx"],
        ["A project’s Deployments tab", "25 at a time, up to 100 for an API request", "Load older brings in the next page. Filters and search run on the server.", "server/deployment-page.ts, DEFAULT_PAGE_SIZE and MAX_PAGE_SIZE"],
        ["CSV export", "Newest 5,000 deployments, 10 exports a minute", "“Too many exports. Wait N seconds and try again.”", "server/export-csv-data.ts"],
      ])}
      {wrong("deployments", [
        [
          "“Could not clone the repository. Check the branch name and that Egg has access to it.”",
          <>Check the production branch name, and that the GitHub app is installed on the repository.</>,
        ],
        [
          "“The root directory “DIR” does not exist in this repository.” or “DIR” is outside the repository.”",
          <>Fix the Root directory in Settings. It must be a folder inside the repository.</>,
        ],
        [
          "“The build failed (exit CODE).”",
          <>Read the Build Logs card from the bottom. A missing lockfile, a wrong root directory or a missing variable is the usual cause.</>,
        ],
        [
          "“The build timed out.”",
          <>The build ran past 15 minutes. Cut work from the build, or ask the person running Egg to raise the limit.</>,
        ],
        [
          "“The output folder “DIR” was not created by the build.”",
          <>A Static site project builds into a folder that does not exist. Check the Output directory and the build command.</>,
        ],
        [
          "“The build output is N MB, over the 524.288 MB limit.”",
          <>Leave large files out of the build, or ship them another way. Files in <C>shared/</C> are not part of a release.</>,
        ],
        [
          "“Nothing was changed on your container.” followed by details",
          <>The container check found something that is not Egg’s. See Projects for each case.</>,
        ],
        [
          "“PATH is a link, so Egg will not write into it.”, “PATH exists and is not a folder.”, “PATH already exists and was not created by Egg, so it was left alone.” or “UNIT already exists and was not created by Egg, so it was left alone.”",
          <>Something of yours is in the way. Egg never overwrites it. Rename the project or remove the item yourself.</>,
        ],
        [
          "“Preparing folders failed (exit N).” and similar for Checking the service name, Unpacking the release, Registering the service, Switching the release and Starting the preview",
          <>That step failed on your container. The log lines above it say why. “Upload is corrupted: checksum mismatch” means the file changed in transit; deploy again.</>,
        ],
        [
          "“The new release did not become healthy on port N. Make sure your app listens on the PORT environment variable and on 0.0.0.0.”",
          <>Fix the port or address, or the health path, and deploy again. The last 30 log lines of the service are printed in the build log.</>,
        ],
        [
          "“The worker stopped while this deployment was running. Try again.” or “The worker restarted while this deployment was running. Try again.”",
          <>The Egg worker went away mid-build. Redeploy.</>,
        ],
        [
          "“No free preview ports on this server.”",
          <>All 10,000 preview ports are in use. Delete old previews.</>,
        ],
        [
          "“That release was removed from your server to save space.”",
          <>It is outside the five kept. Redeploy that commit instead.</>,
        ],
        [
          "“That deployment is already live.”, “Only production deployments can be rolled back to.” or “That deployment never finished, so there is nothing to roll back to.”",
          <>Pick a different Ready production deployment.</>,
        ],
        [
          "“That release is no longer on your server (old releases are removed to save disk space).” or “The older release did not become healthy, so nothing was changed.”",
          <>The rollback row ended as Error and the live release was left or restored. Redeploy the commit.</>,
        ],
        [
          "“There is no earlier release on your server to switch back to.” (the rollback button’s tooltip)",
          <>There is nothing older to go back to. Redeploy a commit instead.</>,
        ],
        [
          "“That deployment is already finished.”",
          <>It ended before Cancel arrived. Check its state.</>,
        ],
        [
          "“Only previews that are queued or running can be canceled in bulk.” or “Could not remove the preview from your container.”",
          <>The bulk action skipped that row. Check its state, then try again; the others still run.</>,
        ],
        [
          "“Could not start the deployment”",
          <>The browser could not queue the build. Press Deploy again, and check your connection.</>,
        ],
      ])}
      {example("deployments", {
        title: "Recover from a bad release",
        given: (
          <>
            Sam deploys a change to <C>recipe-bot</C> that crashes when it reads a missing variable. The previous
            release is still on the container.
          </>
        ),
        steps: [
          { title: "Ship a bad release", body: <>The new deployment ends as Error with “The new release did not become healthy on port 3000…”. The log prints the service’s last 30 lines and “The previous release is serving traffic again.”</> },
          { title: "Fix and push", body: <>Sam fixes the code and pushes. The next deployment reaches Ready.</> },
          { title: "Roll back a bad one", body: <>A week later Sam ships a change that works but behaves badly, and presses Instant rollback.</> },
        ],
        result: (
          <>
            A new deployment appears with the source “rollback” and the state Ready. The log ends with “Rollback
            complete. Database changes are not reversed.” Any change the bot made to its own database stays as it
            was.
          </>
        ),
      })}
      {related([
        ["github", "GitHub and previews"],
        ["monitoring", "Monitoring and uptime"],
        ["logs", "Logs"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),

  env: () => (
    <Section
      id="env"
      intro="Set once per project. Values are encrypted, masked in logs, and written to your container when you deploy."
    >
      <P>
        Environment variables are how your app gets its secrets and settings, such as a Discord token or a database
        address, without putting them in the repository. Each one has a name, a value and a target that says which
        deployments get it. You need a project. Open the project’s Settings and find the Environment Variables card.
        You can also fill the names found in your repository while you create the project.
      </P>
      {steps("env", [
        {
          title: "Add a variable",
          body: (
            <>
              Type a <B>Name</B> and a <B>Value</B>, choose where it applies in <B>Applies to</B> (All, Production
              or Preview), and press <B>Save</B>. The button stays off until there is a name. The list below the
              form shows each name with its target, in alphabetical order.
            </>
          ),
        },
        {
          title: "Import names from the repository",
          body: (
            <>
              Press <B>Import names from the repository</B>. While it reads, the button says “Reading the
              repository…”. It looks at <C>.env.example</C>, <C>.env.sample</C>, <C>.env.template</C> and{" "}
              <C>.env.local.example</C> on the production branch. Every name not yet present is added for All with an
              empty value, and the page says “Added N names with empty values. Use the pencil on each to set its
              value.” Names you already have are never touched.
            </>
          ),
        },
        {
          title: "Change a value",
          body: (
            <>
              Press the pencil (“Change the value of NAME”), type a “New value” and press <B>Update</B>. Saving the
              same name and target again also replaces the value. You cannot read the old one back.
            </>
          ),
        },
        {
          title: "Delete a variable",
          body: (
            <>
              Press the trash button (“Delete NAME”). The dialog “Delete NAME?” says “Deployments after this one will
              not have it.” The variable stays in the current release until you deploy again.
            </>
          ),
        },
        {
          title: "Apply the change",
          body: (
            <>
              A change reaches your container on the next deployment, because the values are written into the new
              release. Press <B>Redeploy</B> on the project page to apply it now. A restart alone does not pick up a
              change.
            </>
          ),
        },
      ])}
      <Table
        caption="Which deployments get which variable"
        head={["Applies to", "Production deployments", "Preview deployments"]}
        rows={[
          ["All", "Yes", "Yes"],
          ["Production", "Yes", "No"],
          ["Preview", "No", "Yes"],
        ]}
      />
      <List>
        <li>
          The list shows names and targets only. Values are never returned by the browser, the API or an access
          token. They are stored encrypted with AES-256-GCM, tied to the project, the name and the target.
        </li>
        <li>
          At deploy time the values are passed to the build as ordinary environment variables, and written to a{" "}
          <C>.env</C> file at the top of the release with permissions 600, as <C>NAME=&quot;value&quot;</C> lines for
          systemd. Line breaks in a value become <C>\n</C>. An empty value is left out of the file, so the app sees
          the variable as unset rather than empty.
        </li>
        <li>
          Build and deploy logs, and the error text of a failed deployment, hide each value as <C>***</C>. The
          base64 form of a value and its percent-encoded form are hidden too. In a multi-line value such as a key
          file, each line of 8 or more characters is hidden on its own. A value of 2 or 3 characters is hidden only
          where it stands alone, not inside a longer word or number, and a one-character value is never hidden.
          Another changed form, such as hex or a hash, is not recognised.
        </li>
        <li>
          Saving a name and target that already exist replaces the value. The same name for All and for one target
          counts as two variables.
        </li>
      </List>
      <Callout tone="note" title="Release .env files are not shown in the dashboard or the API">
        The Files page and the API both refuse to open <C>current/.env</C> and <C>releases/ID/.env</C>. The Files page
        says “This file holds the project’s environment variable values, so it is not shown here. Change the values
        in the project’s settings.” and the API answers 403. A terminal on your container can read the file, which is
        one reason the Terminal switch is off by default.
      </Callout>
      {why(
        <>
          Values are write-only so that no page, token or log has to be trusted with them. The cost is that you
          cannot check a value after saving it; you replace it. Variables are written into each release, instead of
          being read live, so a rollback runs with the variables that release shipped with, and a half-edited set of
          values never reaches a running app.
        </>
      )}
      {limits("env", [
        ["Variables per project", "100, counted per name and target", "“A project can have up to 100 variables.”", "server/projects.ts"],
        [
          "Name",
          "Letters, digits and underscores, not starting with a digit; 100 characters",
          "“key: Names use letters, digits and underscores, and do not start with a digit”",
          "server/deploy/runtime.ts, ENV_KEY",
        ],
        ["Value", "10,000 characters", "“value: Too big: expected string to have <=10000 characters”", "server/projects.ts"],
        ["Reserved names", "PORT, HOST, PATH, HOME, EGG, in any letter case", "“key: That name is set by Egg”", "server/deploy/runtime.ts, RESERVED_ENV"],
        ["Names found in a repository", "100, from files up to 200,000 bytes", "The rest are not listed.", "server/repo-detect.ts"],
        ["Masking", "Values of 2 or more characters, and their base64 and percent-encoded forms. 2 or 3 characters only where they stand alone", "A one-character value shows in the log as typed.", "server/deploy/redact.ts"],
      ])}
      {wrong("env", [
        [
          "“key: Names use letters, digits and underscores, and do not start with a digit”",
          <>Rename it, for example <C>DISCORD_TOKEN</C> and not <C>1TOKEN</C> or <C>discord-token</C>.</>,
        ],
        [
          "“key: That name is set by Egg”",
          <>
            Egg sets <C>PORT</C> and <C>HOST</C> itself, and <C>PATH</C>, <C>HOME</C> and <C>EGG</C> are
            kept. Choose a different name, or change the project’s port in Settings.
          </>,
        ],
        [
          "“A project can have up to 100 variables.”",
          <>Delete variables you no longer use, or combine related values into one.</>,
        ],
        [
          "“No example env file (such as .env.example) was found in the repository.”",
          <>Add the names by hand, or commit an example file with names and no values.</>,
        ],
        [
          "“Every name in the repository is already here.”",
          <>Nothing to add. Set the values with the pencil.</>,
        ],
        [
          "“N added, then it stopped: reason”",
          <>Some names were added before an error. Read the reason and import again.</>,
        ],
        [
          "“Could not look at the repository.” or “Could not read this repository. If it is private, install the GitHub App so it can be read.”",
          <>Install the GitHub app on the repository, or add the names by hand.</>,
        ],
        [
          "“A .env file is committed to this repository. Remove it from git and rotate the values.”",
          <>A warning from the import. Egg never read that file. Anyone with access to the repository can, so change the values.</>,
        ],
        [
          "A change did not take effect",
          <>It needs a deployment. Press Redeploy, then check the variable is set for the right environment.</>,
        ],
        [
          "A variable is set for All and for one environment",
          <>
            Keep one row per name where you can. Egg loads both rows, and these docs do not promise which one wins.
          </>,
        ],
      ])}
      {example("env", {
        title: "Give recipe-bot its Discord token",
        given: (
          <>
            <C>recipe-bot</C> reads its Discord token from <C>DISCORD_TOKEN</C>. The repository has a{" "}
            <C>.env.example</C> with that name and no value. Sam wants a different token for previews.
          </>
        ),
        steps: [
          { title: "Import the names", body: <>Sam presses Import names from the repository. <C>DISCORD_TOKEN</C> appears for All with no value.</> },
          { title: "Set the value", body: <>Sam presses the pencil beside <C>DISCORD_TOKEN</C>, pastes the token as the New value and presses Update.</> },
          { title: "Add a preview token", body: <>Sam types <C>DISCORD_TOKEN</C> again, sets Applies to Preview and presses Save. The list now has two rows.</> },
          { title: "Apply it", body: <>Sam presses Redeploy.</> },
        ],
        result: (
          <>
            Production gets the token set for All, and previews get the token set for All and Preview. Egg does not
            promise which of those two wins for a preview, so Sam deletes the All row and adds a Production row
            instead. The build log prints the token as <C>***</C> if the app ever echoes it. The bot logs in on the
            new release.
          </>
        ),
      })}
      {related([
        ["projects", "Projects and runtimes"],
        ["deployments", "Deployments"],
        ["api", "Access tokens and the API"],
        ["security", "Security"],
      ])}
    </Section>
  ),

  logs: () => (
    <Section id="logs" intro="Two kinds: what the build printed, and what your running app prints.">
      <P>
        Build logs are stored by Egg, one per deployment, and show the clone, install, build and release. Runtime
        logs are read live from your container and show what your running app prints. Build logs need a deployment.
        Runtime logs need a project that has been deployed, and only cover the production service.
      </P>
      {steps("logs", [
        {
          title: "Read a build log",
          body: (
            <>
              Open a deployment. The <B>Build Logs</B> card shows each line. While the deployment runs, new lines
              stream in and the card says “Waiting for the first log line…” until the first one arrives. Use{" "}
              <B>Find in logs…</B> to search. A Ready deployment’s log starts collapsed; open the card to read it.
            </>
          ),
        },
        {
          title: "Open the runtime logs",
          body: (
            <>
              Open Logs in the sidebar and choose a project. Pick a <B>Time range</B> (1 hour, 24 hours or 7 days;
              the default is 7 days) and a <B>Level</B> (All lines, or Warnings and errors). The line under the
              controls says how many lines are shown, for example “120 lines from recipe-bot, last 7 days.”
            </>
          ),
        },
        {
          title: "Search",
          body: (
            <>
              Type in <B>Search logs</B>, whose hint is “Search the last 1000 lines…”. The match is not
              case-sensitive and the page waits a moment after you stop typing before it asks your container.
            </>
          ),
        },
        {
          title: "Load older lines",
          body: (
            <>
              The page opens with the newest 300 lines. When the journal holds more inside the time range, a{" "}
              <B>Load older lines</B> button (“Loading older lines…”) sits above them. Each press adds the 300 lines
              before the ones you see, using the same time range, level and search, and keeps your place in the
              list. A screen reader is told how many lines were added. When the journal has nothing earlier in the
              range, the button goes away. If a stretch has no match, the button stays so you can keep looking. If a read
              fails, the lines above stay and the button tries again. Changing the range, level or search starts the
              list again from the newest lines.
            </>
          ),
        },
        {
          title: "Follow it live",
          body: (
            <>
              Tick <B>Refresh every 5s</B> to follow the log. A “Live” marker appears and the page reads quietly in
              the background. With older lines on screen it adds only what is new at the bottom. Or press{" "}
              <B>Refresh</B> when you want to.
            </>
          ),
        },
        {
          title: "Keep a copy",
          body: (
            <>
              Press <B>Download</B> to save exactly the lines on screen, older lines included, as a text file, for example{" "}
              <C>recipe-bot-logs-24h-2026-11-05.txt</C>. The name has the project, the range (<C>1h</C>,{" "}
              <C>24h</C> or <C>7d</C>) and the UTC date. The button is off when there are no lines.
            </>
          ),
        },
      ])}
      <List>
        <li>
          Runtime logs are the production service’s journal on your container (<C>journalctl -u egg-NAME.service</C>).
          The page shows up to 300 lines at a time. A search or the Warnings and errors level reads up to 1000 lines
          first, filters them, and keeps the newest 300 of what matches. Load older lines repeats that read for the
          lines before the last ones shown. A preview’s output is not on this page.
        </li>
        <li>
          Egg decides a line’s level from its text, in this order. A level the program printed itself wins:{" "}
          <C>[ERROR]</C>, <C>level=warn</C>, a JSON <C>level</C> or <C>severity</C> field, or a pino number, so{" "}
          <C>[INFO] failed login</C> stays Info. Next, a systemd marker such as <C>&lt;3&gt;</C>. Then counts of zero
          are ignored, so “0 errors” and “no warnings” do not count. After that the words error, fatal, critical,
          panic, exception, failed, failure and traceback, <C>npm ERR!</C>, Node codes such as <C>ERR_X</C>, class
          names like <C>TypeError:</C>, Python <C>{`File "x", line N`}</C> lines and stack frames are errors. The words
          warn, warning and deprecated are warnings. Everything else is Info. A stack trace takes the level of the
          error above it.
        </li>
        <li>
          In the Warnings and errors view each kept line is marked Error or Warning.
        </li>
        <li>
          Build logs hide secret values as <C>***</C>, drop colour codes, cut a line at 4000 characters, and stop at
          20,000 lines per deployment with the line “Further log output was dropped: this deployment reached its log
          limit.” Build logs have no download button. They stay on the deployment page.
        </li>
      </List>
      {why(
        <>
          Runtime output is not copied into Egg. It stays in your container’s journal, so reading it needs a live
          connection and how far back it goes is whatever systemd keeps there, which Egg does not set. Build output
          is different: it happens on the Egg side, so it is stored with the deployment and is still there when
          your container is off.
        </>
      )}
      {limits("logs", [
        ["Runtime log lines shown", "300", "The newest 300 after any filter.", "components/logs-view.tsx"],
        ["Lines read for a search or level filter", "1000 for each read, 300 kept", "Press Load older lines to search further back, inside the time range.", "server/runtime-info.ts"],
        ["Lines added by Load older lines", "300 at a time", "The button goes away when the journal has nothing before the first line.", "components/logs-view.tsx, lib/log-page.ts"],
        ["Lines the API can be asked for", "1 to 1000", "Other numbers are clamped.", "app/api/projects/[id]/runtime-logs/route.ts"],
        ["Search text", "200 characters", "The rest is cut off.", "server/runtime-info.ts"],
        ["Reading the journal", "30 seconds", "“Could not read the logs from your container.” or a timeout message.", "server/runtime-info.ts"],
        ["Automatic refresh", "Every 5 seconds", "Untick the box to stop.", "components/logs-view.tsx"],
        ["Build log lines per deployment", "20,000", "“Further log output was dropped: this deployment reached its log limit.”", "server/deploy/logger.ts"],
        ["Length of one build log line", "4000 characters", "The rest of the line is cut off.", "server/deploy/logger.ts"],
        ["Build log lines loaded on a page", "1000", "A finished log shows its first 1000 lines.", "server/projects.ts"],
        ["Live build stream", "About 3.75 hours", "The stream stops; reload the page.", "app/api/deployments/[id]/stream/route.ts"],
        ["Journal history", "Whatever systemd keeps on your container", "Egg does not set it.", "Not in Egg"],
      ])}
      {wrong("logs", [
        [
          "“Could not read the logs from your container.”",
          <>The container answered with an error. Press Refresh; if it keeps failing, test the connection on the Connect page.</>,
        ],
        [
          "“Timed out reading the logs. Your container may be stopped or starting; try again in a minute.”",
          <>Wait a minute, then press Refresh.</>,
        ],
        [
          "“Nest rejected the server’s key, so the logs could not be read.”",
          <>The key is not accepted. Paste the current public key in the Nest dashboard and test the connection.</>,
        ],
        [
          "“The server’s host key changed, so the logs were not read. Reconnect the server if you expected this.”",
          <>See Servers for what a changed host key means and how to reconnect.</>,
        ],
        [
          "“We can’t reach your container right now”",
          <>Use the retry button, and open the details line for the exact message. Your apps may still be running.</>,
        ],
        [
          "“Nothing printed in this time range. Try a longer one.”",
          <>The app printed nothing in that time. Pick 24 hours or 7 days.</>,
        ],
        [
          "“No warnings or errors in this time range.”",
          <>Switch Level to All lines to see everything.</>,
        ],
        [
          "“No lines match “TEXT”.”",
          <>Each read looks through 1000 lines. If the page offers it, press Load older lines to search further back, or pick a shorter word or a shorter time range.</>,
        ],
        [
          "“Nothing to read yet”",
          <>You have no projects. Deploy one and what it prints will show up here.</>,
        ],
        [
          "A secret appears in a build log",
          <>
            Masking covers a value as stored, and its base64 and percent-encoded forms. It does not cover a value
            of one character, or one changed in another way, such as a hash. Do not print secrets from your own code.
          </>,
        ],
      ])}
      {example("logs", {
        title: "Find why the bot went quiet",
        given: (
          <>
            <C>recipe-bot</C> goes quiet on Discord. The Service card shows Running.
          </>
        ),
        steps: [
          { title: "Open the logs", body: <>Sam opens Logs and chooses <C>recipe-bot</C>.</> },
          { title: "Narrow them", body: <>Sam sets Level to Warnings and errors and types <C>rate</C> in Search logs.</> },
          { title: "Keep the evidence", body: <>Sam presses Download.</> },
        ],
        result: (
          <>
            The page lists the matching lines marked Error or Warning, newest last among the 300 kept. Sam sees
            Discord’s rate limit message and attaches the downloaded file to a support question.
          </>
        ),
      })}
      {related([
        ["deployments", "Deployments"],
        ["monitoring", "Monitoring and uptime"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),

  domains: () => (
    <Section
      id="domains"
      intro="Your Nest name is free. A custom domain needs a DNS record first. Egg shows a domain as active only after its DNS check passes."
    >
      <P>
        A domain gives your app a name people can type. Three places have to agree: your DNS provider sends the name
        to Nest, the Nest dashboard maps the name to your app’s port, and Egg keeps a record of both so it can check
        them. Egg can do only the last part. You need a connected server and either a domain you can edit DNS for
        or your own Nest name. The form adds the domain to the server you connected first.
      </P>
      <List>
        <li>
          <B>Your Nest name is free.</B> <C>your-nest-username.hackclub.app</C>, and any name under it such as{" "}
          <C>app.your-nest-username.hackclub.app</C>, needs no DNS record and is active as soon as you add it.
          Other names under <C>hackclub.app</C> are refused: “Only your Nest name, NAME.hackclub.app, can be used
          under hackclub.app.”
        </li>
        <li>
          <B>A custom domain needs a DNS record.</B> Add a CNAME to <C>your-nest-username.hackclub.app</C>, or a TXT
          record with the value <C>domain-verification=your-nest-username</C>. This is the same proof Nest asks for
          when you add the domain on its dashboard. The domain waits as “Waiting for DNS” until Egg finds the record.
        </li>
        <li>
          <B>A subdomain of a domain you already verified</B> on the same server, such as <C>api.example.com</C>{" "}
          when <C>example.com</C> is active, needs no new record.
        </li>
        <li>
          <B>Reserved names are blocked.</B> Names such as <C>admin</C>, <C>api</C>, <C>dashboard</C>,{" "}
          <C>status</C>, <C>www</C>, <C>nest</C>, <C>hackclub</C> and <C>egg</C> cannot be used as the name under{" "}
          <C>hackclub.app</C>, <C>hackclub.com</C> or <C>hackclub.dev</C>, or on their own. The message is “That
          name is reserved. Choose another domain.”
        </li>
        <li>
          <B>Only active after the DNS check.</B> Egg shows a domain as active only when it is your Nest name, a
          subdomain of a verified domain, or its DNS record was found. IP addresses, <C>localhost</C> and internal
          names such as <C>.local</C> are refused.
        </li>
      </List>
      {steps("domains", [
        {
          title: "Add the domain",
          body: (
            <>
              Open Domains. In <B>Add a domain</B>, type the <B>Domain</B> (for example <C>app.example.com</C>),
              optionally pick a <B>Project (optional)</B> to fill its port, check the <B>Target port</B> and press{" "}
              <B>Add domain</B>. A panel headed “Next: finish setup for DOMAIN” then lists what to do next.
            </>
          ),
        },
        {
          title: "Point DNS at Nest",
          body: (
            <>
              At your DNS provider, add one of the two records shown: a CNAME with the “CNAME value”, which is{" "}
              <C>your-nest-username.hackclub.app</C>, or a TXT record with the “TXT value”, which is{" "}
              <C>domain-verification=your-nest-username</C>. Use the TXT record for a bare domain such as{" "}
              <C>example.com</C>, where a CNAME often cannot sit beside the other records. Your Nest name and
              subdomains of a verified domain skip this step.
            </>
          ),
        },
        {
          title: "Map it in the Nest dashboard",
          body: (
            <>
              In the Domains page of your Nest dashboard, add the same domain with the same port. Nest looks for the same
              record when you add it, so do step 2 first. Egg cannot do this for you.
            </>
          ),
        },
        {
          title: "Check",
          body: (
            <>
              Press <B>Check</B>. The button reads “Checking…”. The status moves from “Waiting for DNS” to “Active”
              when the record is found, and stays on “Waiting for DNS” with a reason when it is not. DNS changes can
              take a few minutes, so check again after a short wait.
            </>
          ),
        },
      ])}
      <List>
        <li>
          <B>DNS check.</B> Passes when the domain has a TXT record <C>domain-verification=username</C>, or a CNAME
          to <C>username.hackclub.app</C>. For a name under <C>username.hackclub.app</C>, or that exact name, an A
          record is enough. A domain that has only an A record, and is not under your Nest name, gets “No CNAME
          found yet”. A subdomain of a domain you already verified passes without its own record.
        </li>
        <li>
          <B>App check.</B> Only once DNS passes. Egg sends a GET over HTTPS to <C>/</C> and, if the project has a
          different health path, to that path too. It waits 5 seconds for each, checks the certificate, follows no
          redirects and reads no body. It shows “Certificate accepted” or “Certificate not verified yet”, then
          “Answers with HTTP CODE” for any status below 500, or “Reachable but returning CODE” for 500 and above. A
          404 therefore still counts as answering. The health path is added in brackets after the message. It only
          checks names that resolve to public addresses, and never IP addresses.
        </li>
        <li>
          <B>Edit</B> (the pencil, “Edit DOMAIN”) changes the project and port. Changing the port resets the status
          to “Not checked” (“Waiting for DNS” for a custom domain) and says “Saved. Also change the target port to N on the Domains page of your Nest
          dashboard, then press Check.” Changing a project’s port in its Settings does the same to every domain
          linked to that project.
        </li>
        <li>
          <B>Remove</B> (“Remove DOMAIN”) opens “Remove DOMAIN?” and says “This removes the record from Egg.”
          It deletes the record in Egg only. Nest and your DNS provider are not changed.
        </li>
      </List>
      <Table
        caption="Statuses"
        head={["Status", "Meaning"]}
        rows={[
          ["Waiting for DNS", "A custom domain whose record has not been found yet. The record to add sits under the row."],
          ["Not checked", "A Nest name or a subdomain of a verified domain whose port changed and has not been checked since."],
          ["Active", "Your Nest name, a subdomain of a verified domain, or a domain whose DNS record was found. The app check may still show a problem."],
          ["Needs attention", "A domain that was active and no longer passes the check. The row says “DNS no longer points here. Check your record.” Egg never removes the domain."],
        ]}
      />
      <P>
        Egg looks again at active custom domains whenever the Domains page opens, at most once a minute for each. If
        the record has gone, the row shows the warning “DNS no longer points here. Check your record.” and a failed
        lookup shows nothing. Fix the record and press <B>Check</B>.
      </P>
      {why(
        <>
          Egg checks DNS and the app instead of changing anything, because the mapping lives in the Nest dashboard,
          which has no API. A record in Egg is a note of your intent. The rules follow Nest’s own: your Nest name
          is free, a custom domain proves itself with the same TXT or CNAME record, and the reserved names Nest
          keeps for itself are blocked here too. Egg shows a domain as active only after that proof, so a name that
          is not yours never looks live. The two checks are separate on purpose: DNS
          proves the name reaches Nest, and the app check proves your app answers behind it, so you can tell which
          side to fix.
        </>
      )}
      {limits("domains", [
        ["Domain", "A hostname up to 253 characters, each part up to 63, ending in letters; no IP address or URL", "“Enter a domain name such as app.example.com (not an IP address or a URL).”", "server/domains.ts"],
        ["Target port", "1 to 65535", "“Enter a port between 1 and 65535.”", "server/domains.ts"],
        ["Same domain twice", "Once across all users. Egg does not say whose it is", "“DOMAIN is already added.”", "server/domains.ts"],
        ["Reserved names", "119 names from Nest (admin, api, dashboard, docs, help, status, www and more) plus egg, nest, hackclub, hack-club, nest-deploy, egg-deploy and loadout", "“That name is reserved. Choose another domain.”", "server/domain-policy.ts"],
        ["Names under hackclub.app", "Only your own Nest name and names under it", "“Only your Nest name, NAME.hackclub.app, can be used under hackclub.app.”", "server/domain-policy.ts"],
        ["Public domains only", "No IP address, localhost, .local, .internal or .home.arpa name", "“Use a public domain name such as app.example.com. IP addresses, localhost and internal names cannot be used.”", "server/domain-policy.ts"],
        ["How long a re-check is remembered", "60 seconds for each domain", "Opening the page again within a minute shows the same answer.", "server/domains.ts"],
        ["App check wait", "5 seconds for each path", "“No answer within 5 seconds.”", "server/app-check.ts"],
        ["Servers the form can use", "Your first server, the one you connected first", "A second server’s domains cannot be added from this form.", "components/domains-view.tsx"],
      ])}
      {wrong("domains", [
        [
          "“The CNAME points to X, but it should point to TARGET.” or “The CNAME points to X. It should point to TARGET.”",
          <>Change the CNAME at your DNS provider to the value shown. The first form means X is another hackclub.app name.</>,
        ],
        [
          "“No CNAME found yet. Create one pointing to TARGET, or add a TXT record with the value domain-verification=NAME. DNS changes can take a few minutes.”",
          <>Add one of the two records, wait a few minutes, press Check.</>,
        ],
        [
          "“That name is reserved. Choose another domain.”",
          <>The name is on the reserved list. Pick another name, or use a domain of your own.</>,
        ],
        [
          "“Only your Nest name, NAME.hackclub.app, can be used under hackclub.app.”",
          <>Under <C>hackclub.app</C> you can use only your own Nest name and names beneath it. Use a domain of your own for anything else.</>,
        ],
        [
          "“DNS no longer points here. Check your record.”",
          <>An active domain no longer passes the check. Restore the CNAME or TXT record, then press Check. Egg keeps the domain.</>,
        ],
        [
          "“The name does not resolve yet. Add it in the Nest dashboard first.”",
          <>For a <C>.hackclub.app</C> name, add it on the Nest dashboard’s Domains page.</>,
        ],
        [
          "“DNS could not be checked right now. Try again in a minute.”",
          <>A lookup failed. Press Check again.</>,
        ],
        [
          "“DNS does not point at your server yet. Press Check to see what it points at.”",
          <>The default text under a row that needs attention. Press Check for the specific reason.</>,
        ],
        [
          "“The app check runs once DNS points at Nest.”",
          <>Fix DNS first. The app check only starts after the status is Active.</>,
        ],
        [
          "“The certificate has expired.”, “The certificate is for a different name.” or “The certificate is not trusted.”",
          <>The domain reaches something else, or the certificate on it is wrong. Check the mapping in the Nest dashboard.</>,
        ],
        [
          "“The connection was refused on port 443.” or “The secure connection could not be set up.”",
          <>Nothing is listening for the domain yet. Check the Nest dashboard mapping and the target port.</>,
        ],
        [
          "“No answer within 5 seconds.” or “Could not connect.”",
          <>Your app did not answer in time, or the app is not running. Check the Service card and the logs.</>,
        ],
        [
          "“The name does not resolve to an address yet.”, “The name resolves to a private or internal address, so it was not checked.” or “Only domain names can be checked, not IP addresses.”",
          <>The app check only runs against public domain names. Fix the DNS record.</>,
        ],
        [
          "“Reachable but returning 503”",
          <>The app answered with a server error. Read the logs.</>,
        ],
        [
          "“DOMAIN is already added.”",
          <>The name is already recorded, by you or by another account. A domain can be added only once across all users.</>,
        ],
        [
          "“Project not found”",
          <>The project is on a different server than the domain’s. Pick a project from the first server, or none.</>,
        ],
      ])}
      {example("domains", {
        title: "Give the bot’s page a domain",
        given: (
          <>
            <C>recipe-bot</C> now has a small status web page on port <C>3000</C>. Sam owns{" "}
            <C>recipes.example.com</C> and the Nest username is <C>sam-r</C>.
          </>
        ),
        steps: [
          { title: "Add the domain", body: <>Sam adds <C>recipes.example.com</C> with project <C>recipe-bot</C>, which fills port <C>3000</C>. The row reads “Waiting for DNS” and shows the records.</> },
          { title: "Set DNS and Nest", body: <>Sam creates a CNAME for <C>recipes.example.com</C> pointing to <C>sam-r.hackclub.app</C>, then adds the same domain and port in the Nest dashboard.</> },
          { title: "Check", body: <>Sam presses Check, and finds “No CNAME found yet”. Ten minutes later Sam presses Check again.</> },
        ],
        result: (
          <>
            The status reads “Active” and the app check shows “Certificate accepted” and “Answers with HTTP 200”.
          </>
        ),
      })}
      {related([
        ["deployments", "Deployments"],
        ["monitoring", "Monitoring and uptime"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),

  github: () => (
    <Section
      id="github"
      intro="Egg reads your code through a GitHub app that you install on chosen repositories, and builds when you push."
    >
      <P>
        The app is how Egg gets permission to read a repository and hear about pushes without holding your GitHub
        password. You choose which repositories it can see. You need a GitHub account and a connected server. The
        app is needed for private repositories, for pushes to deploy, and for pull request comments. A public
        repository can be imported without it by pasting its address, but then pushes do not deploy.
      </P>
      <H3 id="github-push" />
      {steps("github", [
        {
          title: "Install the app",
          body: (
            <>
              On the New project page, the “Connect GitHub” card has <B>Install the GitHub App</B>. It opens GitHub,
              where you choose the account and the repositories to share. Come back and press{" "}
              <B>I already installed it</B> if the list is empty; that signs you in to GitHub once to find your
              installations, and the sign-in is used once and not stored. Use <B>Add another account or repository</B>{" "}
              to share more later. When you return, the page says “GitHub is connected. Pick a repository below.”
            </>
          ),
        },
        {
          title: "Import the repository",
          body: (
            <>
              Pick it under <B>GitHub account</B>, find it with <B>Search repositories…</B> and press{" "}
              <B>Import</B>. The list shows the newest pushes first. Leave <B>Deploy automatically on push</B> on, as
              it is by default.
            </>
          ),
        },
        {
          title: "Push",
          body: (
            <>
              A push to the production branch deploys to production. A push to any other branch builds a preview.
              The deployment shows the source “webhook”, the first line of the commit message (cut at 300
              characters) and the author.
            </>
          ),
        },
        {
          title: "Open a pull request",
          body: (
            <>
              A pull request from a branch of the same repository builds a preview too, and gets a comment. See
              Pull request previews below.
            </>
          ),
        },
      ])}
      <List>
        <li>Branch deletions, tag pushes and other events are ignored.</li>
        <li>
          Only projects with <B>Deploy automatically on push</B> on, whose repository name matches and whose
          GitHub installation is one the project’s owner linked, are built.
        </li>
        <li>The same commit on the same branch is not built twice while one for it is already queued, building or deploying.</li>
        <li>
          GitHub signs every delivery. Egg checks the signature, and a delivery id it has already seen in the last
          hour is answered without being run again, so a retry cannot start a second build.
        </li>
        <li>
          If you rename the repository on GitHub, Egg follows the rename: the stored name and the clone address
          change to the new name. That needs the app to receive the Repository event.
        </li>
        <li>
          A project made from a pasted public URL is not built by a push. See Projects and runtimes.
        </li>
        <li>
          If you uninstall the app on GitHub, projects keep their records but lose access to private repositories
          until you install it again.
        </li>
      </List>
      <Table
        caption="What Egg uses from the GitHub app"
        head={["Permission or event", "What Egg uses it for", "If it is missing"]}
        rows={[
          ["Read access to code and metadata", "Listing repositories, reading files for “We found”, cloning to build.", "Private repositories cannot be read."],
          ["Push event", "Deploying on push.", "Pushes do not start builds."],
          ["Pull requests: read and write, and the Pull request event", "Previews for pull requests and the comment.", "Previews of pushed branches still build; the comment is skipped quietly."],
          ["Repository event", "Following a rename.", "After a rename, pushes no longer match the project."],
          ["Installation event", "Noticing an uninstall.", "Projects keep a link to an installation that is gone."],
        ]}
      />
      <H3 id="github-pr-previews" />
      <List>
        <li>
          A pull request from the same repository that is not a draft, and not from the production branch, builds a
          preview. The app posts one comment when that preview finishes and edits the same comment when a later
          build of the pull request finishes. It only ever edits a comment it wrote itself.
        </li>
        <li>
          The comment says “Preview ready” or “Preview failed”, with the project name, branch, short commit and a
          link, “Open the deployment”, that only you can open. A ready comment also gives the preview’s port and
          says Nest only gives it a public address once a domain is mapped to that port. A failed one says “The
          build log is in Egg.” It never includes error output, the server name or variable values.
        </li>
        <li>
          Closing the pull request, merged or not, cancels builds still running and removes its Ready previews from
          your container. A build that was still running shows as Canceled with “Pull request closed”. A Ready
          preview is stopped and removed from the container and is marked as cleaned up.
        </li>
        <li>
          Pull requests from forks and from the production branch are not built. The events handled are opened,
          reopened, synchronize, ready_for_review and closed.
        </li>
      </List>
      <Callout tone="warning" title="A draft pull request’s branch still builds a preview">
        A push to the branch of a draft pull request in the same repository does build a preview, because that
        comes from the push event. Only the pull request event skips drafts, so no comment is written until the
        pull request is marked ready for review.
      </Callout>
      <Callout tone="note" title="Permissions for the comment">
        Commenting needs the app to have Pull requests read and write access and the Pull request event. Without it,
        previews still build and the comment is skipped quietly. A 403 from GitHub is logged on the server and
        nothing shows on the deployment.
      </Callout>
      {why(
        <>
          The app model means Egg never holds a password or a personal token of yours: it gets a short-lived token
          for one installation, cached only until a minute before it expires, and can only see what you
          shared. Previews run on a separate port from production, so a branch under test never replaces the live
          app.
        </>
      )}
      <H2 id="github-reference" title="Limits, errors and an example" />
      {limits("github", [
        ["Repositories listed", "5 pages of 100, newest push first", "Repositories beyond that are not listed. Paste the address instead.", "server/github/app.ts"],
        ["Installation owner", "The first Egg user to link it", "“That GitHub installation is not linked to your account.”", "server/github/app.ts"],
        ["App sign-in token", "9 minutes", "Renewed automatically.", "server/github/app.ts"],
        ["Comments read when updating", "100 per pull request", "A comment beyond that is not found, and a new one is posted.", "server/github/pulls.ts"],
        ["Delivery ids remembered", "1 hour, up to 5000", "A repeated delivery is answered “duplicate delivery”.", "server/github/webhook.ts"],
        ["Webhook payload", "25 MB", "“payload too large”", "app/api/webhooks/github/route.ts"],
        ["Pull request events handled", "opened, reopened, synchronize, ready_for_review, closed", "Other events are ignored.", "server/github/webhook.ts"],
        ["Commit message kept", "First line, 300 characters", "The rest is cut off.", "server/github/webhook.ts"],
      ])}
      {wrong("github", [
        [
          "“No repositories shared with the app yet.”",
          <>Open <B>Install the GitHub App</B> and share at least one repository.</>,
        ],
        [
          "“No repositories match “QUERY”.”",
          <>The search found nothing. Clear it, or add the repository with Add another account or repository.</>,
        ],
        [
          "“The GitHub App is not configured.” or “The GitHub App is not set up on this installation.”",
          <>This copy of Egg has no GitHub app set up. Whoever runs it sets the GITHUB_APP_* and GITHUB_WEBHOOK_SECRET variables.</>,
        ],
        [
          "“GitHub could not be connected. Try again.” or “That GitHub link expired. Try again.”",
          <>Press I already installed it again, in one browser, within 10 minutes.</>,
        ],
        [
          "“The GitHub App is no longer installed on that account.”",
          <>Install it again on GitHub, then press I already installed it.</>,
        ],
        [
          "“GitHub refused to issue an access token (STATUS).”, “GitHub did not accept the authorization (ERROR).” or “Could not list repositories (STATUS).”",
          <>GitHub rejected the request. Try again. If it repeats, reinstall the app.</>,
        ],
        [
          "“That GitHub installation is not linked to your account.”",
          <>Another Egg account linked that installation first. Install the app yourself on your own account.</>,
        ],
        [
          "A push did not deploy",
          <>Check Deploy automatically on push, that the project came from the app and not a pasted URL, and that the push was to a branch and not a tag or a deletion.</>,
        ],
        [
          "A webhook delivery answers 401 or 503 in GitHub’s list",
          <>401 “bad signature” means the webhook secret in GitHub does not match the one Egg has. 503 “webhook not configured” means Egg has none. Whoever runs Egg sets GITHUB_WEBHOOK_SECRET.</>,
        ],
        [
          "No comment on a pull request",
          <>
            Check that the pull request is not a draft or from a fork, and that the app has Pull requests read and
            write access. The deploy itself is not affected.
          </>,
        ],
      ])}
      {example("github", {
        title: "Try a change in a pull request",
        given: (
          <>
            Sam wants to try a new command in <C>recipe-bot</C> without touching the live bot.
          </>
        ),
        steps: [
          { title: "Push a branch", body: <>Sam pushes branch <C>new-search</C>. A preview starts building.</> },
          { title: "Open a pull request", body: <>Sam opens a pull request into <C>main</C>.</> },
          { title: "Merge it", body: <>Later Sam merges and closes the pull request.</> },
        ],
        result: (
          <>
            A preview deployment builds on port <C>20000</C>. When it finishes the pull request gets one comment,
            “Preview ready”, with an Open the deployment link. When Sam closes the pull request, the preview is
            stopped and removed from the container and its deployment is marked as cleaned up. The merge
            to <C>main</C> deploys to production on its own.
          </>
        ),
      })}
      {related([
        ["deployments", "Deployments"],
        ["hooks", "Deploy hooks"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),

  hooks: () => (
    <Section
      id="hooks"
      intro="A private URL that starts a deployment when it receives a POST. Use it from CI, a cron job or a script."
    >
      <P>
        A deploy hook is for anything that cannot use the GitHub app: a CI service, a scheduled job, a script on
        your laptop, or a project made from a pasted public address. The URL is the only credential, so the caller
        needs no token and no cookie. You need a project and a way to send an HTTP POST.
      </P>
      {steps("hooks", [
        {
          title: "Create the hook",
          body: (
            <>
              Open the project, Settings, <B>Deploy Hook</B>, and press <B>Create hook</B>. Until then the card says
              “No hook yet. Create one to get a URL you can call from CI.”
            </>
          ),
        },
        {
          title: "Copy the URL now",
          body: (
            <>
              The card shows the URL in a copy field, and says “Copy it now. For safety it is not shown again.
              Anyone with this URL can deploy this project, so treat it like a password.” Only a hash is stored. It
              also shows a ready-made <C>curl -X POST</C> line.
            </>
          ),
        },
        {
          title: "Call it",
          body: (
            <>
              Send a POST. An optional JSON body picks a branch; a branch other than the production branch builds a
              preview. With no body, the production branch is built.
            </>
          ),
          code: {
            label: "Terminal",
            code: `curl -X POST https://your-egg/api/hooks/deploy/ndh_...\ncurl -X POST -H "Content-Type: application/json" -d '{"branch":"new-search"}' https://your-egg/api/hooks/deploy/ndh_...`,
          },
        },
        {
          title: "Replace or revoke",
          body: (
            <>
              <B>Make a new URL</B> replaces the old one, which stops working at once. <B>Revoke</B> removes the
              hook. After either, a call to the old URL answers 404. When a hook exists but its URL is hidden, the
              card says “A hook is active and its URL is hidden. Make a new one to see a URL again; the old one stops
              working at once.”
            </>
          ),
        },
      ])}
      <List>
        <li>
          A good call answers 202 with <C>{`{ "deployment": { "id", "state", "branch", "env" } }`}</C>. The state is
          “queued”. The deployment’s source is “hook”, its author “deploy hook” and its message “Triggered by deploy
          hook”. Activity records “Deployed through the deploy hook for” the project.
        </li>
        <li>
          The build is of the tip of the branch at the moment it runs. A hook cannot name a commit. If the branch
          does not exist, the deployment ends as Error with “Could not clone the repository…”.
        </li>
        <li>
          The body can only hold a <C>branch</C>, with the same rules as a project branch: letters, digits and . _ -
          /, up to 200 characters, no leading hyphen and no “..”. Any other field is refused.
        </li>
        <li>
          The URL looks like <C>/api/hooks/deploy/ndh_</C> followed by 32 characters. It does not expire. There is
          no sign-in, no cookie and no origin check on this route; the URL is the only secret.
        </li>
        <li>
          Replacing or revoking a hook from the API needs the <C>deployments:write</C> permission.
        </li>
      </List>
      <Callout tone="warning" title="Treat it like a password">
        Anyone with the URL can deploy that project. Do not paste it in a public repository or a chat. If it leaks,
        press Make a new URL.
      </Callout>
      {why(
        <>
          A hook refuses a second call while a deployment is running instead of queueing it, so a script stuck in a
          loop cannot fill the queue. The body is limited to a branch so that a leaked URL can only start a build of
          code that is already in your repository, never run a command or change a setting.
        </>
      )}
      {limits("hooks", [
        ["Hooks per project", "One", "Make a new URL replaces it.", "server/hooks.ts"],
        ["Running deployments", "One per project at a time", "409 “A deployment is already running for this project.”", "server/hooks.ts"],
        ["Request body", "4 KB", "413 “That request is too large.”", "app/api/hooks/deploy/[token]/route.ts"],
        ["Branch name", "Same rules as a project branch", "400 with the reason.", "server/hooks.ts"],
      ])}
      {wrong("hooks", [
        [
          "404 “Unknown hook”",
          <>The URL is wrong, was replaced, was revoked, or is cut off. A malformed token gives the same answer. Copy the current URL, or make a new one.</>,
        ],
        [
          "409 “A deployment is already running for this project.”",
          <>A deployment is Queued, Building or Deploying. Call again when it finishes.</>,
        ],
        [
          "400 “Request body must be JSON”",
          <>Send valid JSON, or no body at all.</>,
        ],
        [
          "400 “Unrecognized key: \"NAME\"”",
          <>The body holds a field other than <C>branch</C>. Remove it.</>,
        ],
        [
          "400 “Branch names may use letters, digits, . _ - and /” or “Invalid branch name”",
          <>Use a branch name that git accepts and that does not start with a hyphen.</>,
        ],
        [
          "400 “Invalid input: expected string, received number” or “Too small: expected string to have >=1 characters”",
          <>The branch must be a non-empty string.</>,
        ],
        [
          "413 “That request is too large.”",
          <>The body is over 4 KB. Send only <C>{`{ "branch": "name" }`}</C>.</>,
        ],
        [
          "The call returns 202 but the deployment ends as Error",
          <>The call only queues the build. Open the deployment to read why it failed.</>,
        ],
        [
          "“Could not create the hook” or “Could not revoke the hook”",
          <>The change did not go through. Try again.</>,
        ],
      ])}
      {example("hooks", {
        title: "Redeploy every night",
        given: (
          <>
            Sam wants <C>recipe-bot</C> to redeploy every night so it picks up a data file fetched at build time.
          </>
        ),
        steps: [
          { title: "Create the hook", body: <>Sam creates the hook and copies the URL.</> },
          { title: "Store it", body: <>Sam stores the URL as a secret in a cron service.</> },
          { title: "Schedule the call", body: <>Sam runs the <C>curl -X POST</C> line at 03:00.</> },
        ],
        result: (
          <>
            Each night a deployment appears in the list with source “hook”. If a deployment is already running at
            that time, the call answers 409 and nothing breaks; the next night’s call works.
          </>
        ),
      })}
      {related([
        ["github", "GitHub and previews"],
        ["api", "Access tokens and the API"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),

  notifications: () => (
    <Section
      id="notifications"
      intro="Messages to a Discord or Slack channel from an incoming webhook, when a deployment finishes or an alert fires."
    >
      <P>
        A notification tells a person that a deployment finished, without anyone watching the dashboard. Each
        project has one webhook address, and every finished deployment, Ready or Error, can post a short message
        there. You need an incoming webhook URL from Discord or Slack. The same webhook also carries the alerts
        described under Monitoring and uptime.
      </P>
      {steps("notifications", [
        {
          title: "Make the webhook",
          body: (
            <>
              In Discord, make a webhook for a channel; in Slack, make an incoming webhook. Copy its URL.
            </>
          ),
        },
        {
          title: "Save it",
          body: (
            <>
              Open the project, Settings, <B>Notifications</B>. Paste the <B>Webhook URL</B>, choose{" "}
              <B>Send</B> (Every deployment, or Failures only) and press <B>Save</B>. The page says “Saved. Send a
              test message to check it.” The Save button stays off while the URL box is empty, so to change only{" "}
              <B>Send</B> later, paste the URL again.
            </>
          ),
        },
        {
          title: "Send a test",
          body: (
            <>
              Press <B>Send test message</B>. It posts “Test from Egg for PROJECT” and the card says “Sent.
              Check the channel.” The button appears once a URL is saved.
            </>
          ),
        },
        {
          title: "Remove it",
          body: (
            <>
              Press <B>Remove</B> to delete the saved URL. Messages stop at once.
            </>
          ),
        },
      ])}
      <List>
        <li>
          Accepted: https only, no port, query, fragment or credentials. Discord hosts are <C>discord.com</C>,{" "}
          <C>discordapp.com</C>, and both with a <C>ptb.</C> or <C>canary.</C> prefix, with a path{" "}
          <C>/api/webhooks/ID/TOKEN</C>, where ID is digits. Slack is <C>hooks.slack.com</C> with a path{" "}
          <C>/services/X/Y/Z</C>.
        </li>
        <li>
          The URL is stored encrypted and never shown again. The card says “Sending to Discord for every finished
          deployment. The URL is hidden. Paste a new one to replace it.” (or “for failed deployments only”, or
          “Slack”). Saving a new URL replaces the old one.
        </li>
        <li>
          A message reads “PROJECT is live in production” (or “a preview”) with the branch, short commit, the commit
          message in quotes up to 120 characters and the build time, or “PROJECT failed to deploy to production” (or
          “a preview”) with the branch, short commit and the error, up to 200 characters. The last line is a link to
          the deployment. Discord messages are sent so that they cannot ping anyone.
        </li>
        <li>
          Failures only hides the “is live” messages. Canceled deployments never send. A failed post is only logged
          and never changes the deployment.
        </li>
        <li>
          The Alerts card on the same page can also turn off “Deployment results”, and pause every alert for a while.
          Both stop these messages too. The deployment still appears in the alert history.
        </li>
      </List>
      {why(
        <>
          Egg only accepts Discord and Slack addresses of the exact shape those services use, and refuses redirects,
          so a saved address cannot send Egg’s request somewhere else. A failed post is dropped, not retried, because a
          broken channel must never hold up or fail a deployment.
        </>
      )}
      {limits("notifications", [
        ["Webhook per project", "One", "Saving a new URL replaces it.", "server/notify.ts"],
        ["URL length", "500 characters", "The server refuses it.", "server/notify.ts"],
        ["Time to post", "5 seconds", "The post is dropped and logged; redirects are refused.", "server/notify.ts"],
        ["Commit message in a message", "120 characters", "The rest is cut off.", "server/notify.ts"],
        ["Error text in a message", "200 characters", "The rest is cut off.", "server/notify.ts"],
      ])}
      {wrong("notifications", [
        [
          "“That is not a valid URL.”",
          <>Paste the full address, starting with https://.</>,
        ],
        [
          "“Use the plain https webhook URL from Discord or Slack.”",
          <>Remove any port, query string, or fragment from the URL.</>,
        ],
        [
          "“Only Discord and Slack incoming webhook URLs are supported.”",
          <>Check the host and path against the list above.</>,
        ],
        [
          "“Add a webhook URL first.”",
          <>Save a URL before pressing Send test message.</>,
        ],
        [
          "“Discord answered STATUS.” or “Slack answered STATUS.”",
          <>The service refused the post. The webhook may be deleted or the channel gone. Make a new webhook.</>,
        ],
        [
          "“Could not save”, “Could not send” or “Could not remove”",
          <>The change did not go through. Try again.</>,
        ],
        [
          "Messages stop arriving",
          <>
            Check the Alerts card: the “Deployment results” channel and an active pause also stop deployment
            messages. The events still appear in the history. Then check Send is not set to Failures only.
          </>,
        ],
      ])}
      {example("notifications", {
        title: "Hear about failures in Discord",
        given: (
          <>
            Sam has a private Discord server with a <C>#bot-deploys</C> channel.
          </>
        ),
        steps: [
          { title: "Make a webhook", body: <>Sam makes a webhook in the <C>#bot-deploys</C> channel.</> },
          { title: "Save it", body: <>Sam pastes it into Notifications, chooses Failures only and presses Save.</> },
          { title: "Send a test", body: <>Sam presses Send test message.</> },
        ],
        result: (
          <>
            The channel shows “Test from Egg for recipe-bot”. From now on it only hears about failed
            deployments, and about alerts if those are on.
          </>
        ),
      })}
      <H2 id="notifications-webhooks" title="Signed webhooks for your own code" />
      <P>
        Discord and Slack are for people. To tell a program, use <B>Webhooks</B> in Account. Egg sends a signed JSON
        message to an https address when a deployment starts, succeeds or fails. It covers every project on your
        account.
      </P>
      <Steps
        id="notifications-webhooks-steps"
        level={3}
        items={([
          {
            title: "Add the address",
            body: <>Open Account, find <B>Webhooks</B>, paste the address under <B>Add a webhook address</B> and press <B>Add webhook</B>. The button reads “Adding…” while it works.</>,
          },
          {
            title: "Copy the secret",
            body: <>The card shows the signing secret once, starting with <C>whsec_</C>, under “Signing secret for HOST”. Copy it before you press <B>I have copied it</B>. It cannot be read again.</>,
          },
          {
            title: "Send a test",
            body: <>Press <B>Send test</B> on the new row. The toast says “Test message delivered”, and the row lists the delivery under <B>Recent deliveries</B>. A test is one attempt, with no retries, and carries <C>{`"test": true`}</C>.</>,
          },
          {
            title: "Check the signature in your code",
            body: (
              <>
                Every request has an <C>X-Egg-Signature</C> header of the form <C>t=TIME,v1=HEX</C>. The value
                is an HMAC-SHA256 of <C>TIME.BODY</C>, keyed with your secret. Refuse a request that does not match,
                or whose time is more than 300 seconds from yours.
              </>
            ),
            code: {
              label: "Node.js",
              code: `import { createHmac, timingSafeEqual } from "node:crypto";

export function isFromEgg(secret, header, body) {
  const m = /^t=(\\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const want = createHmac("sha256", secret).update(m[1] + "." + body).digest();
  return timingSafeEqual(want, Buffer.from(m[2], "hex"));
}`,
            },
          },
          {
            title: "Pause, replace or delete",
            body: (
              <>
                <B>Pause</B> (then <B>Resume</B>) stops messages without deleting the webhook. <B>New secret</B> opens
                “Replace the secret?”, and <B>Replace secret</B> makes the old secret stop working at once and shows
                the new one once. <B>Delete</B> removes the webhook and its history.
              </>
            ),
          },
        ] as Step[]).map(toStep)}
      />
      <P>
        The body is JSON with <C>event</C> (<C>deployment.started</C>, <C>deployment.succeeded</C>,{" "}
        <C>deployment.failed</C> or <C>webhook.test</C>), <C>project</C> with its id and slug, <C>deployment</C> with
        its id, branch, short commit and state, and <C>time</C> as an ISO date. It never carries variables, logs,
        commit messages, errors or links. The headers <C>X-Egg-Event</C> and <C>X-Egg-Delivery</C> name
        the event and this delivery. A deployment that is canceled sends nothing, and the started message goes out
        when the build begins.
      </P>
      <Limits
        id="notifications-webhooks-limits"
        level={3}
        items={([
          ["Webhooks per account", "10", "“You can have up to 10 webhooks. Delete one first.”", "server/webhooks.ts"],
          ["Address", "https, standard port, a full domain name, no credentials, no #, 500 characters at most", "The form says what to change, for example “The URL must start with https://.” or “Use a domain name, not an IP address.”", "server/webhook-net.ts"],
          ["Where it can point", "A public address", "A private or internal address is refused when the message is sent, as “points at a private address”.", "server/webhook-net.ts"],
          ["Time to answer", "5 seconds", "The attempt counts as failed with “timed out after 5 seconds”. Redirects are not followed.", "server/webhook-net.ts"],
          ["Attempts", "3, with pauses of 2 and 10 seconds", "A failed delivery is listed with a short reason, such as “receiver answered 500” or “could not connect”.", "server/webhooks.ts"],
          ["Signature age", "300 seconds", "Your code should refuse an older timestamp.", "server/webhook-sign.ts"],
          ["Delivery history", "30 days", "Older rows are removed.", "server/webhooks.ts"],
        ] as [string, string, ReactNode, string][]).map(([name, value, atLimit, source]) => ({ name,
    source, value, atLimit }))}
      />
      {related([
        ["monitoring", "Monitoring and uptime"],
        ["hooks", "Deploy hooks"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),

  monitoring: () => (
    <Section id="monitoring" intro="What your app is doing now, and what it has been doing.">
      <P>
        You need a deployed project and a worker that is running. For messages when something goes wrong, you
        also need a webhook under Notifications.
      </P>
      <H3 id="monitoring-service-card" />
      <P>
        The Service card is on the project page once something is live. It shows Status (Running, Starting,
        Crashed, Stopped, Not deployed or Unknown), Uptime, Memory, Restarts and Health check (“HTTP CODE in MS
        ms”, “No answer” or “Not checked”). It reads systemd on your container and sends one real request to
        the health path with a 3 second limit.
      </P>
      <List>
        <li>
          It looks again every 30 seconds while the tab is visible. Egg reuses a reading that is under 30 seconds old,
          so opening the page does not always open a new connection to your container. A line under the card says
          when the reading was taken: “Checked” with the time, “Readings are reused for 30 seconds; Check now asks the
          container again.”
        </li>
        <li><B>Check now</B> always asks your container, whatever the age of the last reading.</li>
        <li>
          <B>Restart</B> restarts the production service after you confirm “Restart the service?”. It builds
          nothing.
        </li>
      </List>
      <H3 id="monitoring-resources" />
      <P>
        The Resource use card on the project page shows memory and CPU of this one service for the last 24
        hours. Until it has two readings it says “Collecting data.” CPU is a share of one core, so it can pass 100. A point is left blank when there is no earlier reading, the gap is over 30
        minutes, or the counter went backwards after a restart. The Resources page in the sidebar shows load,
        memory and disk for the whole server over 24 hours or 7 days, with a table of each project’s memory, CPU
        and restarts.
      </P>
      <P>
        The worker samples every connected server every 5 minutes by default and keeps 7 days. Project samples
        are written only when the service is running.
      </P>
      <H3 id="monitoring-uptime" />
      <P>
        Every 5 minutes the worker checks each project that has a live production release and no deployment in
        progress. A project is up when its service is running and its health path answers with a status from 1
        to 499. Without <C>curl</C> on the container, running is enough. A server that cannot be reached is
        skipped, and its projects are not reported as down.
      </P>
      <P>
        A project is declared down after a number of failed checks in a row, 2 by default. You get one message
        when it goes down and one when it is answering again. The project header shows “Answering”, “Not
        answering since TIME” or “Not checked yet”, and links to the alert history. Each project sets its own
        alerts.
      </P>
      {steps("monitoring", [
        {
          title: "Open the Alerts card",
          body: <>Open the project, Settings, <B>Alerts</B>. A webhook must be saved in the Notifications card for any message to be sent.</>,
        },
        {
          title: "Set “When to warn”",
          body: (
            <>
              Set <B>Disk full (%)</B>, <B>Memory used (%)</B>, <B>CPU load per core (%)</B>, <B>Failed checks
              before down</B> and, if you want one, <B>Slow response limit (ms)</B>.
            </>
          ),
        },
        {
          title: "Choose the channels",
          body: (
            <>
              Under <B>Send to the webhook</B>, tick any of: The app stops answering, The app answers again,
              Disk, memory or CPU warnings, Deployment results. All four are on by default.
            </>
          ),
        },
        {
          title: "Save",
          body: <>Press <B>Save</B> at the bottom of the card. A message says “Alert settings saved”.</>,
        },
        {
          title: "Pause when you need quiet",
          body: (
            <>
              Under <B>Pause all alerts</B>, choose “For 1 hour”, “For 24 hours” or “Until I resume” and press{" "}
              <B>Pause</B>. It takes effect at once, without Save. The card then shows “Alerts are paused”; press{" "}
              <B>Resume alerts</B> to end it. While paused nothing is sent, but the history still records the
              event with the badge “Not sent, paused”.
            </>
          ),
        },
      ])}
      <Table
        caption="Alert settings"
        head={["Setting", "Range", "Default"]}
        rows={[
          ["Disk full (%)", "Whole number, 1 to 100", "90"],
          ["Memory used (%)", "Whole number, 1 to 100", "90"],
          ["CPU load per core (%)", "Whole number, 1 to 100. The 1 minute load divided by the core count.", "90"],
          ["Failed checks before down", "Whole number, 1 to 10", "2"],
          ["Slow response limit (ms)", "Empty (off), or 50 to 60000. A slower answer counts as a failed check.", "Off"],
        ]}
      />
      <List>
        <li>
          A resource alert fires once when a value reaches its limit and once more when it falls back below it.
          Nothing is sent in between. Disk, memory and CPU are for the whole server, checked against each
          project’s own limits.
        </li>
        <li>
          History keeps the newest 50 alerts for 90 days, with the badges “Still happening”, “Resolved” and
          “Not sent, paused”. Open alerts are kept past 90 days.
        </li>
        <li>
          The “Needs attention” card on the Projects page lists apps not answering, projects whose latest
          deployment failed, a disk, memory or CPU load at or over the lowest limit you set (90% by default),
          and projects with alerts paused. It was called the Alerts card in older docs.
        </li>
      </List>
      {limits("monitoring", [
        ["Check interval", "5 minutes by default", "A very short outage can be missed."],
        ["Failed checks before down", "1 to 10, default 2", "You pick the number from a list, so there is no message."],
        ["Resource limits", "1 to 100 each, default 90", "“The disk limit must be a whole number from 1 to 100.” or “The disk limit must be from 1 to 100.” (and memory, CPU)"],
        ["Slow response limit", "50 to 60000 ms, or empty", "“The response time limit must be a whole number from 50 to 60000.” or “The response time limit must be from 50 to 60000.”"],
        ["Samples kept", "7 days", "Older readings are deleted; the charts show 24 hours or 7 days."],
        ["Service card refresh", "Every 30 seconds, with a 20 second read. A reading under 30 seconds old is reused; Check now is never reused", "“Could not read the service from your container.”"],
      ])}
      {wrong("monitoring", [
        [
          "“The service is STATE.” / “The service is running but nothing answered on its health path.”",
          <>The down message says why. Fix the app, or the health path in Settings, Build and Run.</>,
        ],
        [
          "“The health path took MS ms to answer, over your limit of N ms.”",
          <>Raise the Slow response limit, or make the page faster.</>,
        ],
        [
          "“The health path answered HTTP CODE.”",
          <>A 500 or above counts as down. A 404 does not, because the check treats 1 to 499 as healthy.</>,
        ],
        [
          "“Could not load alert settings”",
          <>Press <B>Try again</B> on the Alerts card.</>,
        ],
        [
          "No messages at all",
          <>
            Check that a webhook is saved, the channel is ticked, alerts are not paused, and the app has failed
            as many checks in a row as your setting.
          </>,
        ],
      ])}
      {example("monitoring", {
        title: "Get warned before memory runs out",
        given: (
          <>
            <C>recipe-bot</C> sometimes runs out of memory on Sam’s container. Sam has a webhook saved.
          </>
        ),
        steps: [
          { title: "Set the limits", body: <>Sam sets Memory used (%) to <C>80</C> and Failed checks before down to <C>3</C>.</> },
          { title: "Keep the channels", body: <>Sam leaves the four boxes under Send to the webhook ticked and presses Save.</> },
        ],
        result: (
          <>
            When the server passes 80% memory, the channel gets one message like “Memory on the server reached
            82% (your limit is 80%).” A second arrives when it falls back below. If the bot stops answering for
            three checks in a row, about 15 minutes, a “recipe-bot is not answering” message follows.
          </>
        ),
      })}
      {related([
        ["notifications", "Notifications"],
        ["status-page", "Status page"],
        ["logs", "Logs"],
      ])}
    </Section>
  ),

  "status-page": () => (
    <Section id="status-page" intro="A public page that says whether one app is answering.">
      <P>You need a deployed project. The figures come from the uptime checks, so the worker must be running.</P>
      {steps("status-page", [
        {
          title: "Publish it",
          body: (
            <>
              Open the project, Settings, <B>Public Status Page</B> (the section list at the top of Settings calls
              it Status Page), and press <B>Publish status page</B>. It says “Not published.” until you do.
            </>
          ),
        },
        {
          title: "Share the link",
          body: (
            <>
              Copy the link from <B>Status page URL</B>. It is <C>/status/KEY</C> on your Egg address. The key is 12 random URL-safe
              characters, and the page asks search engines not to index it.
            </>
          ),
        },
        {
          title: "Take it down",
          body: (
            <>
              Press <B>Unpublish</B>. The key is deleted, so the old link stops working. Publishing again makes
              a new key.
            </>
          ),
        },
      ])}
      <List>
        <li>
          Anyone with the link sees the project name, a state card, the share of the last 30 days the app was
          answering, a strip of 30 days, and the latest 10 outages under “Recent outages”. Nothing else: no repository, port, server
          or commit.
        </li>
        <li>
          The state card reads “Operational” (“The app is answering.”), “Not responding” (“The app has stopped
          answering.”) or “No data yet” (“Checks have not run for this app yet.”). The percentage is withheld
          until a check has run.
        </li>
        <li>
          The strip has one square per UTC day, with a key beneath it. Green is “Answered all day”, amber “Down
          for part of a day”, red “Down for most of a day” (more than half of it) and grey “No checks yet”.
          Hover a square to see the minutes, or open “Show each day as text” for a table of every day.
          With no outages the list says “None in the last 30 days.”, or “Nothing recorded yet.” before any
          check has run.
        </li>
        <li>
          A slow answer over your Slow response limit counts as down here too, because it fails the check.
        </li>
      </List>
      {limits("status-page", [
        ["Window", "30 days", "Older days are not shown."],
        ["How long the page is kept before it is read again", "60 seconds, dropped early when the app’s state changes or the page is unpublished", "A change can take up to a minute to show on a page that is already open.", "server/status-page-cache.ts"],
        ["Recent outages listed", "10", "Older outages are not listed."],
        ["Check interval", "5 minutes", "An outage shorter than that can be missed."],
        ["Status pages per project", "One", "Publishing again makes a new key."],
      ])}
      {wrong("status-page", [
        [
          "“No data yet”",
          <>No check has run yet. Wait for the next 5 minute pass.</>,
        ],
        [
          "The link shows a not found page",
          <>The page was unpublished, or you published again and the key changed. Copy the new link.</>,
        ],
        [
          "The page says Not responding but the app works",
          <>
            The check uses your health path. Make sure it answers with a status below 500, within your slow
            response limit if you set one.
          </>,
        ],
        [
          "An outage is missing",
          <>It was shorter than the 5 minute check interval, or the server could not be reached at all, which is not reported as the app being down.</>,
        ],
      ])}
      {example("status-page", {
        title: "Let friends check the bot",
        given: (
          <>
            Sam’s friends ask whether <C>recipe-bot</C> is down.
          </>
        ),
        steps: [
          { title: "Publish", body: <>Sam presses Publish status page.</> },
          { title: "Share", body: <>Sam pastes the link into the Discord server’s pinned message.</> },
        ],
        result: (
          <>
            The page shows “Operational”, the 30 day share and a strip of green squares. A night when Sam
            redeployed twice shows one amber square.
          </>
        ),
      })}
      {related([
        ["monitoring", "Monitoring and uptime"],
        ["notifications", "Notifications"],
        ["analytics", "Analytics"],
      ])}
    </Section>
  ),

  analytics: () => (
    <Section
      id="analytics"
      intro="Page views for your site, counted by a small script. Nest does not share its web server logs, so the numbers have to come from the page itself."
    >
      <P>
        You need a deployed project that serves web pages, and access to the head of those pages. A bot with no
        web page has nothing to count.
      </P>
      <H3 id="analytics-setup-steps" />
      {steps("analytics", [
        {
          title: "Turn it on",
          body: (
            <>
              Open the project’s Analytics tab, find <B>Count visits</B> and press <B>Turn on analytics</B>.
            </>
          ),
        },
        {
          title: "Paste the snippet",
          body: <>The card is now titled <B>Tracking snippet</B>. Copy the snippet from it into the head of every page you want counted.</>,
          code: {
            label: "HTML",
            code: `<script defer data-key="nda_..." src="https://your-egg/api/analytics/script?key=nda_..."></script>`,
          },
        },
        {
          title: "Redeploy and visit",
          body: <>Redeploy so the page has the snippet, then open the page in a normal browser window.</>,
        },
        {
          title: "Switch off when done",
          body: (
            <>
              Press <B>Turn off</B> to remove the key. Existing numbers stay until they age out after 90 days.
            </>
          ),
        },
      ])}
      <H3 id="analytics-data" />
      <P>
        “Page views” and “Visitors” for the last 30 days, “Page views per day” as a bar for each day, your top
        10 pages under “Top pages”, and, once Referrers and campaigns is on, the top 10 sites under “Where visitors came from”. Visitors are counted per day, so someone who comes on two days counts twice.
        Percentages, shares and the median appear only with at least 50 visits behind them. Below that you see
        counts and “Not enough data”.
      </P>
      <P>
        The “What else to record” card, which appears once analytics is on, adds eight things. Each is a
        checkbox that is off until you tick it and saves at once, with “Saved.” beneath. With all of them off
        the script is the plain page view script: the path, nothing more. Under Settings, “Analytics defaults”
        has the same eight checkboxes, all off. They decide what a project starts with the first time you turn
        analytics on for it. Projects that already have analytics are not changed.
      </P>
      <List>
        <li>
          <B>Clicks</B> (“Top clicks”). The label of the link, button or element with <C>data-egg-track</C> that
          was clicked: <C>data-egg-track</C>, else <C>aria-label</C>, else the text, at most 40 characters. A label
          holding an email address is dropped. It never records input values or form content, and stores only
          the project, the UTC day and the label.
        </li>
        <li>
          <B>Time on page</B> (a card of the same name, with a Median). How long the page was open and visible, in four groups: under 10 seconds, 10 to
          60 seconds, 1 to 5 minutes, over 5 minutes. It is sent when the visitor leaves.
        </li>
        <li>
          <B>Funnel.</B> Two to six steps in order. For each, pick Page and type a path starting with <C>/</C>,
          or pick Tracked name. Press <B>Add step</B> for more, then <B>Save steps</B>. A visitor counts at a step only after reaching the ones before it, on the same UTC day.
        </li>
        <li>
          <B>Referrers and campaigns</B> (“Where visitors came from” and “Campaigns”). The script sends the host of
          the referring site only, never its full address or query string. It does this once for each page load, and
          a link from one page of your own site to another is not a referrer. It also sends <C>utm_source</C>, <C>utm_medium</C> and <C>utm_campaign</C> from the address when they are
          there, each trimmed and cut to 80 characters. No other parameter is read. They are stored with the page
          view, and the host is kept as sent, so <C>www.</C> stays.
        </li>
        <li>
          <B>Speed and errors</B> (“Speed” and “Errors”). Five measurements from the browser, sent once per page
          view when the visitor leaves or switches tab: Largest Contentful Paint, Cumulative Layout Shift,
          Interaction to Next Paint, First Contentful Paint and Time to First Byte. Times are in milliseconds (ms)
          and shown in ms or seconds (s); layout shift is a score with no unit. The table shows the median and the
          75th percentile for each, and labels the 75th percentile Good, Needs work or Poor with Google’s
          thresholds: LCP 2.5 s and 4 s, CLS 0.1 and 0.25, INP 200 ms and 500 ms, FCP 1.8 s and 3 s, TTFB 800 ms
          and 1800 ms. Errors are the message (at most 200 characters, with any query string cut from addresses
          and any email address replaced), the script’s file name without its address, and the line. At most 5
          errors are sent for a page view. No stack, no address and no visitor id.
        </li>
        <li>
          <B>Custom events</B> (“Events”). A click on an element with <C>data-egg-track</C> is recorded by name. Add{" "}
          <C>data-egg-value</C> for a value of up to 40 characters, letters, numbers, spaces and - _ . : only, such
          as a plan name. A value that breaks the rule is dropped and the event still counts. It stores the name,
          the value and the day, no visitor id. A funnel step can use the same name.
        </li>
        <li>
          <B>Live view</B> (“On the site now”). Page views in the last 5 minutes and, with Retention on, the
          distinct visitors in that window. With Retention off it says “Unique visitors need retention on”. While
          a page is open and visible, the script sends a small signal every 60 seconds, which Egg deletes after an
          hour. It needs Retention to count visitors, so the script sends the signal only when both are on.
        </li>
        <li>
          <B>Retention</B> (“Returning visitors”). This stores a random id in the visitor’s browser, not a cookie.
          The id is kept in the browser’s local storage under the name <C>_egg_id</C>, and a visitor can remove it by
          clearing site data. Egg stores only an HMAC (a keyed hash) of it together with the project, never the id. The salt comes from the server secret and changes every 90
          days, so someone who comes back after a change counts as new. Turning retention off deletes the codes
          already stored, and the script removes the id from the browser. To turn it off, clear the Retention checkbox
          under What else to record on the project’s Analytics tab, and leave it cleared under Analytics defaults
          in Settings. The card shows the visitors in the last 7
          days, then of the visitors who first came 7 to 14 days ago how many came back on a later day within 7
          days, and of those who first came 30 to 37 days ago how many came back within 30 days. A group under 20
          visitors shows “Not enough data yet”.
        </li>
      </List>
      <H3 id="analytics-privacy" />
      <List>
        <li>By default only the page path is recorded. No cookies. Everything else is a switch that starts off.</li>
        <li>
          No IP address or browser details are stored. A visitor is a hash of the address, browser, project and
          the date, salted with the server secret and shortened. It changes daily, so nobody can be followed
          across days.
        </li>
        <li>
          Nothing is counted for browsers that send Do Not Track or Global Privacy Control, on localhost, or for
          known bots. The collector also drops requests that carry either signal.
        </li>
        <li>
          The path loses its query and fragment. The referrer is reduced to its host, kept as it is.
        </li>
        <li>
          The script stores nothing in the browser unless Retention is on, and then only one random id in local
          storage. No IP address is stored by any feature. The address is used only to limit how fast one visitor
          can send.
        </li>
        <li>
          On a copy of Egg that you run yourself behind a reverse proxy, set <C>TRUST_PROXY=1</C>. It is off by
          default. Without it Egg ignores the proxy headers, so every visitor counts as one address: the daily
          visitor hash then tells people apart only by browser, and the limits on how fast one visitor can send are
          shared by everyone. Turn it on only when every request comes through a proxy you run that sets those
          headers itself.
        </li>
        <li>
          History is kept for 90 days. A change to a setting reaches visitors within about 5 minutes, because the
          script is cached.
        </li>
      </List>
      {limits("analytics", [
        ["History kept", "90 days", "Older rows are deleted."],
        ["Percentages and median", "At least 50 visits", "“Not enough data”"],
        ["Funnel steps", "2 to 6", "“A funnel needs at least 2 steps” or “A funnel has at most 6 steps”"],
        ["Tracked name", "Letters, digits, spaces and - _ . : up to 40 characters", "“A tracked name uses letters, numbers, spaces and - _ . : and is at most 40 characters”"],
        ["Page step", "Starts with /", "“A page step starts with \"/\", like /pricing”"],
        ["Page views", "1 per second per project and address. With TRUST_PROXY off, all visitors share one address", "Extra views are dropped.", "server/analytics.ts"],
        ["Every other report (clicks, time, goals, events, speed, errors, live signal)", "30 per 10 seconds per project and address. With TRUST_PROXY off, all visitors share one address", "Extra events are dropped.", "server/analytics-events.ts"],
        ["Path and referrer", "200 and 100 characters", "The rest is cut off."],
        ["Campaign values", "80 characters each", "The rest is cut off."],
        ["Error message and file name", "200 and 100 characters, 5 errors per page view", "The rest is cut off or not sent."],
        ["Event value", "Letters, digits, spaces and - _ . : up to 40 characters", "The value is dropped. The event still counts."],
        ["Speed figures", "At least 50 page views per measurement", "“Not enough data”"],
        ["Live view", "Last 5 minutes, signal every 60 seconds, deleted after 1 hour", "Older signals are deleted."],
        ["Returning visitors", "At least 20 visitors in the group", "“Not enough data yet”"],
        ["Retention code", "Changes every 90 days", "A visitor after a change counts as new."],
      ])}
      {wrong("analytics", [
        [
          "“Nothing counted yet” (or “Analytics is off”)",
          <>
            Check the snippet is in the head of a page that was redeployed, that your browser is not sending
            Do Not Track, and that you are not on localhost.
          </>,
        ],
        [
          "“Not enough data”",
          <>The percentages need 50 visits behind them. The counts are still shown.</>,
        ],
        [
          "“Not enough data yet” under Returning visitors",
          <>The group needs at least 20 visitors. Retention only counts visitors from the day it was turned on.</>,
        ],
        [
          "“Unique visitors need retention on”",
          <>Turn on Retention under What else to record. Without the random id, visitors cannot be told apart for 5 minutes.</>,
        ],
        [
          "“Could not save” or “Could not change analytics”",
          <>The change did not go through. Try again.</>,
        ],
        [
          "A funnel does not turn on, or “A funnel needs at least 2 steps”",
          <>Fill in at least 2 steps and press Save steps. A funnel with fewer counts as off.</>,
        ],
      ])}
      {example("analytics", {
        title: "Count visits to the bot’s page",
        given: (
          <>
            Sam adds a small web page to <C>recipe-bot</C> that lists recipes, with a Subscribe button.
          </>
        ),
        steps: [
          { title: "Turn it on", body: <>Sam turns on analytics and pastes the snippet in the page head.</> },
          { title: "Record clicks", body: <>Sam ticks Clicks under What else to record and marks the button <C>data-egg-track=&quot;subscribe&quot;</C>.</> },
          { title: "Redeploy", body: <>Sam redeploys.</> },
        ],
        result: (
          <>
            After a week the page shows page views per day, the top pages, and “subscribe” under Top clicks.
            Sam sees no personal data, because none was stored.
          </>
        ),
      })}
      {related([
        ["status-page", "Status page"],
        ["domains", "Domains"],
        ["security", "Security"],
      ])}
    </Section>
  ),
};
