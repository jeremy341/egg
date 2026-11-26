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
      These numbers come from the code that enforces them. Each message names the file that holds the number,
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
      intro="Egg builds your GitHub repository and runs it on your Nest container as a service. Egg is independent, so it is not an official Hack Club product."
    >
      <P>
        Nest gives you a small Linux container that you reach over SSH. Egg connects with a key you
        control, uploads your finished build and runs it as a systemd service on a port, so Nest’s proxy can map
        your domain to that port. You no longer do that work by hand in a terminal.
      </P>
      <P>
        You need a Hack Club account, a Nest container and a GitHub repository. Your container has nothing
        installed ahead of time.
      </P>
      <P>These docs use each word in one way only.</P>
      <List>
        <li>
          <B>Container.</B> Your Nest Linux container, the one you log in to with SSH. Your app runs here.
        </li>
        <li>
          <B>Server.</B> Egg’s menus call a Nest container you have connected to Egg a server. One server is one
          Nest username.
        </li>
        <li>
          <B>Egg machine.</B> The computer that runs the Egg website and its worker. If you use someone else’s Egg,
          it is their computer. If you run Egg yourself, it is yours. It clones your repository and packs the source.
        </li>
        <li>
          <B>Worker.</B> The part of Egg that takes queued deployments and runs them.
        </li>
        <li>
          <B>Build.</B> The install and build of your project. It runs on your container, in a new release folder,
          under a cap.
        </li>
        <li>
          <B>Cap.</B> A hard limit on memory and CPU that the kernel enforces on a build, so a build that goes
          over it stops. Your app keeps running.
        </li>
        <li>
          <B>Archive.</B> The finished build packed into one compressed file, <C>release.tar.gz</C>, for upload.
        </li>
        <li>
          <B>Release.</B> One uploaded build, in its own folder on your container.
        </li>
        <li>
          <B>Production branch.</B> The git branch whose pushes go live. A branch is a named line of commits in
          your repository.
        </li>
        <li>
          <B>Preview.</B> A build of any other branch. It runs as a second service on its own port, so production
          keeps running.
        </li>
      </List>
      <H3 id="overview-push" />
      {steps("overview", [
        {
          title: "GitHub tells Egg about the push",
          body: (
            <>
              GitHub sends the push to Egg with a signed request. Only matching projects with{" "}
              <B>Deploy automatically on push</B> on get a deployment, so GitHub must reach Egg’s web address.
              An Egg on localhost never hears about pushes. There, press <B>Deploy</B> or use a deploy hook.
            </>
          ),
        },
        {
          title: "The deployment joins a queue",
          body: (
            <>
              The worker picks up two queued deployments at a time by default, across all projects. A project
              never runs two at once, so the second waits as Queued. With no worker running, every deployment
              stays Queued.
            </>
          ),
        },
        {
          title: "The worker clones your repository",
          body: (
            <>
              This step runs on the Egg machine. Egg clones the newest commit of the branch into a work folder
              there and packs the source into an archive, so the GitHub token stays on the Egg machine. Nothing is
              installed or built here, and the Egg machine spends no memory or CPU on your build.
            </>
          ),
        },
        {
          title: "The build runs on your container",
          body: (
            <>
              Egg checks your container first: the Node.js version, the package manager your lockfile needs,
              Python 3 and venv for a Python project, systemd-run, timeout, and at least 2048 MB of free disk. A
              failed check ends the deployment with one line that says what to fix, so nothing is uploaded. When
              all checks pass, Egg uploads the source over SSH and unpacks it into a new release folder next to
              the running release. Your install, build and production install commands run there, under the cap.
              <br />
              The memory cap is the server’s <B>Build memory (MB)</B>, 512 MB by default, and never more than your
              container’s memory minus 512 MB. A project with a build step gets at least 1024 MB while it builds, if your container has room for it. The CPU cap is <B>Build CPU limit (cores)</B>.               The build gets no swap and runs at a low CPU priority, so your app wins when the CPU is busy. It
              stops after 15 minutes. Your
              running app keeps serving the whole time. One build runs at a time on a container, and another waits
              for up to 30 minutes. If the build fails, runs out of memory, times out or is canceled, Egg deletes
              the new folder, so the running release stays in place.
            </>
          ),
        },
        {
          title: "The service switches over",
          body: (
            <>
              Egg writes your environment variables to a file that only the service reads. For production, the{" "}
              <C>current</C> link points at the new release and the service restarts, so the app is offline until
              the new release answers. A preview starts its own service on its own port, and production is not
              touched.
            </>
          ),
        },
        {
          title: "Egg waits for an answer",
          body: (
            <>
              Egg asks your app on its port, from your container, for up to 45 seconds. If it never answers, the
              deployment is Error, so Egg switches back to an earlier production release, when one exists, and
              checks it for 20 seconds. A first production deployment has nothing to go back to: the service stays
              registered and systemd keeps restarting it every 3 seconds. Fix the app and deploy again.
            </>
          ),
        },
      ])}
      <P>
        A push to your production branch goes live. A push to any other branch builds a preview on its own port,
        so production keeps running. When a deployment ends, the worker deletes its folder on the Egg machine,
        whether it worked or not. That folder held the clone and the source archive.
      </P>
      <Callout tone="note" title="What it does not do">
        Egg does not run databases or give a preview a public address on its own, and does not promise that any
        application works on Nest. It runs the runtimes listed under Projects and runtimes, and any start command
        that listens on the <C>PORT</C> it is given. A Dockerfile alone does nothing, so Egg stays in native process
        mode until a check of your server confirms Docker works there.
      </Callout>
      {limits("overview",
        [
          ["Deployments per project at once", "One", "The others wait as Queued."],
          ["Deployments running at once, all projects", "2 by default", "The rest wait. A self-hosted worker can change this."],
          ["Clone", "5 minutes", "The deployment fails with “The build timed out.”"],
          ["Build time", "15 minutes, for install and build together. It cannot be changed.", "The deployment fails with “The build took longer than 15 minutes and was stopped.”"],
          ["Build cap", "The server’s Build memory (MB), 512 MB by default, at least 1024 MB for a project with a build step when your container has room for it, and never more than your container’s memory minus 512 MB. Build CPU limit (cores), 2 by default. No swap.", "A build that needs more memory is stopped with “The build needed more memory than the cap of N MB.” A build that needs more CPU only runs slower. If the cap would be under 256 MB, the build does not start."],
          ["Build output", "500 MiB (524.288 MB), measured on the archive", "The deployment fails with the size it found."],
          ["Wait for the app to answer", "45 seconds", "The deployment is marked Error and the previous release is put back, if there is one."],
        ],
      )}
      {wrong("overview", [
        [
          "A push did not start a deployment",
          <>
            Open the project’s Settings, Build and Run, and check that <B>Deploy automatically on push</B> is
            ticked. A project made from a pasted public repository URL is never built by a push, because it
            does not store the repository name GitHub sends. Press Deploy, or use a deploy hook. GitHub must also be
            able to reach Egg’s web address.
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
          "“The build needed more memory than the cap of N MB. Your app is still running.”",
          <>
            A build went over its cap and was stopped. Your app was not. The second sentence is added only when a
            release was already serving. Raise <B>Build memory (MB)</B> on the Container page and deploy again,
            or make the build lighter. The cap never goes above your container’s memory minus 512 MB.
          </>,
        ],
        [
          "A deployment stays Building or Deploying and does not move",
          <>
            The worker stopped or lost its link to the database. Egg does not free the deployment by itself,
            because a command it started on your container may still be running. Nothing else deploys for this
            project until the person running Egg follows “Recovering a stale deployment” in the self-host guide.
            After that the deployment shows Error and you can deploy again.
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
      intro="From nothing to a running app on your Nest container, in four steps. Every button name here matches the one on screen."
    >
      <P>
        Egg signs in to your Nest container with a key made only for it and clones your GitHub repository on the
        Egg machine, the computer that runs Egg, so your container gets a copy of the source. Your container builds
        it there under a memory and CPU cap and runs it as a service. This page is the shortest path through that,
        and each part has its own page with the full detail.
      </P>
      <P>You need four things before you start:</P>
      <List>
        <li>
          <B>A Hack Club account.</B> You sign in with Hack Club, so Hack Club only confirms who you are.
        </li>
        <li>
          <B>A Nest container and your Nest username.</B> This is the name you log in with, as in{" "}
          <C>ssh username@hackclub.app</C>.
        </li>
        <li>
          <B>A GitHub repository.</B> You import a public one by its address, so a private one, and automatic
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
              you land on Projects, where a new account sees “Connect your Nest container first” with a{" "}
              <B>Connect a server</B> button. The sign-in lasts 30 days, so the handshake with Hack Club has to
              finish within 10 minutes in one browser.
            </>
          ),
        },
        {
          title: "Connect your server",
          body: (
            <>
              Open Connect, titled “Connect a Nest server”. Under <B>Add your server</B>, type your Nest username
              in <B>Nest username</B> and press <B>Create key</B>, so the status reads “Waiting for the key”. Copy
              the <B>Public key</B>, press <B>Open the Nest dashboard</B> and paste the key on the SSH Keys page
              there. Come back and press <B>Test connection</B>. The first time, check the fingerprint in the
              “Confirm host key” box and press <B>Confirm host key</B>, so the status turns to “Connected” and a
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
              press <B>Continue</B>, so the page says “Looking at the repository…” while Egg reads it. Then press{" "}
              <B>Use these settings</B> under “We found” to fill in the runtime and commands it detected. That
              button only appears when a runtime was recognised.
            </>
          ),
        },
        {
          title: "Check the form and deploy",
          body: (
            <>
              Check <B>Nest server</B>, <B>Project name</B>, <B>Application preset</B>, <B>Production branch</B>,{" "}
              <B>Root directory</B> and <B>Port your app listens on</B>. The port starts at <C>3000</C>. Fill in
              any <B>Environment variables</B> the example env file asked for, so an empty field is skipped.
              Watch the “What is already on this container” panel: a line with the badge “Blocks the deploy”
              keeps the button off until you fix it. Press <B>Deploy</B>, so the button reads “Starting
              deployment…” and you land on the deployment page.
            </>
          ),
        },
        {
          title: "Watch the first deployment",
          body: (
            <>
              The <B>Build Logs</B> card streams the clone on the Egg machine, then the checks, upload, install,
              build and start on your container. When the state reads Ready, your app is running on your container,
              and the log ends with “Live on port N. Map your domain to this port in the Nest dashboard.” If you
              imported through the GitHub app, pushes to the production branch now deploy on their own, so a pasted
              public address does not. If the state reads Error, read the log from the bottom and see What can go
              wrong below. Your earlier release keeps running or is put back.
            </>
          ),
        },
      ])}
      <Callout tone="warning" title="Your app has to listen on the right port">
        Egg starts your app with <C>PORT</C> set to the port you chose and <C>HOST</C> set to <C>0.0.0.0</C>, so
        listen on both. An app that binds only to <C>localhost</C> cannot be reached and fails the health check
        after 45 seconds. A bot that opens no port still needs a tiny web server, so the check has something to
        answer.
      </Callout>
      {why(
        <>
          Egg judges a release by asking your app a question on its port: it requests the health check path, which
          is <C>/</C> unless you change it, and a status from 200 to 499 counts as up. A program that never opens
          a port cannot answer, so the check fails and the previous release is put back. Egg waits for an answer
          before it calls a deployment Ready, so Ready means “answering”, not just “started”.
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
        ["Clone", "5 minutes", "The deployment fails with “The build timed out.”", "server/deploy/build.ts"],
        [
          "Build time",
          "15 minutes by default",
          "The deployment fails with “The build timed out.”",
          "server/config.ts, BUILD_TIMEOUT_SECONDS",
        ],
        ["Wait for the app to answer", "45 seconds", "The deployment ends as Error and the previous release is put back, if there is one.", "server/deploy/pipeline.ts"],
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
      intro="A server is one Nest account. You can connect up to five, and each holds its own projects and usage."
    >
      <P>
        Connecting a server gives Egg one way into your Nest container, and nothing else. You make a key and paste
        its public half into the Nest dashboard, so Egg can deploy, restart and read logs. Egg connects from the
        Egg machine over SSH. You need a Nest account and your Nest username, the name you log in with, for
        example <C>sam-r</C>.
      </P>
      <H3 id="servers-connection" />
      <P>
        Egg makes a dedicated ed25519 key for each server and uses it for nothing else. The key’s comment reads{" "}
        <C>egg:</C> followed by your username. You paste the public half into the Nest dashboard, so Nest’s
        bastion routes the connection to your container as <C>root</C>, just like your own login. The page warns
        you: “This key gives Egg the same access as your own login, because SSH into Nest lands in a root shell
        inside your container. Only connect a container you are happy to deploy to.”
      </P>
      <P>
        Egg seals the private key with AES-256-GCM, tied to that server, before storing it in Egg’s database on
        the Egg machine, and never shows it. The first time you press Test connection, Egg reaches the host, reads
        its host key, hangs up and shows the SHA-256 fingerprint under “Confirm host key”. Nothing reaches the
        server until you press <B>Confirm host key</B>, so Egg records the fingerprint and stops any other host key
        before it sends anything. Until then, no deploy, file change or terminal connects. The address is{" "}
        <C>hackclub.app</C> on port 22, and a self-hosted copy can change both with <C>NEST_HOST</C> and{" "}
        <C>NEST_PORT</C>.
      </P>
      {why(
        <>
          A key made for one server lets you end Egg’s access without touching your own login, so deleting the key
          in the Nest dashboard stops access at once. Egg pins the host key because it sends your environment
          variables and your build to whatever answers, so a different answer stops the connection instead of
          handing your data over.
        </>
      )}
      {steps("servers", [
        {
          title: "Create the key",
          body: (
            <>
              Open Connect. Under <B>Add your server</B> (the heading reads “Add another server” once you have
              one), type your Nest username in <B>Nest username</B> and press <B>Create key</B>, so the status
              reads “Waiting for the key” and the card shows the <B>Public key</B>.
            </>
          ),
        },
        {
          title: "Paste it into Nest",
          body: (
            <>
              Copy the <B>Public key</B> field with its copy button. Press <B>Open the Nest dashboard</B> to open{" "}
              <C>dashboard.hackclub.app</C> in a new tab, then paste the key on the SSH Keys page.
            </>
          ),
        },
        {
          title: "Test the connection",
          body: (
            <>
              Back on Connect, press <B>Test connection</B>, so the button reads “Connecting…”. The first time, the
              page stops at a “Confirm host key” box that says “This is the first connection to NAME.hackclub.app”
              and shows a fingerprint. Check it against the one Nest shows for your server, then press{" "}
              <B>Confirm host key</B> (“Confirming…”), so Egg reads your container. On success the status reads
              “Connected” and a “Reached your container” panel lists System, Logged in as, Node.js, Python,
              systemd and Key fingerprint. That last row is the fingerprint of the key Egg made, not of Nest’s host
              key. A missing tool shows as “not installed”.
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
          your container’s operating system, user, Node.js and Python versions, tools, systemd, CPU, memory and
          disk. It only reads, so it changes nothing on your container and you can press it at any time. A failure
          saves the message and the status becomes “Could not connect”; the next success clears it.
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
        These are warnings about your container, so Egg only shows them and does not stop a deploy because of one.
        Fix the ones that match what you want to run. After a test, the Projects page also shows a usage card with
        CPU load, memory and disk from that reading, or “No reading yet. Press Test connection on the Connect
        page.” when there is none. It shows the first connected server.
      </P>
      <Callout tone="note" title="Taking access back">
        Delete the key in your Nest dashboard, so access ends at once. Your apps keep running because they are
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

  keys: () => (
    <Section
      id="keys"
      intro="Keys are the SSH keys Egg makes for your projects and for you. Each one is a pair: the public half can be shared, and Egg keeps the private half sealed in its database."
    >
      <P>
        The Keys page lists the keys you make for a project and for yourself. The key Egg makes for each server is
        listed there too, with a copy button for its public half and a <B>New key</B> action. That server key is
        described on the Servers page.
      </P>
      <H3 id="keys-kinds" />
      <List>
        <li>
          <B>GitHub deploy key.</B> A read-only key that Egg installs on the GitHub repository linked to one project,
          through the Egg GitHub App. You paste nothing. Once GitHub confirms it, the row shows an “On GitHub”
          badge.
        </li>
        <li>
          <B>Git key.</B> A key for a git host you run yourself. Egg makes the pair, you paste the public half into
          your host, and the private half is shown once.
        </li>
        <li>
          <B>Personal key.</B> A key that belongs to your account rather than a project, for a script or a tool you
          use outside Egg. Its private half is shown once, too.
        </li>
      </List>
      <H3 id="keys-deploy" />
      <P>
        A deploy key can read the repository and nothing else: it is read-only, so it cannot push. Egg adds it when
        the project is linked to a repository. Until it is, Egg refuses to add one and says a repository is needed.
      </P>
      {why(
        <>
          A read-only key cannot change your code, even if it leaks. Revoking a deploy key removes it from GitHub
          before Egg marks it revoked, so the key cannot keep opening the repository after you have revoked it.
        </>
      )}
      <H3 id="keys-git" />
      <P>
        Use a git key for a git host that is not on GitHub, such as a server you run yourself. Add it to a project
        from the Keys page, and name it if you want. Copy its public half into your host’s SSH key settings. The
        private half is shown once, in the same dialog, so copy it before you press <B>I have copied it</B>. Egg
        keeps it sealed, and the page never shows it again.
      </P>
      <H3 id="keys-personal" />
      <P>
        Press <B>Generate key</B> in the Personal keys card and give the key a name. Egg shows the private and the
        public half once. Copy both, then press <B>I have copied it</B>. A personal key is not tied to a project, and
        revoking it in Egg does not change anything outside Egg.
      </P>
      <H3 id="keys-manage" />
      <List>
        <li>
          <B>Add key</B> is on each project’s group. It opens “Add a key to NAME”. Pick <B>GitHub deploy key</B> or{" "}
          <B>Git key</B>, name a git key if you want, and press <B>Add key</B>. A deploy key then reads “Added to
          GitHub automatically.”
        </li>
        <li>
          <B>Replace key</B> is on a GitHub deploy key. The dialog says Egg makes a new read-only key, installs it on
          GitHub and removes the old one there. If GitHub would not remove the old key, the page says so, and you
          must delete the old deploy key in the repository’s settings on GitHub yourself.
        </li>
        <li>
          <B>Revoke</B> asks first. A deploy key is removed from GitHub before it is revoked here, and if GitHub
          cannot be reached nothing changes and the key stays active. A git key or a personal key is only marked as
          revoked, so remove its public half from your host or from anything else that trusts it.
        </li>
        <li>
          Revoked keys move under <B>Revoked</B> with the date they were revoked, and they cannot be used again.
        </li>
      </List>
      <H2 id="keys-reference" title="Limits and problems" />
      {limits("keys", [
        ["Key name", "1 to 60 characters, on one line", "“Give the key a name.” or “Keep the name to one line.”", "server/ssh-keys.ts"],
      ])}
      {wrong("keys", [
        [
          "The private key is gone.",
          <>It was shown once. Revoke that key and add a new one; Egg cannot show the private half again.</>,
        ],
        [
          "Revoking a deploy key is refused, or the key stays active.",
          <>
            Egg could not remove the deploy key from GitHub, so it kept the key. Check that the Egg GitHub App is still
            installed on the repository, then try again.
          </>,
        ],
        [
          "Replacing a deploy key says the old key is still on GitHub.",
          <>
            The new key is in place, but GitHub did not let Egg remove the old one. Delete the old deploy key in the
            repository’s settings on GitHub.
          </>,
        ],
        [
          "Adding a deploy key says a repository is needed.",
          <>The project is not linked to a GitHub repository yet. Link one to the project, then add the key.</>,
        ],
      ])}
      {related([
        ["servers", "Servers"],
        ["security", "Security"],
        ["api", "Access tokens and the API"],
      ])}
    </Section>
  ),

  projects: () => (
    <Section id="projects" intro="A project ties one GitHub repository to one app on one server.">
      <P>
        A project holds everything Egg needs to build and run one app: its repository and branch, Nest server,
        runtime, commands, port, and the variables, hook and alerts that go with it. You need a connected server.
        A private repository, and automatic deploys on push, need the Egg GitHub app installed on it.
      </P>
      <H3 id="projects-settings" />
      {steps("projects", [
        {
          title: "Pick a repository",
          body: (
            <>
              Press <B>New project</B>. Pick the account under <B>GitHub account</B>, find your repository with{" "}
              <B>Search repositories…</B> and press <B>Import</B>. Or paste a public address under “Or use a public
              repository URL” and press <B>Continue</B>, so it has to look like{" "}
              <C>https://github.com/owner/name</C>. A pasted address starts on your Default branch from Settings,
              which is <C>main</C> until you change it. With no server connected, the page shows “Connect a server
              first”.
            </>
          ),
        },
        {
          title: "Read what Egg found",
          body: (
            <>
              The “We found” summary lists the package manager, runtime, install, build and start commands and
              output folder Egg read from your repository, with notes under them. Nothing is applied until you
              press <B>Use these settings</B>, so it fills <B>Application preset</B> and the four command and folder
              fields but leaves the name, branch, root directory and port alone. If the repository holds several
              apps, “Apps in this repository” shows a button for each folder, and pressing one sets the root
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
              <B>Port your app listens on</B>. Leave <B>Install command (optional)</B>,{" "}
              <B>Start command (optional)</B>, <B>Build command (optional)</B> and, for static sites,{" "}
              <B>Output directory</B> empty to use the defaults. The project name is also your container’s folder
              and service name (<C>egg-NAME.service</C>), so the form only accepts lowercase letters, digits and
              hyphens and says “Use lowercase letters, numbers and hyphens.” otherwise.
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
              Open the project, Settings, <B>Build and Run</B>, change a field and press <B>Save</B>, so the page
              says “Saved. Changes apply to the next deployment.” You cannot change the server or the repository,
              so to move an app you make a new project.
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
      <P>The “We found” step reads your repository from GitHub before Egg creates anything. Here is what it looks
        at.</P>
      <List>
        <li>
          <B>Language.</B> A <C>package.json</C> means Node.js, so otherwise <C>requirements.txt</C> or{" "}
          <C>pyproject.toml</C> means Python. Egg names a <C>go.mod</C>, <C>Gemfile</C> or <C>Cargo.toml</C> as not
          supported yet, with a hint to try the Custom command preset. It names a <C>Dockerfile</C> so you can find
          it, but your project still starts in native process mode, so a Dockerfile counts only when you choose
          Dockerfile mode and your server passed its Docker check.
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
          <B>Start with automatic deploys off</B> is for a repository you already run on this container by hand.
          The project is created with automatic deploys off, and the form says “The first deploy is manual, and
          automatic deploys start only after you confirm that first deploy works.” Nothing turns them on for you:
          tick <B>Deploy automatically on push</B> in Settings when the first manual deploy works. This option does
          not import, take over or stop the copy that is already running, and Egg does not import a running service
          yet. The container check still runs, and if your old process holds the port you stop it yourself first.
        </li>
        <li>
          <B>The container check.</B> Once the name, server and port are valid, the form waits 600 milliseconds and
          then asks your container, read only, whether the project would collide with something there. The result
          is the “What is already on this container” panel. A line with the badge “Blocks the deploy” turns the
          Deploy button off. “Made by Egg” and “Good to know” lines are information only. The same check
          runs again at the start of every deploy, before anything is written.
        </li>
        <li>
          <B>Show on Egg Homepage</B> is off for every project. It is separate from the public status page. Turning it
          on lists the project’s latest deployments on the public Egg homepage: the first line of the commit message,
          the short commit, the branch, the state, Production or Preview, the time and the repository name, each linking to
          the commit on GitHub. Build logs, your server, ports and environment variables are never shown. Only the owner
          can turn it on, and only for a repository imported through the GitHub App that GitHub says is public: Egg asks
          GitHub when you press <B>Show on homepage</B> and again each time the list is built, at most once a minute. A
          private or unconfirmed repository is refused with a message, and one that turns private leaves the homepage
          within a minute. Press <B>Stop showing</B> to take the project off.
        </li>
        <li>
          <B>Delete Project</B> asks you to type the project name. With “Also stop the service and delete releases
          on NAME.hackclub.app” ticked, which is the default, the app goes offline. The service, the production and
          preview releases and the <C>current</C> link are removed from the container, but only if Egg created
          them. The <C>shared/</C> folder, <C>~/.egg/NAME/shared</C>, is kept, so data your app stored there is still
          on the container. Unticked, only the records go and the app keeps running. A project with a deployment that
          is Queued, Building or Deploying cannot be deleted. With the box ticked, Egg checks this first and answers
          409 before it touches anything on the container, so a refused delete changes nothing. While the removal
          runs, new deployments for the project are refused too, whether they come from a push, a hook, the API or
          the Deploy button. If the removal fails, the block is lifted and the records are kept so you can try again.
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
            "Stop it yourself first. Egg does not take over a copy that is already running.",
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
            "Picks pnpm, then yarn, then npm from your lockfile (npm install if there is none) and runs your build script if you have one. The install step uses a frozen lockfile. The build runs the install, the build and then a production-only install on your container, in the new release folder, under the cap, which uses its CPU, memory and disk on every deploy. node_modules is not uploaded.",
            <C key="n">npm start</C>,
          ],
          [
            "Python",
            "No build step. On every deploy your container creates a virtual environment in .venv and installs requirements.txt into it, if the file exists, which uses its CPU, memory and disk. This runs under the cap, after your install and build commands, if you set them.",
            <C key="p">python3 app.py</C>,
          ],
          [
            "Static site",
            "Builds if there is a build script, then ships only the Output directory. It is served by a short built-in server run with Python 3, or with Node.js if Python is missing. That server answers only GET and HEAD, shows no folder listings, and refuses any path that has a part starting with a dot (such as .env or .git) and any link that points outside the folder.",
            <C key="s">Egg’s static server on PORT</C>,
          ],
          ["Custom command", "No detection and no install on the container. You give the install, build and start commands.", "Your command"],
        ]}
      />
      <P>
        The build uses the Node.js and Python on your container. Your Node.js must match the <C>engines</C> range
        in <C>package.json</C>, or be 22.13 or newer when there is no range. For Node.js the install command is{" "}
        <C>npm ci</C>, <C>corepack enable && pnpm install --frozen-lockfile</C> or{" "}
        <C>corepack enable && yarn install --frozen-lockfile</C>, and the build command is <C>npm run build</C>,{" "}
        <C>pnpm build</C> or <C>yarn build</C>. The service runs your start command through a login shell, so tools
        installed with nvm are on the path. Egg names Go, Ruby and Rust as not supported by detection, so use Custom
        command if you can run a prebuilt binary. Bun is detected but not built yet.
      </P>
      {why(
        <>
          The build runs next to your app, and the Egg machine only clones and packs the source, so the GitHub
          token never leaves it. The cap exists because a Nest container is small, so the kernel stops a build that
          goes over it before it can stop the app, and that is why build memory is a setting. A failed build never
          touches the running release, and container checks look before they touch anything, because the container
          is yours and may hold things Egg did not make.
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
      <H3 id="projects-docker" />
      <P>
        Native is the default, so your project deploys as a container only once your server passes the Docker
        check. The check runs when settings open and when you test the connection, and it asks the Docker on your
        container, not Egg&apos;s own, about cgroup limits, free disk at its storage root and the port proxy. When a
        part fails, the Dockerfile and Compose options stay greyed out with the reason, and nothing changes on your
        server.
      </P>
      <List>
        <li>
          <B>Dockerfile mode.</B> Egg uploads your source, then builds the image on your container with{" "}
          <C>docker build</C>, under the same memory, CPU and disk caps as a native build, so every release gets its
          own image tag. A systemd service starts and watches one named container, so restarts, journal logs, the
          Restarts count and rollbacks work as they do for a native process.
        </li>
        <li>
          <B>Compose mode.</B> The Compose file is read by Docker itself, and only the resolved form Egg checked
          is ever run. Services must use prebuilt images, host ports must bind to{" "}
          <C>127.0.0.1</C> only, and the one service Egg monitors must not publish ports of its own; Egg maps
          the project&apos;s listen port onto it. Every other service, such as a database, starts with{" "}
          <C>docker compose up -d</C> and keeps its named volumes across releases. Rollbacks restore the
          previous release&apos;s code and configuration, never the data the stack wrote.
        </li>
        <li>
          <B>What stays the same.</B> Environment variables reach the container at run time through the same
          encrypted path, nothing is baked into the image. A bot in a container mode can still open one
          optional listen port. Scheduled jobs run inside the running container with{" "}
          <C>docker exec</C>. Previews exist for Dockerfile projects; a Compose stack has no branch preview
          yet. A preview on a Compose project is refused when it is queued, with a message saying to deploy
          the branch to production instead, so no build time is wasted.
        </li>
        <li>
          <B>What is refused.</B> Compose files that build images, set a container name, add depends_on,
          links, devices or privileged options, mount bind paths or outside volumes, join external networks,
          or publish ports on other interfaces, are rejected before anything starts, with the first reasons
          named in the logs. Only a short allowlist of service fields is accepted. A Compose project also
          cannot use the GitHub Actions build: the image is built on your server.
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
          <>Cancel the deployment on the Deployments tab, then delete the project. Nothing on the container was touched.</>,
        ],
        [
          "“A deployment is still stopping for this project. Wait for it to finish, then delete the project.”",
          <>A worker still holds a job for this project. Wait a minute and try again.</>,
        ],
        [
          "409 “Cleanup is in progress for this project. Wait for it to finish or retry it before making changes.”",
          <>The project is being removed from the container, and new deployments are blocked until that ends. Wait for it, then check whether the project still exists.</>,
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
        A project made from a pasted public repository URL stores no repository name, so a push never builds it.
        Deploy, a deploy hook or the API builds it instead, so import through the GitHub app when you want pushes
        to deploy.
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
        Error or Canceled, and keeps its log, so you can see where it came from. Its source is <C>manual</C> (the
        Deploy button or API), <C>webhook</C> (a push or pull request), <C>hook</C> (a deploy hook),{" "}
        <C>redeploy</C> or <C>rollback</C>. You need a project and an access token, which you make on the Developer
        page so a script can call Egg’s API, and the token needs <C>deployments:write</C> to start, redeploy, cancel
        or roll back a deployment.
      </P>
      <H3 id="deployments-states" />
      <Table
        caption="Deployment states"
        head={["State", "Meaning"]}
        rows={[
          ["Queued", "Waiting. A project runs one deployment at a time, and the worker runs 2 deployments at once across all projects."],
          ["Building", "Cloning and packing on the Egg machine, then the checks, the upload, and the install and build on your container."],
          ["Deploying", "On your container: starting the service and waiting for it to answer. A rollback also shows as Deploying."],
          ["Ready", "Started and answering."],
          ["Error", "A step failed. The error text, at most 500 characters, is on the deployment page."],
          ["Canceled", "You canceled it, or its pull request closed."],
        ]}
      />
      <P>
        The lists draw Deploying as Building, so the Compare table shows all six words. In the status filter,
        Building also lists Queued, and Error also lists Canceled.
      </P>
      <P>
        If a production deployment fails after the switch, Egg puts the previous release back and checks it for 20
        seconds, so the log says “The previous release is serving traffic again.” or “The previous release did not
        come back either. Check the logs.” Egg stops and removes a preview that fails to start, so it does not stay
        behind as a service that keeps restarting.
      </P>
      <P>
        The deployment page has a Details card (Created, Duration, Environment, Address, Port and Source, with the
        branch and commit) and a Build Logs card. A log reads in this order: “Deploying NAME (production) to
        USER@HOST”, the clone, “Commit abc1234: message”, “Building: COMMAND” (or “No build step for this
        project.”), “Packed release: N MB”, “Connecting to your Nest container”, “Uploading N MB”, the steps on the
        container, “Waiting for the app to answer on port N” and a line that starts “Healthy:”. Production ends with
        “Live on port N. Map your domain to this port in the Nest dashboard.” The Build Logs card starts open while
        a deployment runs or has failed and collapses when it is Ready, so you can read it in place. It has a count
        of lines and a <B>Find in logs…</B> box, but you cannot download build logs.
      </P>
      <H3 id="deployments-actions" />
      {steps("deployments", [
        {
          title: "Deploy",
          body: (
            <>
              Open your project and press the button at the top. It reads <B>Deploy</B> until a production release
              is live and <B>Redeploy</B> after that, and either way it queues a new build of the production branch
              tip, not an older commit. The build runs on your container and restarts your app when it goes live,
              so a new deployment waits as Queued while another is running.
            </>
          ),
        },
        {
          title: "Redeploy one commit",
          body: (
            <>
              In the Deployments list, open <B>Actions for deployment</B> on a row and choose <B>Redeploy</B>, so Egg
              builds the same commit again in the same environment. If it cannot fetch, check out and verify that
              exact commit, the deployment fails, because Egg never substitutes the branch tip. The menu also has{" "}
              <B>View logs</B>.
            </>
          ),
        },
        {
          title: "Roll back",
          body: (
            <>
              Press <B>Instant rollback</B> on the project page, or choose it from a row’s menu, so <C>current</C>
              {" "}points at an earlier Ready production release still on your container and the service restarts. The
              app is offline while it restarts. Nothing is rebuilt, but Egg still waits up to 45 seconds for the app
              to answer, so an unhealthy older release puts the live release back and ends the rollback row as
              Error. The log ends with “Rollback complete. Database changes are not reversed.” The project page
              button targets the newest Ready production release that is not live, and its tooltip says “Switches
              back to the previous release. Database changes are not reversed.”
            </>
          ),
        },
        {
          title: "Cancel",
          body: (
            <>
              Choose <B>Cancel</B> on a row that is Queued, Building or Deploying, so a running build or upload
              stops within about two seconds, because the worker checks for a cancel every two seconds. Egg also
              checks before each step on your container. Cancel works until Egg starts to switch the release, so
              after that it is refused with “Activation has started or this deployment is already finished.” and
              the deployment finishes as Ready, or as Error if the new release does not answer.
            </>
          ),
        },
        {
          title: "Restart without building",
          body: (
            <>
              On the project page’s Service card, press <B>Restart</B> and confirm “Restart the service?”, so Egg
              restarts the production service without building anything. The app is offline for a few seconds.
            </>
          ),
        },
      ])}
      <Steps
        id="deployments-find-steps"
        level={levelOf("deployments")}
        items={[
          {
            title: "Search",
            children: (
              <>
                Search with <B>Search by commit, branch, author or #pr…</B>, so every word must match the project,
                branch, commit message, short commit, author, source, environment or pull request (type <C>#14</C> or{" "}
                <C>pr 14</C>).
              </>
            ),
          },
          {
            title: "Sort",
            children: (
              <>
                Sort with <B>Sort deployments</B> (Newest first, Oldest first, Longest build, Shortest build), so you
                change only the order shown.
              </>
            ),
          },
          {
            title: "Filter",
            children: (
              <>
                Filter with <B>Filter by status</B>, <B>Filter by environment</B>, <B>Filter by project</B> and{" "}
                <B>Filter by time</B> (Any time, Last 24 hours, Last 7 days, Last 30 days), so Egg answers from the
                server, and press <B>Clear filters</B> to reset them.
              </>
            ),
          },
          {
            title: "Act on rows",
            children: (
              <>
                Tick rows for <B>Compare</B> (exactly two), <B>Cancel</B> (unfinished previews) or{" "}
                <B>Delete previews</B> (previews not live and at least 24 hours old), so the action applies only to
                what you ticked. Deleting asks “Delete N previews?” and says Egg stops each preview and removes its
                files from your container, but never deletes production releases or the live release. The record
                stays in the list.
              </>
            ),
          },
        ]}
      />
      <P>
        The all-projects Deployments page loads the newest 100 deployments and shows 25 at a time with a{" "}
        <B>Show N more</B> button. A single project’s Deployments tab loads only the newest 25, so a long history
        does not have to load at once, and a <B>Load older</B> button (“Loading older…”) fetches the next 25.
        Search, status, environment and time run on the server, not on the rows already loaded, so a match is found
        however far back it is. Search waits until you stop typing, and sorting only reorders the rows loaded so
        far, as the page says under the list. If a page cannot load, the rows already shown stay and the button
        tries again.
      </P>
      <P>
        To keep a record outside the dashboard, open a project’s Deployments tab and press <B>Export CSV</B>. The
        file holds that project’s newest 5,000 deployments with the time (UTC), commit, branch, environment, state,
        duration in seconds and deployment id, but never variables, logs, ports or addresses. You can make 10
        exports a minute, so after that Egg answers “Too many exports. Wait N seconds and try again.”
      </P>
      <H3 id="deployments-releases" />
      <P>
        Each release lives in its own folder under <C>~/.egg/NAME/releases/</C> on your container, so up to six
        copies of the code and its installed dependencies use your disk. After every successful deploy, production
        keeps the five newest Ready releases plus the live one, and a rollback can leave six. Previews, across all
        branches, keep the two newest Ready ones, so Egg stops and deletes older ones. You cannot roll back to a
        release that was removed.
      </P>
      <P>
        A build that fails, runs out of memory, times out or is canceled removes its own release folder, so the
        running release is not touched. A deployment that fails or is canceled after its build finished leaves its
        folder until the next successful deploy removes it, while a preview that fails to start is removed at once.
        If cleanup fails over SSH, the records are still marked cleaned up, so a leftover folder can stay on your
        container while the page says it is gone, and the Container page lists such leftovers.
      </P>
      <H3 id="deployments-previews" />
      <P>
        Any branch other than production builds as a preview, with its own service on the lowest free port from
        20000 to 29999 on that server, so production keeps running. Nest gives previews no address on its own, and
        the log says “Preview is running on port N. Map a domain to it in the Nest dashboard to open it.” You build
        a preview by pushing a branch, opening a pull request, calling a deploy hook with a branch or using the API.
        Previews use the variables set for All or Preview, and the project page lists them under Active branches,
        one row per branch.
      </P>
      <Callout tone="tip" title="A failed deploy leaves production alone">
        If the new release never answers on its port, Egg switches the previous release back on, so a failed deploy
        does not leave you on a broken version. If your app crashes at start, the check stops at once with “Service
        crashed on start” instead of waiting the full 45 seconds.
      </Callout>
      {why(
        <>
          A release is a folder and going live is moving one link, so rolling back moves it the other way and takes
          seconds. For the same reason, a rollback cannot restore a cleaned-up release or reverse changes your app
          made to its own database, because only the code folder changes. A project runs one deployment at a time,
          so two builds cannot race to switch the same link.
        </>
      )}
      <H2 id="deployments-reference" title="Limits, errors and an example" />
      {limits("deployments", [
        ["Releases kept in production", "5 Ready, plus the live one", "Older ones are deleted and cannot be rolled back to.", "server/deploy/layout.ts, KEEP_RELEASES"],
        ["Previews kept", "2 newest Ready", "Older previews are stopped and removed.", "server/deploy/layout.ts, KEEP_PREVIEWS"],
        ["Preview ports", "20000 to 29999 per server", "“No free preview ports on this server.”", "server/projects.ts"],
        ["Deployments at once, all projects", "2 by default", "The rest wait as Queued. A self-hosted worker can change it with WORKER_CONCURRENCY.", "instrumentation.ts"],
        ["Deployments at once, one project", "1", "The others wait as Queued.", "server/jobs.ts"],
        ["Clone", "5 minutes", "“The build timed out.”", "server/deploy/build.ts"],
        ["Fetching one commit for a redeploy", "3 minutes", "The deployment fails if the requested SHA cannot be fetched, checked out, and verified. The branch tip is never substituted.", "server/deploy/build.ts"],
        ["Build time", "15 minutes, for install and build together. Fixed.", "“The build took longer than 15 minutes and was stopped.”", "server/deploy/container-build.ts, BUILD_TIMEOUT_SECONDS"],
        ["Build cap", "Build memory (MB) of the server, 512 MB by default, at least 1024 MB for a project with a build step when the container has room, and never more than the container’s memory minus 512 MB; Build CPU limit (cores), 2 by default; no swap. The build does not start if the cap would be under 256 MB.", "“The build needed more memory than the cap of N MB.” A build that waits for another build on the same container waits up to 30 minutes.", "server/deploy/container-build.ts, containerMemoryCapMb, lib/build-memory.ts"],
        ["Free disk before a build", "2048 MB", "“Free up disk space on your container: N MB is free and a build needs at least 2048 MB.” Nothing is uploaded.", "server/deploy/container-probe.ts, MIN_FREE_DISK_MB"],
        ["Build memory and CPU setting", "Build memory (MB), set per server on the Container page: 512 MB up to the memory the server reports, or 8192 MB when it reports none. Build CPU limit (cores): 0.5 up to the cores the server reports, in 0.25 steps, 2 by default.", "A value outside the range is refused.", "lib/build-memory.ts, DEFAULT_BUILD_CPUS"],
        ["Source archive", "500 MiB compressed, 2 GiB unpacked, and 200,000 included paths", "Packaging stops when any limit is exceeded. The compressed archive is removed.", "server/deploy/build.ts, MAX_ARCHIVE_BYTES, MAX_SOURCE_UNPACKED_BYTES, MAX_SOURCE_ENTRIES"],
        ["One step on your container", "2 minutes; 15 minutes for unpacking and installing", "“Command timed out after 120s” (or 900s).", "server/deploy/pipeline.ts"],
        ["Wait for the app to answer", "45 seconds, then 20 seconds for the old release", "The release is marked Error and the previous one is restored.", "server/deploy/pipeline.ts"],
        ["Worker lease on a running job", "Renewed every 15 seconds. Counted as expired after 60 seconds without renewal", "The job keeps blocking its project until the person running Egg recovers it by hand. Egg does not fail it by itself.", "server/jobs.ts, LEASE_RENEW_MS and STALE_AFTER_MS"],
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
          "“The build needed more memory than the cap of N MB. Your app is still running.”",
          <>
            A build went over its cap and was stopped (exit 137). Your app was not. The second sentence is
            added only when a release was already serving. Raise <B>Build memory (MB)</B> on the Container page and
            deploy again, or make the build lighter. The cap never goes above your container’s memory minus 512 MB.
          </>,
        ],
        [
          "“The build took longer than 15 minutes and was stopped. Your app is still running.”",
          <>A build ran past 15 minutes. Cut work from the build. This limit is fixed. “Your app is still running.” is added only when a release was already serving.</>,
        ],
        [
          "“The build timed out.”",
          <>The clone ran past 5 minutes. The limit is fixed. Check that the repository is not very large, then deploy again.</>,
        ],
        [
          "A one-line fix that starts with “Install”, “Free up”, “Egg could not check your container”, “Builds on your container run under” or “Your container cannot apply”",
          <>
            Egg looked at your container before it uploaded anything and found something missing. Nothing was
            changed and your running app was not touched. Do what the line says, then deploy again. Every line is
            listed on the <InternalLink href={docsHref("troubleshooting")}>troubleshooting</InternalLink> page.
          </>,
        ],
        [
          "“Another build has been running on this container for more than 30 minutes, so this one did not start. Your app is still running.”",
          <>Only one container build runs at a time on a container. Wait for the other build, or cancel it, then deploy again.</>,
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
          "A deployment stays Building or Deploying and does not move",
          <>
            The worker stopped, or it can no longer renew its lease on the job. Egg leaves the job blocking its
            project until the person running Egg recovers it by hand, because a command on your container may
            still be running. After that the deployment shows Error with “The worker stopped during this job.” and
            you can deploy again.
          </>,
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
          "“Activation has started or this deployment is already finished.”",
          <>It is too late to cancel: the release is being switched or the deployment ended. Check its state.</>,
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
        Environment variables give your app its secrets and settings, such as a Discord token or database address,
        without putting them in the repository. Each has a name, a value and a target that says which deployments get
        it. You need a project, so open its Settings and find the Environment Variables card. You can also fill in
        names found in your repository while you create the project.
      </P>
      {steps("env", [
        {
          title: "Add a variable",
          body: (
            <>
              Type a <B>Name</B> and a <B>Value</B>, choose where it applies in <B>Applies to</B> (All, Production
              or Preview) and press <B>Save</B>, so the list below shows each name with its target in alphabetical
              order. The button stays off until there is a name.
            </>
          ),
        },
        {
          title: "Import names from the repository",
          body: (
            <>
              Press <B>Import names from the repository</B>, so the button says “Reading the repository…” while Egg
              reads <C>.env.example</C>, <C>.env.sample</C>, <C>.env.template</C> and <C>.env.local.example</C> on the
              production branch. Every name not yet present is added for All with an empty value, and the page says
              “Added N names with empty values. Use the pencil on each to set its value.” Egg never touches names you
              already have.
            </>
          ),
        },
        {
          title: "Change a value",
          body: (
            <>
              Press the pencil (“Change the value of NAME”), type a “New value” and press <B>Update</B>. Saving the
              same name and target again also replaces the value. You cannot read the old one back. Saving a value
              never changes the variable’s secret flag.
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
              A change reaches your container on the next deployment, because Egg writes the values into the new
              release. To apply it now, press <B>Redeploy</B> on the project page, which builds again on the Egg
              machine and restarts your app. A restart alone does not pick up a change.
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
      <P>
        When you set the same name for <C>All</C> and for one environment, the matching Production or Preview value
        wins, so <C>All</C> only supplies a value when no environment-specific value matches.
      </P>
      <List>
        <li>
          The list shows names and targets only, and the browser never shows a value. Each variable has a secret flag,
          on by default, and the flag is changed through the API. A token with <C>env:read</C> gets a value back from{" "}
          <C>get_env_vars</C> only when the variable is marked non-secret. Egg stores them encrypted with AES-256-GCM,
          tied to the project, the name and the target.
        </li>
        <li>
          At deploy time Egg passes your values to the build on your container as ordinary environment variables,
          so any install or build script, including those of your dependencies, can read them. For the build they are
          written to a file with permissions 600 that Egg deletes when the build ends. They are also written to a{" "}
          file in the project’s <C>env/</C> folder on your container, named after the release, with permissions 600 and never
          inside the release folder, because a static site serves that folder. They are written as{" "}
          <C>NAME=&quot;value&quot;</C> lines for systemd. Line breaks in a value become <C>\n</C>. An empty value
          is left out of the file, so the app sees the variable as unset rather than empty.
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
      <Callout tone="note" title="Variables files are not shown in the dashboard or the API">
        The Files page and the API refuse to open anything in <C>env/</C> or <C>current.env</C>, and the{" "}
        <C>.env</C> files that releases made before the move still sit in <C>current/</C> and <C>releases/ID/</C>. The
        Files page says “This file holds the project’s environment variable values, so it is not shown here. Change
        the values in the project’s settings.” and the API answers 403. A terminal on your container can read the
        file, so the Terminal switch is off by default.
      </Callout>
      {why(
        <>
          Secret values are write-only, so no page, token or log has to be trusted with them. The cost is that you
          cannot check a secret value after saving it; you replace it. A value marked non-secret can be read back
          through <C>get_env_vars</C>. Egg writes variables into each release instead of reading
          them live, so a rollback runs with the variables that release shipped with and a half-edited set never
          reaches a running app.
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
        Egg stores one build log per deployment on the Egg machine, showing the clone, install, build and release.
        It does not store runtime logs, so each time you open or refresh the page Egg reads them from your container
        over SSH to show what your running app prints. Build logs need a deployment, and runtime logs need a project
        that has been deployed, covering only the production service.
      </P>
      {steps("logs", [
        {
          title: "Read a build log",
          body: (
            <>
              Open a deployment, so the <B>Build Logs</B> card shows each line. While it runs, new lines stream in
              and the card says “Waiting for the first log line…” until the first arrives. Use <B>Find in logs…</B>
              {" "}to search. A Ready deployment’s log starts collapsed, so open the card to read it.
            </>
          ),
        },
        {
          title: "Open the runtime logs",
          body: (
            <>
              Open Logs in the sidebar and choose a project, then pick a <B>Time range</B> (1 hour, 24 hours or 7
              days; the default is 7 days) and a <B>Level</B> (All lines, or Warnings and errors). The line under the controls
              says how many lines are shown, for example “120 lines from recipe-bot, last 7 days.”
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
              The page opens with the newest 300 lines, so when the journal holds more inside the time range, a{" "}
              <B>Load older lines</B> button (“Loading older lines…”) sits above them. Each press adds the 300 lines
              before the ones you see, using the same time range, level and search, and keeps your place in the list,
              while a screen reader is told how many lines were added. The button goes away when nothing earlier is
              in range, but stays when a stretch has no match, so you can keep looking. If a read fails, the lines
              above stay and the button tries again. Changing the range, level or search starts again from the
              newest lines.
            </>
          ),
        },
        {
          title: "Follow it live",
          body: (
            <>
              Tick <B>Refresh every 5s</B> to follow the log, so a “Live” marker appears and the page reads quietly
              in the background and adds only new lines at the bottom when older lines are on screen. Each refresh
              reads your container over SSH, so untick it when you stop watching, or press <B>Refresh</B> when you
              want to.
            </>
          ),
        },
        {
          title: "Keep a copy",
          body: (
            <>
              Press <B>Download</B> to save exactly the lines on screen, older lines included, as a text file such
              as <C>recipe-bot-logs-24h-2026-11-05.txt</C>, named for the project, the range (<C>1h</C>,{" "}
              <C>24h</C> or <C>7d</C>) and the UTC date. The button is off when there are no lines.
            </>
          ),
        },
      ])}
      <List>
        <li>
          Runtime logs are your production service’s journal on your container (<C>journalctl -u egg-NAME.service</C>),
          and the page shows up to 300 lines at a time, so Load older lines repeats the read for earlier lines. A
          search or the Warnings and errors level reads up to 1000 lines first, filters them and keeps the newest 300
          that match. A preview’s output is not on this page.
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
          Egg does not copy runtime output, so it stays in your container’s journal and reading it needs a live
          connection, with history set by systemd, not Egg. Build output is different: Egg collects it while the
          build runs and stores it with the deployment, so it is still there when your container is off.
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
        A domain gives your app a name people can type, so three places have to agree: your DNS provider sends the
        name to Nest, the Nest dashboard maps it to your app’s port, and Egg records both so it can check them. Egg
        does only the last part, by looking, so it changes nothing in DNS, in Nest or on your container, and its
        checks run from the Egg machine. You need a connected server and either a domain whose DNS you can edit or
        your own Nest name, and the form adds the domain to the server you connected first.
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
          record with the value <C>domain-verification=your-nest-username</C>, so the domain waits as “Waiting for
          DNS” until Egg finds the record. This is the same proof Nest asks for when you add the domain on its
          dashboard.
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
              <B>Add domain</B>, so a panel headed “Next: finish setup for DOMAIN” lists what to do next.
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
              In the Domains page of your Nest dashboard, add the same domain with the same port, so Egg can check
              it. Nest looks for the same record when you add it, so do step 2 first, because Egg cannot do this for
              you.
            </>
          ),
        },
        {
          title: "Check",
          body: (
            <>
              Press <B>Check</B>, so the button reads “Checking…” and the status moves from “Waiting for DNS” to
              “Active” when the record is found, or stays on “Waiting for DNS” with a reason when it is not. DNS
              changes can take a few minutes, so check again after a short wait.
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
          <B>App check.</B> Only once DNS passes, so Egg sends a GET over HTTPS to <C>/</C> and, if your project has
          a different health path, to that path too. It waits 5 seconds for each, checks the certificate, follows no
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
        Egg rechecks active custom domains whenever you open the Domains page, at most once a minute for each, so if
        the record has gone the row shows “DNS no longer points here. Check your record.” A failed lookup shows
        nothing, so fix the record and press <B>Check</B>.
      </P>
      {why(
        <>
          Egg checks DNS and the app instead of changing anything, so the mapping stays in the Nest dashboard, which
          has no API, and a record in Egg is only a note of your intent. The rules follow Nest’s own, so your Nest
          name is free, a custom domain proves itself with the same TXT or CNAME record, and Nest’s reserved names
          are blocked here too. Egg shows a domain as active only after that proof, so a name that is not yours never
          looks live. The two checks are separate, so DNS proves the name reaches Nest and the app check proves your
          app answers behind it, letting you tell which side to fix.
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
        The app lets Egg read a repository and hear about pushes without holding your GitHub password, and you
        choose which repositories it can see. You need a GitHub account and a connected server, so Egg can use the
        app for private repositories, pushes to deploy and pull request comments. Egg clones with a short-lived
        token that stays on the Egg machine and is never sent to your container. You can import a public repository
        without the app by pasting its address, but then pushes do not deploy.
      </P>
      <H3 id="github-push" />
      {steps("github", [
        {
          title: "Install the app",
          body: (
            <>
              On the New project page, the “Connect GitHub” card has <B>Install the GitHub App</B>, which opens GitHub
              so you can choose the account and repositories to share. If the list is empty, come back and press{" "}
              <B>I already installed it</B>, which signs you in to GitHub once to find your installations, so the
              sign-in is used once and not stored. Use <B>Add another account or repository</B> to share more later,
              and when you return the page says “GitHub is connected. Pick a repository below.”
            </>
          ),
        },
        {
          title: "Import the repository",
          body: (
            <>
              Pick your repository under <B>GitHub account</B>, find it with <B>Search repositories…</B> and press{" "}
              <B>Import</B>, so the list shows the newest pushes first. Leave <B>Deploy automatically on push</B> on,
              as it is by default.
            </>
          ),
        },
        {
          title: "Push",
          body: (
            <>
              A push to the production branch deploys to production, and a push to any other branch builds a
              preview, so the deployment shows the source “webhook”, the first line of the commit message (cut at
              300 characters) and the author.
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
          GitHub delivers each push to <C>/api/webhooks/github</C> on Egg’s web address, so GitHub must be able to
          reach it. An Egg on localhost cannot receive pushes. There, press Deploy or use a deploy hook.
        </li>
        <li>
          Only projects with <B>Deploy automatically on push</B> on, whose repository name matches and whose
          GitHub installation is one the project’s owner linked, are built.
        </li>
        <li>The same commit on the same branch is not built twice while one for it is already queued, building or deploying.</li>
        <li>
          Every distinct push delivery remains queued, even if it arrives after a different commit. Webhook delivery
          order does not prove commit order, so Egg does not cancel a queued push based on arrival time.
        </li>
        <li>
          GitHub signs every delivery and Egg checks the signature, so a repeat of a signed body is answered
          “duplicate delivery” and not run again, using a one-way digest Egg keeps in its database. Pressing
          Redeliver in GitHub for a push that already worked therefore does nothing, so push a new commit or press
          Deploy.
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
          preview, so the app posts one comment when it finishes and edits that same comment when a later build of
          the pull request finishes. It only ever edits a comment it wrote itself.
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
        A push to the branch of a draft pull request in the same repository still builds a preview, because it comes
        from the push event, so only the pull request event skips drafts. No comment is written until you mark the
        pull request ready for review.
      </Callout>
      <Callout tone="note" title="Permissions for the comment">
        Commenting needs Pull requests read and write access and the Pull request event, so without them previews
        still build and the comment is skipped quietly. Egg logs a 403 from GitHub on the server, and nothing shows
        on the deployment.
      </Callout>
      {why(
        <>
          The app model means Egg never holds your password or a personal token, so it gets a short-lived token for
          one installation, cached only until a minute before it expires, and sees only what you shared. Previews run
          on a separate port from production, so a branch under test never replaces the live app.
        </>
      )}
      <H2 id="github-actions" title="Building on GitHub Actions" />
      <P>
        The setup steps, limits and troubleshooting are on{" "}
        <InternalLink href={docsHref("build-github-actions")}>Build with GitHub Actions</InternalLink>, so this is
        the short version.
      </P>
      <P>
        A project can build on GitHub and send Egg the finished release instead of building on your container, and
        your project settings make the workflow file while the GitHub build card shows the steps. The workflow reads
        four credentials, and Egg shows each value once when you make the build credentials.
      </P>
      <List>
        <li>
          <B>Production.</B> <C>EGG_UPLOAD_PRODUCTION_TOKEN</C> and <C>EGG_ENV_PRODUCTION_TOKEN</C> are secrets of a
          GitHub Environment named <C>egg-production</C> (Settings, Environments), so limit that environment to the
          production branch. You can also turn on Required reviewers, so a person approves each production build.
        </li>
        <li>
          <B>Previews.</B> <C>EGG_UPLOAD_PREVIEW_TOKEN</C> and <C>EGG_ENV_PREVIEW_TOKEN</C> are repository secrets.
        </li>
        <li>
          <B>Never save the two production values as repository secrets.</B> A repository secret can be read by a workflow
          that someone edits on any branch.
        </li>
      </List>
      <Callout tone="warning" title="Treat workflow editors as trusted operators">
        Test connection cannot see your GitHub secrets or environment settings, so check by hand that the production
        values are in the <C>egg-production</C> environment and not in the repository, where anyone who can edit
        workflows could run code with the preview credentials. A project has a single owner, and Egg does not isolate
        the Nest account from that.
      </Callout>
      <H2 id="github-reference" title="Limits, errors and an example" />
      {limits("github", [
        ["Repositories listed", "5 pages of 100, newest push first", "Repositories beyond that are not listed. Paste the address instead.", "server/github/app.ts"],
        ["Installation owner", "The first Egg user to link it", "“That GitHub installation is not linked to your account.”", "server/github/app.ts"],
        ["App sign-in token", "9 minutes", "Renewed automatically.", "server/github/app.ts"],
        ["Comments read when updating", "100 per pull request", "A comment beyond that is not found, and a new one is posted.", "server/github/pulls.ts"],
        ["Repeated deliveries", "A digest of each signed body is kept in the database, with no expiry", "A repeat of the same body is answered “duplicate delivery”. A push with a new commit has a new body.", "server/github/webhook.ts"],
        ["Webhook payload", "5 MB", "“payload too large”", "app/api/webhooks/github/route.ts"],
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
        Use a deploy hook when the GitHub app cannot help: from CI, a scheduled job, a script on your laptop or a
        project made from a pasted public address. The URL is the only credential, so the caller needs no access token
        or cookie, and the call only queues a build. That build runs on the Egg machine, so your app restarts on your
        container when it goes live. You need a project and a way to send an HTTP POST.
      </P>
      {steps("hooks", [
        {
          title: "Create the hook",
          body: (
            <>
              Open your project, Settings, <B>Deploy Hook</B>, and press <B>Create hook</B>, so the card changes
              from “No hook yet. Create one to get a URL you can call from CI.”
            </>
          ),
        },
        {
          title: "Copy the URL now",
          body: (
            <>
              The card shows the URL in a copy field and says “Copy it now. For safety it is not shown again.
              Anyone with this URL can deploy this project, so treat it like a password.” Egg stores only a hash, and
              the card also shows a ready-made <C>curl -X POST</C> line.
            </>
          ),
        },
        {
          title: "Call it",
          body: (
            <>
              Send a POST, so an optional JSON body picks a branch, and any branch other than production builds a
              preview, while no body builds the production branch.
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
              <B>Make a new URL</B> replaces the old one, which stops working at once, and <B>Revoke</B> removes the
              hook, so after either a call to the old URL answers 404. When a hook exists but its URL is hidden, the
              card says “A hook is active and its URL is hidden. Make a new one to see a URL again; the old one stops
              working at once.”
            </>
          ),
        },
      ])}
      <List>
        <li>
          A good call answers 202 with <C>{`{ "deployment": { "id", "state", "branch", "env" } }`}</C>, so the state
          is “queued” and the deployment’s source is “hook”, its author “deploy hook” and its message “Triggered by
          deploy hook”. Activity records “Deployed through the deploy hook for” the project.
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
          loop cannot fill the queue, and the body holds only a branch, so a leaked URL can only build code already
          in your repository, never run a command or change a setting.
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

  jobs: () => (
    <Section
      id="jobs"
      intro="A command that runs on a schedule inside your current release, such as a nightly clean-up or a weekly report."
    >
      <P>
        A scheduled job is a command and a time pattern, so Egg turns each job into a systemd timer on your
        container. systemd is the Linux service manager, and a timer starts something at set times. Your command runs
        in the folder of your current release, the deployed version of your app that is live now, and gets the same
        environment variables as your app, with the project’s virtual environment first on the path for Python. You
        need a project that has been deployed once, because a job has nothing to run in before that.
      </P>
      {steps("jobs", [
        {
          title: "Open the card",
          body: (
            <>
              Open your project, Settings, <B>Scheduled Jobs</B>, so the card says “No jobs yet.” when you have no
              jobs.
            </>
          ),
        },
        {
          title: "Fill in the form",
          body: (
            <>
              Under <B>Add a job</B>, type a <B>Name</B>, a <B>Schedule</B> and a <B>Command</B>, or use the{" "}
              <B>Common schedules</B> list to fill in the schedule for you. A line under it says what the schedule
              means and when it next runs in UTC, or why it is not valid.
            </>
          ),
        },
        {
          title: "Press Add job",
          body: (
            <>
              The card says “Added. It is armed on your container now.” because Egg saves the timer on your container
              before it keeps its record, so a job you can see on the card is installed.
            </>
          ),
        },
        {
          title: "Check how it went",
          body: (
            <>
              Each row shows the schedule in words, the next run and the last result: “Has not run yet”, “Running
              now”, “Succeeded” or “Failed (exit N)”, with how long ago. Egg reads your container when the card opens
              and every 30 seconds while the page is visible, so the row stays current.
            </>
          ),
        },
      ])}
      <List>
        <li>
          Your name is 1 to 60 characters: letters, numbers, spaces, dots, dashes and underscores, starting with a
          letter or number. The command is one line of up to 500 characters, so for anything longer, put a script in
          your repository and run it from the command.
        </li>
        <li>
          Egg runs the command with <C>bash -lc</C> from the current release folder, so a relative path such as{" "}
          <C>node scripts/cleanup.js</C> works. A deploy replaces the current release, so the next run uses the new
          code.
        </li>
        <li>
          Job names and commands are shown on the card in plain text. Keep secrets in environment variables, not in
          the command.
        </li>
      </List>
      <H2 id="jobs-schedule" title="Schedule format" />
      <P>
        A schedule is five fields separated by spaces: minute, hour, day of month, month and day of week, the form
        cron uses. Cron is the classic Unix scheduler, and all times are UTC, so a job does not depend on your
        container’s time zone.
      </P>
      <Table
        caption="The five fields"
        head={["Field", "Values"]}
        rows={[
          ["Minute", "0 to 59"],
          ["Hour", "0 to 23"],
          ["Day of month", "1 to 31"],
          ["Month", "1 to 12"],
          ["Day of week", "0 to 7. Both 0 and 7 are Sunday, and 1 is Monday."],
        ]}
      />
      <P>
        Each field takes <C>*</C> for every value, a number, a list such as <C>1,15</C>, a range such as <C>9-17</C>
        {" "}or a step such as <C>*/15</C> or <C>0-30/10</C>. Four nicknames are also accepted in any letter case:{" "}
        <C>@hourly</C>, <C>@daily</C> (and <C>@midnight</C>), <C>@weekly</C> and <C>@monthly</C>, so Egg saves{" "}
        <C>@daily</C> as its five fields, <C>0 0 * * *</C>.
      </P>
      <Table
        caption="Example schedules"
        head={["Schedule", "When it runs"]}
        rows={[
          [<C key="1">*/15 * * * *</C>, "Every 15 minutes"],
          [<C key="2">0 * * * *</C>, "Every hour, on the hour. Same as @hourly."],
          [<C key="3">0 */6 * * *</C>, "Every 6 hours, at minute 0"],
          [<C key="4">30 3 * * *</C>, "Every day at 03:30 UTC"],
          [<C key="5">0 9 * * 1-5</C>, "Monday to Friday at 09:00 UTC"],
          [<C key="6">0 9 * * 1</C>, "Every Monday at 09:00 UTC"],
          [<C key="7">0 4 1 * *</C>, "On the 1st of each month at 04:00 UTC"],
        ]}
      />
      <Table
        caption="What is not accepted"
        head={["Schedule", "Why"]}
        rows={[
          [<C key="1">0 9 * * MON</C>, "Names such as MON or JAN are not accepted. Use numbers."],
          [<C key="2">0 0 L * *</C>, "Cron extras such as ?, L and W are not accepted."],
          [<C key="3">0 0 * * * *</C>, "Six fields, with seconds, are not accepted. There must be exactly five."],
          [<C key="4">@yearly</C>, "Only @hourly, @daily, @midnight, @weekly and @monthly are accepted."],
          [<C key="5">0 9 1 * 1</C>, "Both a day of the month and a day of the week are set. Set only one and leave the other as *."],
          [<C key="6">*/2 * * * *</C>, "It would run every 2 minutes. A job runs at most once every 5 minutes."],
        ]}
      />
      <H2 id="jobs-behaviour" title="How a job behaves" />
      <List>
        <li>
          <B>It gives way to your app.</B> A job runs at a lower priority than your app, so if your container runs
          out of memory, Egg stops the job before the app.
        </li>
        <li>
          <B>Missed runs are not made up.</B> If your container was off or restarting at the scheduled time, the job
          waits for its next time, so it does not run a backlog.
        </li>
        <li>
          <B>It does not overlap itself.</B> If a run is still going when the next time arrives, Egg skips that time,
          so a second copy never starts.
        </li>
        <li>
          <B>It is stopped after 30 minutes.</B> Egg ends a run that is still going, so the last result reads Failed.
        </li>
        <li>
          <B>A run can start a few seconds late.</B> The timer is accurate to within 10 seconds.
        </li>
        <li>
          <B>It goes when the project goes.</B> Deleting a project with “Also stop the service and delete releases”
          ticked also removes its timers from the container. Egg only removes timers that it made.
        </li>
        <li>
          <B>A job needs a release.</B> Egg refuses to add or change a job before the project has been deployed once.
          Deploy the project, then add the job.
        </li>
      </List>
      <H2 id="jobs-actions" title="Actions on a job" />
      <Table
        caption="What each control does"
        head={["Control", "What it does"]}
        rows={[
          [<B key="1">Run now</B>, "Starts the job once, straight away, without waiting for it to finish. The card says “Started NAME. Open its output to see what it printed.” It works on a paused job too."],
          [<B key="2">Pause</B>, "Stops the timer, so the job no longer runs on its own. The row reads “Paused”. The button changes to Resume."],
          [<B key="3">Resume</B>, "Arms the timer again."],
          [<B key="4">Edit</B>, "The pencil. Opens the name, schedule and command in the row. Save puts the change on your container, and Cancel or the Escape key closes it without saving."],
          [<B key="5">Output</B>, "The terminal icon. Shows what the job printed on its last runs, up to the latest 120 lines, or “It has not printed anything yet.”"],
          [<B key="6">Remove</B>, "The bin. Asks “Remove NAME?” and, on Remove, stops the job and deletes it from your container."],
        ]}
      />
      <H2 id="jobs-routes" title="Dashboard routes" />
      <P>
        The card uses these routes, which answer only to your signed-in browser, so they are not part of the public{" "}
        <C>/api/v1</C> API and an access token cannot call them. <C>:id</C> is the project id and <C>:jobId</C> the job
        id.
      </P>
      <Table
        caption="Scheduled job routes"
        head={["Route", "What it does"]}
        rows={[
          [<C key="1">GET /api/projects/:id/jobs</C>, "Lists the jobs. With ?status=1 it also reads each job’s last result from your container."],
          [<C key="2">POST /api/projects/:id/jobs</C>, "Adds a job. The body holds name, schedule and command, and may hold enabled. Answers 201."],
          [<C key="3">PATCH /api/projects/:id/jobs/:jobId</C>, "Changes any of name, schedule, command and enabled."],
          [<C key="4">DELETE /api/projects/:id/jobs/:jobId</C>, "Removes the job from your container and from Egg."],
          [<C key="5">POST /api/projects/:id/jobs/:jobId/run</C>, "Starts the job once. Answers 202."],
          [<C key="6">GET /api/projects/:id/jobs/:jobId/logs</C>, "Returns the job’s recent output as a list of lines."],
        ]}
      />
      {why(
        <>
          Cron reads a schedule with both a day of the month and a day of the week as “either”, while systemd reads it
          as “both”, so Egg refuses the mix instead of guessing which one you meant. The 5 minute floor, the low
          priority and the 30 minute stop exist because your container is small and shared with your app, so a job
          does not starve it. Egg skips missed runs, so a restart does not trigger a burst of old work.
        </>
      )}
      {limits("jobs", [
        ["Jobs per project", "5", "409 “A project can have 5 jobs. Remove one to add another.”", "server/scheduled-jobs.ts, MAX_JOBS_PER_PROJECT"],
        ["Time between runs", "At least 5 minutes", "The schedule is refused with “Jobs run at most once every 5 minutes so they do not starve your app.”", "lib/cron-schedule.ts, MIN_GAP_MINUTES"],
        ["Run time", "30 minutes", "systemd stops the run and the last result reads Failed.", "server/deploy/jobs-remote.ts, JOB_TIMEOUT_SECONDS"],
        ["Name", "1 to 60 characters", "The form says which characters are allowed.", "server/deploy/jobs-remote.ts, JOB_NAME"],
        ["Command", "500 characters, one line", "“Keep the command under 500 characters. Put longer scripts in a file in your repository.”", "server/scheduled-jobs.ts, jobInput"],
        ["Schedule", "100 characters", "“That schedule is too long.”", "lib/cron-schedule.ts"],
      ])}
      {wrong("jobs", [
        [
          "409 “Deploy the project once first. A job runs inside the current release, and there is none yet.”",
          <>Deploy the project, then add the job.</>,
        ],
        [
          "“Set either the day of the month or the day of the week, not both.”",
          <>Leave one of the two fields as <C>*</C>.</>,
        ],
        [
          "“That would run every N minutes.”",
          <>Choose a schedule with at least 5 minutes between runs.</>,
        ],
        [
          "409 “A project can have 5 jobs. Remove one to add another.”",
          <>Remove a job you no longer need.</>,
        ],
        [
          "409 “A service with that name already exists on your container and was not made by Egg, so it was left alone.”",
          <>Egg never replaces a unit it did not write. Remove or rename the unit on your container yourself.</>,
        ],
        [
          "“Not on your container. Pause and resume it to put it back.”",
          <>The timer is gone from the container, for example after someone removed it. Pause the job and press Resume to install it again. If Run now answers “That job is not on your container any more”, save the job again.</>,
        ],
        [
          "504 “Your container did not answer in time.” or 502 “Could not reach your container.”",
          <>The container may be stopped or starting. Try again in a minute. The list still shows what Egg saved.</>,
        ],
        [
          "The job shows Failed (exit N)",
          <>Open the output to read what it printed. Run the same command in the Terminal from the current release folder to see the error.</>,
        ],
      ])}
      {example("jobs", {
        title: "Clean up old uploads every night",
        given: (
          <>
            Sam’s <C>recipe-bot</C> is deployed and has a script <C>scripts/cleanup.js</C> that deletes old uploads.
          </>
        ),
        steps: [
          { title: "Fill in the form", body: <>Sam types the name <C>Nightly clean-up</C>, picks “Every day at 03:00” from Common schedules and types <C>node scripts/cleanup.js</C>.</> },
          { title: "Add the job", body: <>Sam presses Add job and sees “Added. It is armed on your container now.”</> },
          { title: "Try it", body: <>Sam presses Run now, waits a moment, then opens the output.</> },
        ],
        result: (
          <>
            The row reads “Every day at 03:00 UTC” with the next run time, and the output shows what the script
            printed. After a deploy, the next night’s run uses the new code.
          </>
        ),
      })}
      {related([
        ["hooks", "Deploy hooks"],
        ["projects", "Projects and runtimes"],
        ["limits", "Limits"],
      ])}
    </Section>
  ),

  notifications: () => (
    <Section
      id="notifications"
      intro="Messages to a Discord or Slack channel from an incoming webhook, when a deployment finishes or an alert fires."
    >
      <P>
        A notification tells you a deployment finished, so nobody has to watch the dashboard. Each project has one
        webhook address, and every finished deployment, Ready or Error, can post a short message there, sent by Egg
        from the Egg machine to Discord or Slack. Nothing runs on your container. You need an incoming webhook URL
        from Discord or Slack, which also carries the alerts described under Monitoring and uptime.
      </P>
      {steps("notifications", [
        {
          title: "Make the webhook",
          body: (
            <>
              In Discord, make a webhook for a channel, or in Slack, make an incoming webhook, then copy its URL.
            </>
          ),
        },
        {
          title: "Save it",
          body: (
            <>
              Open your project, Settings, <B>Notifications</B>. Paste the <B>Webhook URL</B>, choose <B>Send</B>
              (Every deployment, or Failures only) and press <B>Save</B>, so the page says “Saved. Send a test message
              to check it.” The Save button stays off while the URL box is empty, so to change only <B>Send</B> later,
              paste the URL again.
            </>
          ),
        },
        {
          title: "Send a test",
          body: (
            <>
              Press <B>Send test message</B>, so Egg posts “Test from Egg for PROJECT” and the card says “Sent.
              Check the channel.” The button appears once you save a URL.
            </>
          ),
        },
        {
          title: "Remove it",
          body: (
            <>
              Press <B>Remove</B> to delete the saved URL, so messages stop at once.
            </>
          ),
        },
      ])}
      <List>
        <li>
          Egg accepts https only, with no port, query, fragment or credentials, so Discord hosts are{" "}
          <C>discord.com</C>, <C>discordapp.com</C> and both with a <C>ptb.</C> or <C>canary.</C> prefix, on a path{" "}
          <C>/api/webhooks/ID/TOKEN</C> where ID is digits. Slack is <C>hooks.slack.com</C> on a path{" "}
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
          Egg accepts only Discord and Slack addresses of the exact shape those services use, and refuses redirects,
          so a saved address cannot send Egg’s request somewhere else, and a failed post is dropped rather than
          retried, because a broken channel must never hold up or fail a deployment.
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
        Discord and Slack are for people, so to tell a program, use <B>Webhooks</B> in Account. Egg sends a signed JSON
        message to an https address when a deployment starts, succeeds or fails, covering every project on your
        account.
      </P>
      <Steps
        id="notifications-webhooks-steps"
        level={3}
        items={([
          {
            title: "Add the address",
            body: <>Open Account, find <B>Webhooks</B>, paste the address under <B>Add a webhook address</B> and press <B>Add webhook</B>, so the button reads “Adding…” while it works.</>,
          },
          {
            title: "Copy the secret",
            body: <>The card shows the signing secret once, starting with <C>whsec_</C>, under “Signing secret for HOST”, so copy it before you press <B>I have copied it</B>. Egg cannot show it again.</>,
          },
          {
            title: "Send a test",
            body: <>Press <B>Send test</B> on the new row. The toast says “Test message delivered”, and the row lists the delivery under <B>Recent deliveries</B>. A test is one attempt, with no retries, and carries <C>{`"test": true`}</C>.</>,
          },
          {
            title: "Check the signature in your code",
            body: (
              <>
                Every request has an <C>X-Egg-Signature</C> header of the form <C>t=TIME,v1=HEX</C>, so the value
                is an HMAC-SHA256 of <C>TIME.BODY</C> keyed with your secret. Refuse a request that does not match,
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
        its id, branch, short commit and state, and <C>time</C> as an ISO date, so it never carries variables, logs,
        commit messages, errors or links. The headers <C>X-Egg-Event</C> and <C>X-Egg-Delivery</C> name the event and
        this delivery. A canceled deployment sends nothing, and the started message goes out when the build begins.
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
        You need a deployed project and a running worker, so Egg can check your app. You also need a webhook under
        Notifications for messages when something goes wrong.
      </P>
      <H3 id="monitoring-service-card" />
      <P>
        Once something is live, the Service card appears on your project page, showing Status (Running, Starting,
        Crashed, Stopped, Not deployed or Unknown), Uptime, Memory, Restarts and Health check (“HTTP CODE in MS ms”,
        “No answer” or “Not checked”). It reads systemd on your container and sends one real request to the health
        path with a 3 second limit.
      </P>
      <List>
        <li>
          It looks again every 30 seconds while your tab is visible, so Egg reuses a reading that is under 30 seconds
          old and opening the page does not always open a new connection to your container. A line under the card says
          when the reading was taken: “Checked” with the time, “Readings are reused for 30 seconds; Check now asks the
          container again.”
        </li>
        <li><B>Check now</B> always asks your container, whatever the age of the last reading.</li>
        <li>
          <B>Restart</B> restarts the production service after you confirm “Restart the service?”. It builds
          nothing.
        </li>
      </List>
      <P>
        When Egg sees a production service fail, it keeps up to 200 lines of its journal against the current release,
        once per crash, with known secrets masked. A token with <C>logs:read</C> lists them with{" "}
        <C>list_crash_reports</C> and reads one with <C>get_crash_report</C>.
      </P>
      <H3 id="monitoring-resources" />
      <P>
        The Resource use card on your project page shows this one service’s memory and CPU over the last 24 hours, so
        it says “Collecting data.” until it has two readings. CPU is a share of one core, so it can pass 100. Egg
        leaves a point blank when there is no earlier reading, the gap is over 30 minutes or the counter went
        backwards after a restart. The Resources page in the sidebar shows load, memory and disk for the whole server
        over 24 hours or 7 days, with a table of each project’s memory, CPU and restarts.
      </P>
      <P>
        The worker samples every connected server every 5 minutes by default and keeps 7 days, so it writes project
        samples only while the service is running.
      </P>
      <P>
        Through the API, <C>get_deployment_metrics</C> (<C>deployments:read</C>) returns bucketed CPU and memory
        averages and restart counts for the deployment’s project. The samples are per project, not per release. <C>get_resource_quota</C>{" "}
        (<C>resources:read</C>) returns the limits and current usage of the project. A value Egg has not measured is
        <C>null</C>, never zero.
      </P>
      <H3 id="monitoring-uptime" />
      <P>
        Every 5 minutes the worker opens one SSH connection to each connected server, so for each project with a
        live production release and no deployment in progress it runs a short read-only command on your container.
        The command asks systemd about the service and makes one request to the app on 127.0.0.1, so a project is up
        when its service runs and the health path answers with a status from 1 to 499. Without <C>curl</C> on your
        container, running is enough, and a server it cannot reach is skipped rather than reported as down.
      </P>
      <P>
        Egg declares a project down after a number of failed checks in a row, 2 by default, so you get one message
        when it goes down and one when it answers again. The project header shows “Answering”, “Not answering since
        TIME” or “Not checked yet”, and links to the alert history. Each project sets its own alerts.
      </P>
      {steps("monitoring", [
        {
          title: "Open the Alerts card",
          body: <>Open your project, Settings, <B>Alerts</B>. For any message to be sent, you must save a webhook in the Notifications card.</>,
        },
        {
          title: "Set “When to warn”",
          body: (
            <>
              Set <B>Disk full (%)</B>, <B>Memory used (%)</B>, <B>CPU load per core (%)</B> and <B>Failed checks
              before down</B>, plus <B>Slow response limit (ms)</B> if you want one.
            </>
          ),
        },
        {
          title: "Choose the channels",
          body: (
            <>
              Under <B>Send to the webhook</B>, tick any of The app stops answering, The app answers again, Disk,
              memory or CPU warnings and Deployment results. All four are on by default.
            </>
          ),
        },
        {
          title: "Save",
          body: <>Press <B>Save</B> at the bottom of the card, so a message says “Alert settings saved”.</>,
        },
        {
          title: "Pause when you need quiet",
          body: (
            <>
              Under <B>Pause all alerts</B>, choose “For 1 hour”, “For 24 hours” or “Until I resume” and press{" "}
              <B>Pause</B>, so it takes effect at once without Save and the card shows “Alerts are paused”. Press{" "}
              <B>Resume alerts</B> to end it, because while paused nothing is sent but the history still records the
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
          A resource alert fires once when a value reaches its limit and once more when it falls back below it, so
          nothing is sent in between. Disk, memory and CPU are for the whole server, checked against each project’s
          own limits.
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
      <P>
        You need a deployed project and a running worker, so the uptime checks can supply the figures. Egg serves the
        page from its own stored data, so a visitor never reaches your container through it.
      </P>
      {steps("status-page", [
        {
          title: "Publish it",
          body: (
            <>
              Open your project, Settings, <B>Public Status Page</B> (the section list at the top of Settings calls
              it Status Page), and press <B>Publish status page</B>, so it stops saying “Not published.”
            </>
          ),
        },
        {
          title: "Share the link",
          body: (
            <>
              Copy the link from <B>Status page URL</B>, which is <C>/status/KEY</C> on your Egg address, so the page
              asks search engines not to index it. The key is 12 random URL-safe characters, and the page reflects the
              worker’s checks every few minutes.
            </>
          ),
        },
        {
          title: "Take it down",
          body: (
            <>
              Press <B>Unpublish</B>, so Egg deletes the key and the old link stops working. Publishing again makes
              a new key.
            </>
          ),
        },
      ])}
      <List>
        <li>
          Anyone with the link sees the project name, a state card, the share of the last 30 days your app was
          answering, a 30 day strip and the latest 10 outages under “Recent outages”, but nothing else: no repository,
          port, server or commit.
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
        You need a deployed project that serves web pages and access to the head of those pages, so a bot with no
        web page has nothing to count. Each visitor’s browser sends the count to Egg’s web address, not your
        container, so your container does no extra work and Egg must be reachable from your visitors. An Egg on
        localhost cannot count visitors on a public site.
      </P>
      <H3 id="analytics-setup-steps" />
      {steps("analytics", [
        {
          title: "Turn it on",
          body: (
            <>
              Open your project’s Analytics tab, find <B>Count visits</B> and press <B>Turn on analytics</B>.
            </>
          ),
        },
        {
          title: "Paste the snippet",
          body: <>The card is now titled <B>Tracking snippet</B>, so copy its snippet into the head of every page you
        want counted.</>,
          code: {
            label: "HTML",
            code: `<script defer data-key="nda_..." src="https://your-egg/api/analytics/script?key=nda_..."></script>`,
          },
        },
        {
          title: "Redeploy and visit",
          body: <>Redeploy so the page has the snippet, which builds again and restarts your app, then open the page
        in a normal browser window.</>,
        },
        {
          title: "Switch off when done",
          body: (
            <>
              Press <B>Turn off</B> to remove the key, so existing numbers stay until they age out after 90 days,
              unless you chose 30 or 60 under “Keep the numbers for”.
            </>
          ),
        },
      ])}
      <H3 id="analytics-data" />
      <P>
        You see “Page views” and “Visitors” for the last 30 days, “Page views per day” as a bar for each day and
        your top 10 pages under “Top pages”, so once Referrers is on you also see the top 10 sites under “Where
        visitors came from”. Turning on Campaigns adds “Campaigns”, and Record visitor countries adds a map under
        “Where visitors are”. Visitors are counted per day, so someone who comes on two days counts twice, and
        percentages, shares and the median appear only with at least 50 visits behind them. Below that you see
        counts and “Not enough data”.
      </P>
      <P>
        Once analytics is on, the “What else to record” card adds ten things and a choice of how long to keep the
        numbers. Each is a checkbox that is off until you tick it and saves at once, with “Saved.” beneath, so with
        all of them off the script records only page views. Route details default to <C>/</C>, so to include a route,
        set a safe template such as <C>data-egg-path=&quot;/users/:id&quot;</C> on the page’s <C>&lt;html&gt;</C>
        {" "}element. Never put a visitor’s name, token or other personal value in that attribute. Under Settings,
        “Analytics defaults” has eight of them, all off, and Campaigns and Record visitor countries are not among
        them, because you set them up for each project. The checkboxes decide what a project starts with the first
        time you turn analytics on for it, so projects that already have analytics are not changed.
      </P>
      <List>
        <li>
          <B>Clicks</B> (“Top clicks”). Only elements you explicitly mark with a <C>data-egg-track</C> name are
          counted, so Egg never reads visible text or accessible labels. Do not put personal or changing values in
          the tracking name, because Egg never records input values or form content and stores only the project, the
          UTC day and the label.
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
          <B>Referrers</B> (“Where visitors came from”). The script sends only the host of the referring site, never
          its full address or query string, so it does this once per page load and a link between pages of your own
          site is not a referrer. The host is stored with the page view and kept as sent, so <C>www.</C> stays, and
          turning Referrers off deletes the hosts already stored for your project.
        </li>
        <li>
          <B>Campaigns</B> (“Campaigns”) starts off, so you must save at least one allowed value before you can turn
          it on. Under Allowed campaign values you list the exact <C>utm_source</C>, <C>utm_medium</C> and{" "}
          <C>utm_campaign</C> values you use, so the script reads only those three parameters from the address, and
          only a value that is on its list, spelled exactly as listed with capital letters included, is sent and
          stored. Any other value is dropped, and no other parameter is read. Each list holds up to 20 values of up
          to 40 characters: letters, numbers, dot, dash and underscore. Type a value, press <B>Add</B>, then press{" "}
          <B>Save allowed values</B>. Turning Campaigns off deletes the campaign values already stored for your
          project but keeps your lists, so taking a value off a list stops it being recorded while page views already
          stored with it stay until they age out.
        </li>
        <li>
          <B>Speed metrics</B> (“Speed”). Your browser sends five measurements once per page view, when the visitor
          leaves or switches tab: Largest Contentful Paint, Cumulative Layout Shift, Interaction to Next Paint,
          First Contentful Paint and Time to First Byte. Times are in milliseconds (ms) and shown in ms or seconds
          (s), so layout shift is a score with no unit. The table shows the median and 75th percentile for each and
          labels the 75th percentile Good, Needs work or Poor with Google’s thresholds: LCP 2.5 s and 4 s, CLS 0.1
          and 0.25, INP 200 ms and 500 ms, FCP 1.8 s and 3 s, TTFB 800 ms and 1800 ms. Egg does not collect
          exception messages, because they can contain credentials or personal data.
        </li>
        <li>
          <B>Custom events</B> (“Events”). A click on an element with <C>data-egg-track</C> is recorded by name. Add{" "}
          <C>data-egg-value</C> for a value of up to 40 characters, letters, numbers, spaces and - _ . : only, such
          as a plan name. A value that breaks the rule is dropped and the event still counts. It stores the name,
          the value and the day, no visitor id. A funnel step can use the same name.
        </li>
        <li>
          <B>Live view</B> (“On the site now”). You see page views in the last 5 minutes and, with Retention on,
          distinct visitors in that window, so with Retention off it says “Unique visitors need retention on”.
          While a page is open and visible, the script sends a small signal every 60 seconds, which Egg deletes after
          an hour, and it sends the signal only when both are on.
        </li>
        <li>
          <B>Retention</B> (“Returning visitors”). Egg stores a random id in your visitor’s browser, not a cookie,
          in local storage under the name <C>_egg_id</C>, so a visitor can remove it by clearing site data. Egg keeps
          only an HMAC (a keyed hash) of it with the project, never the id, and the salt comes from the server secret
          and changes every 90 days, so someone who returns after a change counts as new. Turning retention off
          deletes the stored codes and the script removes the id from the browser. To turn it off, clear the
          Retention checkbox under What else to record on your project’s Analytics tab, and leave it cleared under
          Analytics defaults in Settings. The card shows visitors in the last 7 days, then of those who first came 7
          to 14 days ago how many returned on a later day within 7 days, and of those who first came 30 to 37 days
          ago how many returned within 30 days. A group under 20 visitors shows “Not enough data yet”.
        </li>
        <li>
          <B>Record visitor countries</B> (“Where visitors are”, a map with a table of the same numbers), looks up
          the visitor’s IP address in a country database that ships with Egg, in the same request that records the
          page view, so the address is not sent to any other service. Only the two-letter country code, such as{" "}
          <C>FR</C>, is stored with the page view. Egg does not store or log the IP address, and keeps no city,
          region or position. An address that is local or private, or not in the database, has no country, so
          nothing is stored for it. The map covers the last 30 days, and a country with fewer than 10 page views is
          shown as “fewer than 10”, with larger counts rounded to two significant figures. Turning it off deletes
          the countries already stored for your project. This product includes GeoLite2 data created by MaxMind,
          available from https://www.maxmind.com.
        </li>
      </List>
      <P>
        <B>Keep the numbers for</B> sets how long Egg keeps page views, events, speed measurements and error
        records before deleting them: 30, 60 or 90 days for your project. A project keeps 90 days until you change
        it. Egg always deletes live view signals after an hour.
      </P>
      <H3 id="analytics-privacy" />
      <List>
        <li>By default Egg omits route details and represents them as <C>/</C>, so to report routes your site must
        explicitly provide a safe template in <C>data-egg-path</C>. No cookies. Everything else is a switch that starts
        off.</li>
        <li>
          Egg stores no IP address or browser details, so a visitor is a shortened hash of the address, browser,
          project and date, salted with the server secret. It changes daily, so nobody can be followed across days.
        </li>
        <li>
          Egg counts nothing for browsers that send Do Not Track or Global Privacy Control, on localhost or for
          known bots, so the collector drops requests that carry either signal.
        </li>
        <li>
          The page path is a template your site provides, so the script does not send the browser’s raw address path
          and legacy snippets without the template marker are stored as <C>/</C>. It reduces the referrer to its host.
        </li>
        <li>
          The script stores nothing in your browser unless Retention is on, and then only one random id in local
          storage. No IP address is stored by any feature, and Egg does not log it, so the address only limits how
          fast one visitor can send and feeds the daily visitor hash, apart from one country lookup in the same
          request while Record visitor countries is on.
        </li>
        <li>
          Campaign values are recorded only while Campaigns is on, and only values on the project’s allowed list.
          Any other value is dropped before it is stored.
        </li>
        <li>
          Turning off Referrers, Campaigns, Retention or Record visitor countries deletes what that switch stored
          for the project. The other switches stop recording when turned off, and what they already stored stays
          until it ages out.
        </li>
        <li>
          On a copy of Egg you run yourself behind a reverse proxy, set <C>TRUST_PROXY=1</C>, so Egg reads the proxy
          headers. It is off by default, and without it every visitor counts as one address, so the daily visitor
          hash tells people apart only by browser and everyone shares the send limits. Turn it on only when every
          request comes through a proxy you run that sets those headers itself, because with it off Egg has no
          visitor address and Record visitor countries stores no country either.
        </li>
        <li>
          Egg removes analytics history after 30, 60 or 90 days, as you choose for each project under “Keep the
          numbers for”, and after 90 days where you have not chosen, so cleanup runs from the app every 15 minutes,
          independently of the build worker and uptime checks. Backups may keep older database contents under their
          own retention, and a setting change reaches visitors within about 5 minutes because the script is cached.
        </li>
      </List>
      {limits("analytics", [
        ["History kept", "30, 60 or 90 days for each project, 90 by default", "Older rows are deleted by the app cleanup task."],
        ["Percentages and median", "At least 50 visits", "“Not enough data”"],
        ["Funnel steps", "2 to 6", "“A funnel needs at least 2 steps” or “A funnel has at most 6 steps”"],
        ["Tracked name", "Letters, digits, spaces and - _ . : up to 40 characters", "“A tracked name uses letters, numbers, spaces and - _ . : and is at most 40 characters”"],
        ["Page step", "Starts with /", "“A page step starts with \"/\", like /pricing”"],
        ["Page views", "1 per second per project and address. With TRUST_PROXY off, all visitors share one address", "Extra views are dropped.", "server/analytics.ts"],
        ["Every other report (clicks, time, goals, events, speed, live signal)", "30 per 10 seconds per project and address. With TRUST_PROXY off, all visitors share one address", "Extra events are dropped.", "server/analytics-events.ts"],
        ["Path and referrer", "200 and 100 characters", "The rest is cut off."],
        ["Allowed campaign values", "Up to 20 each for source, medium and campaign, of up to 40 characters: letters, numbers, dot, dash or underscore", "“Use short static labels with letters, numbers, dot, dash or underscore.”"],
        ["Campaign values recorded", "Only values on the allowed list, spelled exactly", "Any other value is dropped."],
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
          "“Allow at least one safe campaign label before turning campaigns on.” or Campaigns cannot be ticked",
          <>Add a value to at least one of the three lists and press Save allowed values. Then turn Campaigns on.</>,
        ],
        [
          "A campaign you use does not appear under Campaigns",
          <>Only values on the allowed list are recorded, spelled exactly the same, capital letters included. Add the value and save, then visit again.</>,
        ],
        [
          "“Where visitors are” has no countries",
          <>Turn on Record visitor countries. Views from before it was on have no country. Local and private addresses have none, and on a copy you run yourself, TRUST_PROXY must be on to give Egg the visitor’s address.</>,
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
