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

const limits = (page: string, rows: [string, string, ReactNode][]) => {
  const items: LimitItem[] = rows.map(([name, value, atLimit]) => ({ name, value, atLimit }));
  return (
    <Limits id={`${page}-limits`} items={items} level={levelOf(page)}>
      These numbers are read from the code that enforces them.
    </Limits>
  );
};

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
      intro="Nest Deploy builds your GitHub repository and runs it on your Nest container as a service. It is an independent project, not an official Hack Club product."
    >
      <P>
        Nest gives each member a small Linux container that you reach over SSH. Nest Deploy connects with a key
        you control, uploads a finished build and runs it as a systemd service on a port. Nest’s own proxy then
        maps your domain to that port. Nest Deploy does the work you would otherwise do by hand in a terminal.
      </P>
      <P>
        You need a Hack Club account, a Nest container and a GitHub repository. Nothing else is installed on
        your container ahead of time.
      </P>
      <H3 id="overview-push" />
      {steps("overview", [
        {
          title: "GitHub tells Nest Deploy about the push",
          body: (
            <>
              GitHub sends the push to Nest Deploy with a signed request. Only projects that match the
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
              Nest Deploy side, with 2 GB of memory and 2 CPUs. Your container’s memory stays free for your app.
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
          title: "Nest Deploy waits for an answer",
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
        listens on the <C>PORT</C> it is given. A Dockerfile in your repository is ignored: Nest Deploy
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
            The Nest Deploy worker restarted mid-build. Redeploy. A running job is treated as dead after one
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
    <Section id="quickstart" intro="From nothing to a running app on your Nest container, in four steps.">
      <P>
        You need a Hack Club account, a Nest container, and a GitHub repository whose app can listen on a port.
        The steps use the real button labels.
      </P>
      {steps("quickstart", [
        {
          title: "Sign in",
          body: (
            <>
              Open the log in page and press <B>Continue with Hack Club</B>. Hack Club only confirms who you
              are. It has no route to your container. You land on Projects.
            </>
          ),
        },
        {
          title: "Connect your server",
          body: (
            <>
              Open Connect, type your Nest username in <B>Nest username</B> and press <B>Create key</B>. Copy
              the <B>Public key</B> and paste it on the SSH Keys page of the Nest dashboard. Come back and press{" "}
              <B>Test connection</B>. You should see “Reached your container”.
            </>
          ),
        },
        {
          title: "Import a repository",
          body: (
            <>
              Press <B>New project</B>. Press <B>Install the GitHub App</B>, choose your repository, then press{" "}
              <B>Import</B>. Under “We found”, press <B>Use these settings</B> to accept the runtime and
              commands Nest Deploy read from the repository. Check <B>Port your app listens on</B>, fill any
              environment variable fields, and press <B>Deploy</B>.
            </>
          ),
        },
        {
          title: "Watch the first deployment",
          body: (
            <>
              You land on the deployment page. The Build Logs card streams the build. When the state reads
              Ready, the app is running on your container. Later pushes to the production branch deploy on their
              own.
            </>
          ),
        },
      ])}
      <Callout tone="warning" title="Your app has to listen on the right port">
        Nest Deploy starts your app with <C>PORT</C> set to the port you chose and <C>HOST</C> set to{" "}
        <C>0.0.0.0</C>. Listen on both. An app that binds only to <C>localhost</C> cannot be reached, and the
        health check fails. A bot that opens no port still needs a tiny web server so the check has something to
        answer.
      </Callout>
      {limits("quickstart", [
        ["Servers per account", "5", "“You can connect up to 5 servers.”"],
        ["Port", "1024 to 65535, and not 20000 to 29999", "20000 to 29999 is kept for previews. The form allows a lower port; the server refuses it."],
        ["Project name", "Lowercase letters, digits and hyphens, up to 40 characters", "“The project name must use lowercase letters, digits and hyphens (up to 40).”"],
        ["Wait for the app to answer", "45 seconds", "The deployment ends as Error."],
      ])}
      {wrong("quickstart", [
        [
          "The Connect page shows “Could not connect”",
          <>
            Read the red message. Most often the public key was not pasted on the SSH Keys page, or the
            username is not exactly your Nest username. See Servers for each message.
          </>,
        ],
        [
          "“Connect a server first”",
          <>
            You have no connected server yet, so there is nowhere to deploy. Press <B>Connect a server</B>.
          </>,
        ],
        [
          "“Port N is already used by another project on this server.”",
          <>Each project on a server needs its own port. Pick another one.</>,
        ],
        [
          "“Nothing was changed on your container.” followed by details",
          <>
            Something on your container is in the way, such as a service with the same name or a program using
            the port. Nest Deploy does not stop it. Change the project name or port, or deal with it yourself.
          </>,
        ],
      ])}
      {example("quickstart", {
        title: "Put recipe-bot online",
        given: (
          <>
            Sam has <C>sam-r/recipe-bot</C>, a Node.js Discord bot. The bot only talks out to Discord, so Sam
            adds a small web server that answers on the port Nest Deploy gives it.
          </>
        ),
        steps: [
          { title: "Add a tiny web server", body: <>Sam adds this line to <C>index.js</C> and pushes it: <C>{`http.createServer((_, res) => res.end("ok")).listen(process.env.PORT, "0.0.0.0")`}</C>.</> },
          { title: "Follow the four steps above", body: <>Sam signs in, connects <C>sam-r</C>, imports the repository and keeps the port at <C>3000</C>.</> },
          { title: "Press Deploy", body: <>Sam presses <B>Deploy</B> and watches the Build Logs card.</> },
        ],
        result: (
          <>
            The deployment reaches Ready. The project’s Service card shows Running, and the Logs page shows
            the line the bot prints when it logs in to Discord.
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
        You need a Nest account and your Nest username, the name you log in with, for example <C>sam-r</C>.
      </P>
      <H3 id="servers-connection" />
      <P>
        Nest Deploy makes a dedicated ed25519 key for each server and uses it for nothing else. You paste the
        public half into the Nest dashboard. Nest’s bastion routes the connection to your container as{" "}
        <C>root</C>, so this key can do anything you can do there. The page says so before you add it: “Only
        connect a container you are happy to deploy to.”
      </P>
      <P>
        The private key is sealed with AES-256-GCM, tied to that server, before it is stored. It is never shown.
        The first successful test records the SHA-256 fingerprint of Nest’s host key. After that, any other
        host key stops the connection before anything is sent.
      </P>
      {steps("servers", [
        {
          title: "Create the key",
          body: (
            <>
              Open Connect. Under <B>Add your server</B>, type your Nest username and press <B>Create key</B>.
              The status reads “Waiting for the key”.
            </>
          ),
        },
        {
          title: "Paste it into Nest",
          body: (
            <>
              Copy the <B>Public key</B> field. Press <B>Open the Nest dashboard</B> and paste the key on the
              SSH Keys page.
            </>
          ),
        },
        {
          title: "Test the connection",
          body: (
            <>
              Back on Connect, press <B>Test connection</B>. On success the status reads “Connected” and a
              “Reached your container” panel lists System, Logged in as, Node.js, Python, systemd and Key
              fingerprint.
            </>
          ),
        },
      ])}
      <H3 id="servers-manage" />
      <List>
        <li>
          <B>Test connection</B> opens an SSH session, records the host key the first time it works, and reads
          what your container has: operating system, Node.js and Python versions, systemd, CPU, memory and
          disk. The connect step times out after 20 seconds and the whole read after 30.
        </li>
        <li>
          <B>New key</B> replaces the key pair. Confirm with <B>Generate key</B>. The server goes back to
          “Waiting for the key” until you paste the new public key and test again. The pinned host key is kept.
          This button was called Rotate key in older versions of these docs.
        </li>
        <li>
          <B>Disconnect</B> deletes the server and every project on it from Nest Deploy, with their
          deployments, logs, environment variables, hook and status page. Nothing is removed from the
          container, so the apps keep running, but Nest Deploy can no longer update them. The dialog does not
          list the projects, so check before you confirm.
        </li>
      </List>
      <Callout tone="warning" title="Disconnect deletes projects here">
        Disconnecting a server removes every project that uses it from Nest Deploy. To keep a project’s
        records, do not disconnect its server. To end access without losing anything, delete the key in your
        Nest dashboard instead.
      </Callout>
      <P>
        After a test, the page can list issues. These are warnings about your container, for example that
        systemd, <C>tar</C> or <C>curl</C> is missing, that SSH did not log in as root, that neither Node.js nor
        Python 3 is installed, or that less than 1024 MB of disk is free. Nest Deploy only shows them. Fix the
        ones that match what you want to run.
      </P>
      <Callout tone="note" title="Taking access back">
        Delete the key in your Nest dashboard. Access ends at once and your apps keep running, because they are
        ordinary services in your container.
      </Callout>
      {limits("servers", [
        ["Servers per account", "5", "“You can connect up to 5 servers.”"],
        ["Nest username", "Letters, digits, dot, underscore and hyphen; 1 to 32 characters; starts with a letter or digit", "“That does not look like a Nest username. Use the name you log in with, for example sam-r.”"],
        ["Servers per Nest username", "One per account", "“<name> is already connected.”"],
        ["Connect timeout", "20 seconds", "“Timed out connecting to Nest.”"],
        ["Connection read", "30 seconds", "The test fails and the Connect page shows the error."],
        ["Host key", "Pinned on the first successful test", "Any other key stops the connection. Only Disconnect, then adding the server again, clears the pin."],
      ])}
      {wrong("servers", [
        [
          "“Nest rejected the key. Check that you pasted the public key on the SSH Keys page of the Nest dashboard, and that the username is exactly your Nest username.”",
          <>Paste the key again, copying the whole Public key field, and check the username.</>,
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
          "“The host key of HOST changed (was OLD, now NEW). Nothing was sent. If you expected this, reconnect the server.”",
          <>
            Nest Deploy refuses on purpose. If you know the host key changed, press <B>Disconnect</B> and add
            the server again. Remember that this deletes the projects on it.
          </>,
        ],
        [
          "“SSH error: message”",
          <>Anything else the SSH library reported. The message is the clue; try the test again once.</>,
        ],
      ])}
      {example("servers", {
        title: "Connect sam-r",
        given: (
          <>
            Sam’s Nest username is <C>sam-r</C>. Sam has not connected a server yet.
          </>
        ),
        steps: [
          { title: "Create the key", body: <>Sam opens Connect, types <C>sam-r</C> and presses Create key.</> },
          { title: "Paste it in Nest", body: <>Sam pastes the public key on the Nest dashboard’s SSH Keys page.</> },
          { title: "Test", body: <>Sam presses Test connection.</> },
        ],
        result: (
          <>
            The panel “Reached your container” appears with the system, Node.js and systemd rows, and the status
            reads “Connected”. Sam can now press New project.
          </>
        ),
      })}
      {related([
        ["quickstart", "Quick start"],
        ["projects", "Projects and runtimes"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),

  projects: () => (
    <Section id="projects" intro="A project ties one GitHub repository to one app on one server.">
      <P>
        You need a connected server. A private repository, and automatic deploys on push, need the Nest Deploy
        GitHub app installed on it.
      </P>
      <H3 id="projects-settings" />
      {steps("projects", [
        {
          title: "Pick a repository",
          body: (
            <>
              Press <B>New project</B>. Choose a GitHub account and a repository and press <B>Import</B>, or
              paste a public address under “Or use a public repository URL” and press <B>Continue</B>.
            </>
          ),
        },
        {
          title: "Read what Nest Deploy found",
          body: (
            <>
              The “We found” summary names the runtime, package manager, commands, output folder and
              environment variable names it read from the repository. Nothing is applied until you press{" "}
              <B>Use these settings</B>.
            </>
          ),
        },
        {
          title: "Fill in the fields",
          body: (
            <>
              Choose <B>Nest server</B>, <B>Project name</B>, <B>Application preset</B> (Node.js, Python,
              Static site or Custom command), <B>Production branch</B>, <B>Root directory</B> and{" "}
              <B>Port your app listens on</B>. The install, start, build and output fields are optional.
            </>
          ),
        },
        {
          title: "Deploy",
          body: (
            <>
              Press <B>Deploy</B>. The project is created, any environment values you typed are saved and the
              first deployment is queued.
            </>
          ),
        },
        {
          title: "Change settings later",
          body: (
            <>
              Open the project, Settings, <B>Build and Run</B>, change a field and press <B>Save</B>. The page
              says “Saved. Changes apply to the next deployment.”
            </>
          ),
        },
      ])}
      <Table
        caption="Project settings"
        head={["Setting", "What it does", "Default"]}
        rows={[
          ["Production branch", "A push here deploys to production.", "The repository’s default branch"],
          ["Root directory", "The folder inside the repository to build, for monorepos.", <C key="r">.</C>],
          ["Runtime", "How to install, build and run it. See Runtimes.", "Node.js"],
          ["Install command, Build command, Start command", "Override a command. Each is one line of at most 500 characters.", "Detected from the runtime"],
          ["Output directory", "Static sites only: the folder to serve.", "The root"],
          ["Port", "The port the app listens on. Unique on a server.", <C key="p">3000</C>],
          ["Health check path", "The path requested to decide the app is up. Starts with a slash. Set it in Settings.", <C key="h">/</C>],
          ["Deploy automatically on push", "Build on every push to a branch.", "On"],
        ]}
      />
      <List>
        <li>
          <B>Copy build settings from another project</B> fills the form from a project on the same server:
          runtime, install, build and start commands, output directory, root directory and health path.
          Nothing is saved until you press Save. Variables, hooks, notifications, the port and the repository
          are not copied.
        </li>
        <li>
          <B>Adopt an existing checkout</B> is for a repository that already runs on this container. The
          project is created with automatic deploys off. Tick <B>Deploy automatically on push</B> in Settings
          when the first manual deploy works.
        </li>
        <li>
          <B>Delete Project</B> asks you to type the project name. With “Also stop the service and delete
          releases” ticked, which is the default, the service and releases are removed from the container, but
          only if Nest Deploy created them. The <C>shared/</C> folder is kept. Unticked, only the records go and
          the app keeps running.
        </li>
      </List>
      <H3 id="projects-runtimes" />
      <Table
        caption="Runtimes"
        head={["Runtime", "Install and build", "Default start"]}
        rows={[
          [
            "Node.js",
            "Picks pnpm, then yarn, then npm from your lockfile (npm install if there is none) and runs your build script if you have one. Your container then installs production dependencies. node_modules is not uploaded.",
            <C key="n">npm start</C>,
          ],
          [
            "Python",
            "No build. Your container creates a virtual environment and installs requirements.txt into it.",
            <C key="p">python3 app.py</C>,
          ],
          [
            "Static site",
            "Builds if there is a build script, then serves the Output directory with Python 3, or a short Node.js server if Python is missing.",
            "A built-in file server",
          ],
          ["Custom command", "No detection. You give the install, build and start commands.", "Your command"],
        ]}
      />
      <P>
        Builds run in <C>node:22-bookworm</C> for Node.js, Static site and Custom command, and in{" "}
        <C>python:3.12-bookworm</C> for Python. Go, Ruby and Rust are named as not supported by detection. Bun is
        detected but not built yet.
      </P>
      <H3 id="projects-guarantees" />
      <List>
        <li>
          It runs from its release folder with <C>PORT</C>, <C>HOST=0.0.0.0</C> and <C>NODE_ENV=production</C>{" "}
          set.
        </li>
        <li>systemd restarts it three seconds after it exits, so a crash is not the end of the app.</li>
        <li>
          It sees your environment variables. The names <C>PORT</C>, <C>HOST</C>, <C>PATH</C>, <C>HOME</C> and{" "}
          <C>NEST_DEPLOY</C> are reserved.
        </li>
        <li>
          Files in <C>shared/</C> are never touched by a deploy, so data the app keeps there survives new
          releases.
        </li>
      </List>
      {limits("projects", [
        ["Project name", "1 to 60 characters", "The form refuses it."],
        ["Address-safe name (slug)", "1 to 40 lowercase letters, digits and hyphens; starts and ends with a letter or digit", "“The project name must use lowercase letters, digits and hyphens (up to 40).”"],
        ["Commands", "500 characters, one line", "The server refuses the command."],
        ["Root directory", "Relative, no “..”, 200 characters", "“The root directory “DIR” does not exist in this repository.” at deploy time."],
        ["Branch", "200 characters; letters, digits and . _ - /; no leading hyphen", "The server refuses the name."],
        ["Port", "1024 to 65535, and not 20000 to 29999; unique on a server", "“Ports 20000 to 29999 are reserved for previews” or “Port N is already used by another project on this server.”"],
        ["Health check path", "Starts with a slash, 200 characters", "The server refuses the path."],
        ["Repository address", "https, github.com only", "“Repositories on HOST are not supported yet. Supported: github.com.”"],
      ])}
      {wrong("projects", [
        [
          "“You already have a project called “name”.”",
          <>Project names are unique for you. Pick another name.</>,
        ],
        [
          "“Deploy is turned off because N things on this container are in the way.”",
          <>
            The conflict check found a service, folder or port that Nest Deploy did not create. It will not stop
            or change them. Change the project name, server or port, or fix it on your container.
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
          "“The project was created, but NAME was not saved: reason. Press Deploy to try again.”",
          <>The project exists. Press Deploy again; it does not create a second project.</>,
        ],
      ])}
      <Callout tone="note" title="Pasted URLs do not deploy on push">
        A project made from a pasted public repository URL stores no repository name, so a push never builds
        it. It is built by Deploy, a deploy hook or the API. Import through the GitHub app if you want pushes to
        deploy.
      </Callout>
      {example("projects", {
        title: "Set up recipe-bot",
        given: (
          <>
            Sam imports <C>sam-r/recipe-bot</C>. The “We found” summary says Node.js with <C>npm</C>, and Sam’s{" "}
            <C>package.json</C> has a <C>start</C> script.
          </>
        ),
        steps: [
          { title: "Import and accept", body: <>Sam presses Use these settings, names the project <C>recipe-bot</C>, keeps the production branch <C>main</C> and sets the port to <C>3000</C>.</> },
          { title: "Change the health path", body: <>Later Sam opens Settings, Build and Run, sets Health check path to <C>/health</C> and presses Save.</> },
        ],
        result: (
          <>
            The first deployment queues. After the Save, the page reads “Saved. Changes apply to the next
            deployment.” The next deploy checks <C>/health</C> instead of <C>/</C>.
          </>
        ),
      })}
      {related([
        ["env", "Environment variables"],
        ["deployments", "Deployments"],
        ["limits", "Limits"],
      ])}
    </Section>
  ),

  deployments: () => (
    <Section
      id="deployments"
      intro="Every build is a deployment, with its own log, commit and port. Production and preview deployments are kept apart."
    >
      <P>You need a project. API tokens need the deployments:write permission to start, redeploy, cancel or roll back.</P>
      <H3 id="deployments-states" />
      <Table
        caption="Deployment states"
        head={["State", "Meaning"]}
        rows={[
          ["Queued", "Waiting. A project runs one deployment at a time."],
          ["Building", "Cloning, installing, building and packing in the sandbox."],
          ["Deploying", "Uploading, unpacking, starting the service and waiting for it to answer. A rollback also shows as Deploying."],
          ["Ready", "Started and answering."],
          ["Error", "A step failed. The error text is on the deployment page."],
          ["Canceled", "You canceled it, or its pull request closed."],
        ]}
      />
      <P>
        If a production deployment fails after the switch, the previous release is put back and checked for 20
        seconds. The log says “The previous release is serving traffic again.” or “The previous release did not
        come back either. Check the logs.”
      </P>
      <H3 id="deployments-actions" />
      {steps("deployments", [
        {
          title: "Deploy",
          body: (
            <>
              Open the project and press the button at the top. It reads <B>Deploy</B> until a production
              release is live and <B>Redeploy</B> after that. Either way it queues a new build of the tip of the
              production branch. It does not rebuild an older commit.
            </>
          ),
        },
        {
          title: "Redeploy one commit",
          body: (
            <>
              In the Deployments list, open <B>Actions for deployment</B> on a row and choose <B>Redeploy</B>.
              This builds the same commit again into the same environment. If GitHub no longer has the commit,
              the log says “Could not fetch SHA; building the branch tip instead.”
            </>
          ),
        },
        {
          title: "Roll back",
          body: (
            <>
              Press <B>Instant rollback</B> on the project page, or choose it from a row’s menu. It points{" "}
              <C>current</C> at an earlier Ready production release that is still on your container and restarts
              the service. Nothing is rebuilt, but it still waits for the app to answer, for up to 45 seconds.
              If the older release is not healthy, the release that was live is put back. The log ends with
              “Rollback complete. Database changes are not reversed.”
            </>
          ),
        },
        {
          title: "Cancel",
          body: (
            <>
              Choose <B>Cancel</B> on a row that is Queued, Building or Deploying. A running build stops within
              about two seconds.
            </>
          ),
        },
        {
          title: "Restart without building",
          body: (
            <>
              On the project page’s Service card, press <B>Restart</B> and confirm. It restarts the production
              service and builds nothing. The app is offline for a few seconds.
            </>
          ),
        },
      ])}
      <P>
        On the Deployments page you can search by commit, branch, author or pull request (type <C>#14</C>), and
        filter by status, environment, project and time. Tick rows to use <B>Compare</B> (exactly two rows),{" "}
        <B>Cancel</B> (previews that are not finished) or <B>Delete previews</B> (previews that are not live and
        are at least 24 hours old). The page loads the newest 100 deployments and shows 25 at a time with a{" "}
        <B>Show N more</B> button.
      </P>
      <P>
        To keep a record outside the dashboard, open a project’s Deployments tab and press <B>Export CSV</B>. The
        file holds that project’s newest 5,000 deployments with the time (UTC), commit, branch, environment, state,
        duration in seconds and deployment id. It never includes variables, logs, ports or addresses. You can make
        10 exports a minute.
      </P>
      <H3 id="deployments-releases" />
      <P>
        Each release lives in its own folder on your container. After every successful deploy, production keeps
        the five newest Ready releases plus the live one, so up to six can exist after a rollback. Previews keep
        the two newest Ready ones. Older ones are stopped and deleted. A release that was removed cannot be
        rolled back to. Failed and canceled deployments leave nothing on the container.
      </P>
      <H3 id="deployments-previews" />
      <P>
        Any branch other than the production branch builds as a preview, with its own service on the lowest free
        port from 20000 to 29999 on that server. Nest does not give previews an address on its own. The log says
        “Preview is running on port N. Map a domain to it in the Nest dashboard to open it.” Build a preview by
        pushing a branch, opening a pull request, calling a deploy hook with a branch, or using the API.
        Previews use the variables set for All or Preview.
      </P>
      <Callout tone="tip" title="A failed deploy leaves production alone">
        If the new release never answers on its port, the previous release is switched back on, so a failed
        deploy does not leave you on a broken version.
      </Callout>
      {limits("deployments", [
        ["Releases kept in production", "5 Ready, plus the live one", "Older ones are deleted and cannot be rolled back to."],
        ["Previews kept", "2 newest Ready", "Older previews are stopped and removed."],
        ["Preview ports", "20000 to 29999 per server", "“No free preview ports on this server.”"],
        ["Wait for the app to answer", "45 seconds", "The deployment ends as Error."],
        ["Bulk actions", "50 deployments at a time", "Each one runs on its own; one failure does not stop the others."],
        ["Delete previews", "Not live, not cleaned up, not running, 24 hours old or more", "“Only old previews that are not live or removed can be deleted in bulk.”"],
        ["Deployments page", "Newest 100, shown 25 at a time", "Older ones do not appear on the page."],
      ])}
      {wrong("deployments", [
        [
          "“Could not clone the repository. Check the branch name and that Nest Deploy has access to it.”",
          <>Check the production branch name, and that the GitHub app is installed on the repository.</>,
        ],
        [
          "“The build failed (exit CODE).”",
          <>Read the Build Logs card from the bottom. A missing lockfile, a wrong root directory or a missing variable is the usual cause.</>,
        ],
        [
          "“The build output is N MB, over the 500 MB limit.”",
          <>Leave large files out of the build, or ship them another way.</>,
        ],
        [
          "“The new release did not become healthy on port N. Make sure your app listens on the PORT environment variable and on 0.0.0.0.”",
          <>Fix the port or address, or the health path, and deploy again.</>,
        ],
        [
          "“That release was removed from your server to save space.”",
          <>It is outside the five kept. Redeploy that commit instead.</>,
        ],
        [
          "“That deployment is already live.” or “Only production deployments can be rolled back to.”",
          <>Pick a different Ready production deployment.</>,
        ],
        [
          "“There is no earlier release on your server to switch back to.” (the rollback button’s tooltip)",
          <>There is nothing older to go back to. Redeploy a commit instead.</>,
        ],
        [
          "“That deployment is already finished.”",
          <>It ended before Cancel arrived. Check its state.</>,
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
          { title: "Ship a bad release", body: <>The new deployment ends as Error because the service never answers. Production is already back on the old release.</> },
          { title: "Fix and push", body: <>Sam fixes the code and pushes. The next deployment reaches Ready.</> },
          { title: "Roll back a bad one", body: <>A week later Sam ships a change that works but behaves badly, and presses Instant rollback.</> },
        ],
        result: (
          <>
            A new deployment appears with the source “rollback” and the state Ready. The log ends with
            “Rollback complete. Database changes are not reversed.” Any change the bot made to its own
            database stays as it was.
          </>
        ),
      })}
      {related([
        ["github", "GitHub and previews"],
        ["monitoring", "Monitoring and uptime"],
        ["logs", "Logs"],
      ])}
    </Section>
  ),

  env: () => (
    <Section
      id="env"
      intro="Set once per project. Values are encrypted, masked in logs, and written to your container when you deploy."
    >
      <P>You need a project. Open the project’s Settings and find the Environment Variables card.</P>
      {steps("env", [
        {
          title: "Add a variable",
          body: (
            <>
              Type a <B>Name</B> and a <B>Value</B>, choose where it applies in <B>Applies to</B> (All,
              Production or Preview), and press <B>Save</B>.
            </>
          ),
        },
        {
          title: "Import names from the repository",
          body: (
            <>
              Press <B>Import names from the repository</B> to read <C>.env.example</C> (or{" "}
              <C>.env.sample</C>, <C>.env.template</C>, <C>.env.local.example</C>). Every name not yet present is
              added with an empty value. Use the pencil on each to set it.
            </>
          ),
        },
        {
          title: "Change a value",
          body: (
            <>
              Press the pencil (“Change the value of NAME”), type a “New value” and press <B>Update</B>. Saving
              the same name and target again also replaces the value.
            </>
          ),
        },
        {
          title: "Delete a variable",
          body: (
            <>
              Press the trash button. The dialog says “Deployments after this one will not have it.”
            </>
          ),
        },
        {
          title: "Apply the change",
          body: (
            <>
              A change reaches your container on the next deployment. Redeploy to apply it now.
            </>
          ),
        },
      ])}
      <List>
        <li>
          The list shows names and targets only. Values are never returned by the browser, the API or an access
          token. An empty value is left out of the file on the container.
        </li>
        <li>
          Values are also passed to the build, and the build sees them as normal environment variables.
        </li>
        <li>
          Build and deploy logs hide each value of 4 or more characters as <C>***</C>. A value shorter than 4
          characters is not hidden, and neither is a changed form of a value, such as one encoded in base64.
        </li>
      </List>
      <Callout tone="warning" title="The Files page can show current/.env">
        Nest Deploy writes each release’s variables to a <C>.env</C> file at the top of the release. You can
        open <C>current/.env</C> in the project’s Files page while signed in, and it shows the values in plain
        text. Only the API and access tokens refuse to read it. Anyone who can use your signed-in account can
        read your variables that way.
      </Callout>
      {limits("env", [
        ["Variables per project", "100, counted per name and target", "“A project can have up to 100 variables.”"],
        ["Name", "Letters, digits and underscores, not starting with a digit; 100 characters", "“Names use letters, digits and underscores, and do not start with a digit”"],
        ["Value", "10,000 characters", "The server refuses the value."],
        ["Reserved names", "PORT, HOST, PATH, HOME, NEST_DEPLOY", "“That name is set by Nest Deploy”"],
        ["Masking", "Values of 4 or more characters", "Shorter values show in the log as typed."],
      ])}
      {wrong("env", [
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
          "A change did not take effect",
          <>It needs a deployment. Press Redeploy, then check the variable is set for the right environment.</>,
        ],
        [
          "A variable is set for All and for one environment",
          <>
            Keep one row per name where you can. Nest Deploy loads both rows, and these docs do not promise
            which one wins.
          </>,
        ],
      ])}
      {example("env", {
        title: "Give recipe-bot its Discord token",
        given: (
          <>
            <C>recipe-bot</C> reads its Discord token from <C>DISCORD_TOKEN</C>. The repository has a{" "}
            <C>.env.example</C> with that name and no value.
          </>
        ),
        steps: [
          { title: "Import the names", body: <>Sam presses Import names from the repository.</> },
          { title: "Set the value", body: <>Sam presses the pencil beside <C>DISCORD_TOKEN</C>, pastes the token as the New value and presses Update.</> },
          { title: "Apply it", body: <>Sam presses Redeploy.</> },
        ],
        result: (
          <>
            The list shows <C>DISCORD_TOKEN</C>, All, with no value. The build log prints the token as{" "}
            <C>***</C> if the app ever echoes it. The bot logs in on the new release.
          </>
        ),
      })}
      {related([
        ["projects", "Projects and runtimes"],
        ["deployments", "Deployments"],
        ["api", "Access tokens and the API"],
      ])}
    </Section>
  ),

  logs: () => (
    <Section id="logs" intro="Two kinds: what the build printed, and what your running app prints.">
      <P>
        Build logs need a deployment. Runtime logs need a project that has been deployed, because they are read
        from your container.
      </P>
      {steps("logs", [
        {
          title: "Read a build log",
          body: (
            <>
              Open a deployment. The <B>Build Logs</B> card shows each line. While the deployment runs, new lines
              stream in and the page says “Waiting for the first log line…” until the first one arrives. Use{" "}
              <B>Find in logs…</B> to search.
            </>
          ),
        },
        {
          title: "Open the runtime logs",
          body: (
            <>
              Open Logs in the sidebar, choose a project, and pick a <B>Time range</B> (1 hour, 24 hours or 7
              days; the default is 7 days) and a <B>Level</B> (All lines, or Warnings and errors).
            </>
          ),
        },
        {
          title: "Search and keep a copy",
          body: (
            <>
              Type in <B>Search logs</B>. Tick <B>Refresh every 5s</B> to follow the log live, or press{" "}
              <B>Refresh</B>. Press <B>Download</B> to save exactly the lines on screen as a text file, for
              example <C>recipe-bot-logs-24h-2026-11-05.txt</C>.
            </>
          ),
        },
      ])}
      <List>
        <li>
          Runtime logs are the production service’s journal on your container. The page shows up to 300
          lines. A search or the Warnings and errors level reads the newest 1000 lines first, filters them,
          and keeps the newest 300.
        </li>
        <li>
          Nest Deploy decides a line’s level from its text, for example <C>[ERROR]</C>, <C>level=warn</C>, a
          JSON level, or words such as failed, exception and traceback. “0 errors” does not count. A stack
          trace takes the level of the error above it.
        </li>
        <li>Build logs have no download button. They stay on the deployment page.</li>
      </List>
      {limits("logs", [
        ["Runtime log lines shown", "300", "The newest 300 after any filter."],
        ["Lines read for a search or level filter", "1000", "Older lines are not searched."],
        ["Build log lines loaded on a page", "1000", "Each stored line is cut at 4000 characters."],
        ["Search text", "200 characters", "The rest is cut off."],
        ["Reading the journal", "30 seconds", "“Could not read the logs from your container.”"],
        ["Live build stream", "About 3.75 hours", "The stream stops; reload the page."],
        ["Journal history", "Whatever systemd keeps on your container", "Nest Deploy does not set it."],
      ])}
      {wrong("logs", [
        [
          "“Could not read the logs from your container.”",
          <>The container did not answer. Press Refresh; if it keeps failing, test the connection on the Connect page.</>,
        ],
        [
          "“We can’t reach your container right now”",
          <>Use the retry button. Your apps may still be running.</>,
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
          "A secret appears in a build log",
          <>
            Masking only covers values of 4 or more characters that appear exactly as stored. Do not print
            secrets from your own code.
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
        ],
        result: (
          <>
            The page lists the matching lines marked Error or Warning, newest first among the 300 kept. Sam sees
            Discord’s rate limit message and presses Download to attach the lines to a support question.
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
      intro="Nest maps domains to ports on its own dashboard and has no API for it, so Nest Deploy tells you what to enter and checks that it worked."
    >
      <P>
        You need a connected server and a domain you can edit DNS for, or a name that already ends in{" "}
        <C>.hackclub.app</C>. The form adds the domain to your first connected server.
      </P>
      {steps("domains", [
        {
          title: "Add the domain",
          body: (
            <>
              Open Domains. In <B>Add a domain</B>, type the <B>Domain</B>, optionally pick a{" "}
              <B>Project (optional)</B> to fill its port, check the <B>Target port</B> and press{" "}
              <B>Add domain</B>.
            </>
          ),
        },
        {
          title: "Point DNS at Nest",
          body: (
            <>
              At your DNS provider, create a CNAME record using the “CNAME name” and “CNAME value” shown. The
              value is <C>your-nest-username.hackclub.app</C>. Names that already end in{" "}
              <C>.hackclub.app</C> skip this.
            </>
          ),
        },
        {
          title: "Map it in the Nest dashboard",
          body: (
            <>
              In the Domains page of your Nest dashboard, add the same domain with the same port. Nest Deploy
              cannot do this for you.
            </>
          ),
        },
        {
          title: "Check",
          body: (
            <>
              Press <B>Check</B>. The status moves from “Not checked” to “Valid” when the CNAME is right, or to
              “Needs attention” with a reason.
            </>
          ),
        },
      ])}
      <List>
        <li>
          <B>DNS check.</B> Valid when the domain’s CNAME includes your <C>username.hackclub.app</C> name. For
          a name under that address, or that exact name, an A record is enough.
        </li>
        <li>
          <B>App check.</B> Only once DNS is Valid. Nest Deploy sends a GET over HTTPS to <C>/</C> and to the
          project’s health path, waits 5 seconds, checks the certificate, follows no redirects and reads no
          body. It shows “Certificate accepted” or “Certificate not verified yet”, then “Answers with HTTP
          CODE” or “Reachable but returning CODE” for a status of 500 or more. It only checks names that
          resolve to public addresses.
        </li>
        <li>
          <B>Edit</B> (the pencil) changes the project and port. Changing the port resets the status and says
          “Saved. Also change the target port to N on the Domains page of your Nest dashboard, then press
          Check.”
        </li>
        <li>
          <B>Remove</B> deletes the record in Nest Deploy only. Nest and your DNS provider are not changed.
        </li>
      </List>
      {limits("domains", [
        ["Domain", "A hostname up to 253 characters; no IP address or URL", "“Enter a domain name such as app.example.com (not an IP address or a URL).”"],
        ["Target port", "1 to 65535", "“Enter a port between 1 and 65535.”"],
        ["Same domain twice", "Once across all users", "“DOMAIN is already added.”"],
        ["App check wait", "5 seconds", "“No answer within 5 seconds.”"],
      ])}
      {wrong("domains", [
        [
          "“The CNAME points to X, but it should point to TARGET.” or “The CNAME points to X. It should point to TARGET.”",
          <>Change the CNAME at your DNS provider to the value shown.</>,
        ],
        [
          "“No CNAME found yet. Create one pointing to TARGET. DNS changes can take a few minutes.”",
          <>Add the record, wait a few minutes, press Check.</>,
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
          "“The certificate is for a different name.” or “The certificate is not trusted.”",
          <>The domain reaches something else. Check the mapping in the Nest dashboard.</>,
        ],
        [
          "“The connection was refused on port 443.”",
          <>Nothing is listening for the domain yet. Check the Nest dashboard mapping and the target port.</>,
        ],
        [
          "“DOMAIN is already added.”",
          <>The name is already recorded, by you or by another account. A domain can be added only once across all users.</>,
        ],
      ])}
      {example("domains", {
        title: "Give the bot’s page a domain",
        given: (
          <>
            <C>recipe-bot</C> now has a small status web page on port <C>3000</C>. Sam owns{" "}
            <C>recipes.example.com</C>.
          </>
        ),
        steps: [
          { title: "Add the domain", body: <>Sam adds <C>recipes.example.com</C> with project <C>recipe-bot</C>, which fills port <C>3000</C>.</> },
          { title: "Set DNS and Nest", body: <>Sam creates a CNAME to <C>sam-r.hackclub.app</C> and adds the same domain and port in the Nest dashboard.</> },
          { title: "Check", body: <>Sam presses Check.</> },
        ],
        result: (
          <>
            The status reads “Valid” and the app check shows “Certificate accepted” and “Answers with HTTP
            200”.
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
      intro="Nest Deploy reads your code through a GitHub app that you install on chosen repositories, and builds when you push."
    >
      <P>
        You need a GitHub account and a connected server. The app is needed for private repositories, for
        pushes to deploy, and for pull request comments.
      </P>
      <H3 id="github-push" />
      {steps("github", [
        {
          title: "Install the app",
          body: (
            <>
              On the New project page, press <B>Install the GitHub App</B> and choose the account and
              repositories to share. Come back and press <B>I already installed it</B> if the list is empty.
              Use <B>Add another account or repository</B> to share more later.
            </>
          ),
        },
        {
          title: "Import the repository",
          body: (
            <>
              Pick it under <B>GitHub account</B> and press <B>Import</B>. Leave automatic deploys on.
            </>
          ),
        },
        {
          title: "Push",
          body: (
            <>
              A push to the production branch deploys to production. A push to any other branch builds a
              preview.
            </>
          ),
        },
      ])}
      <List>
        <li>Branch deletions, tag pushes and other events are ignored.</li>
        <li>
          Only projects with <B>Deploy automatically on push</B> on, and whose repository and installation
          match, are built.
        </li>
        <li>The same commit is not built twice while one for it is already queued, building or deploying.</li>
        <li>
          A project made from a pasted public URL is not built by a push. See Projects and runtimes.
        </li>
        <li>
          If you uninstall the app on GitHub, projects keep their records but lose access to private
          repositories until you install it again.
        </li>
      </List>
      <H3 id="github-pr-previews" />
      <List>
        <li>
          A pull request from the same repository that is not a draft, and not from the production branch,
          builds a preview. It gets one comment from the app, which is updated when the build finishes.
        </li>
        <li>
          The comment says “Preview ready” or “Preview failed”, with the project name, branch, short commit and
          a link, “Open the deployment”, that only you can open. It never includes error output, the server
          name or variable values.
        </li>
        <li>
          Closing the pull request cancels builds still running and removes its Ready previews from your
          container. The deployments show as Canceled with “Pull request closed”.
        </li>
        <li>Pull requests from forks and from the production branch are not built.</li>
      </List>
      <Callout tone="warning" title="A draft pull request’s branch still builds a preview">
        A push to the branch of a draft pull request in the same repository does build a preview, because that
        comes from the push event. Only the pull request event skips drafts, so no comment is written until the
        pull request is marked ready for review.
      </Callout>
      <Callout tone="note" title="Permissions for the comment">
        Commenting needs the app to have Pull requests read and write access and the Pull request event. Without
        it, previews still build and the comment is skipped quietly.
      </Callout>
      {limits("github", [
        ["Repositories listed", "5 pages of 100, newest push first", "Repositories beyond that are not listed."],
        ["Installation owner", "The first Nest Deploy user to link it", "“That GitHub installation is not linked to your account.”"],
        ["Comments read when updating", "100 per pull request", "A comment beyond that is not found."],
        ["Pull request events handled", "opened, reopened, synchronize, ready_for_review, closed", "Other events are ignored."],
        ["Commit message kept", "First line, 300 characters", "The rest is cut off."],
      ])}
      {wrong("github", [
        [
          "“No repositories shared with the app yet.”",
          <>Open <B>Install the GitHub App</B> and share at least one repository.</>,
        ],
        [
          "“The GitHub App is not configured.”",
          <>This copy of Nest Deploy has no GitHub app set up. Self-hosters set the GITHUB_APP_* variables.</>,
        ],
        [
          "“The GitHub App is no longer installed on that account.”",
          <>Install it again on GitHub, then press I already installed it.</>,
        ],
        [
          "A push did not deploy",
          <>Check Deploy automatically on push, and that the project came from the app and not a pasted URL.</>,
        ],
        [
          "No comment on a pull request",
          <>
            Check that the pull request is not a draft or from a fork, and that the app has Pull requests read
            and write access. The deploy itself is not affected.
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
          { title: "Push a branch", body: <>Sam pushes branch <C>new-search</C>.</> },
          { title: "Open a pull request", body: <>Sam opens a pull request into <C>main</C>.</> },
        ],
        result: (
          <>
            A preview deployment builds on port <C>20000</C>. The pull request gets one comment, “Preview
            ready”, with an Open the deployment link. When Sam merges and closes the pull request, the preview
            is stopped and removed from the container.
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
      <P>You need a project and a way to send an HTTP POST. Nothing else, and no token.</P>
      {steps("hooks", [
        {
          title: "Create the hook",
          body: (
            <>
              Open the project, Settings, <B>Deploy Hook</B>, and press <B>Create hook</B>.
            </>
          ),
        },
        {
          title: "Copy the URL now",
          body: (
            <>
              The card says “Copy it now. For safety it is not shown again.” Only a hash is stored. It also
              shows a ready-made <C>curl -X POST</C> line.
            </>
          ),
        },
        {
          title: "Call it",
          body: (
            <>
              Send a POST. An optional JSON body picks a branch; a branch other than the production branch
              builds a preview.
            </>
          ),
          code: {
            label: "Terminal",
            code: `curl -X POST https://your-nest-deploy/api/hooks/deploy/ndh_...\ncurl -X POST -H "Content-Type: application/json" -d '{"branch":"new-search"}' https://your-nest-deploy/api/hooks/deploy/ndh_...`,
          },
        },
        {
          title: "Replace or revoke",
          body: (
            <>
              <B>Make a new URL</B> replaces the old one, which stops working at once. <B>Revoke</B> removes
              the hook.
            </>
          ),
        },
      ])}
      <List>
        <li>
          A good call answers 202 with the new deployment’s id, state, branch and environment. The deployment’s
          source is “hook” and the message “Triggered by deploy hook”.
        </li>
        <li>The body can only hold a <C>branch</C>. Any other field is refused.</li>
        <li>The hook route does not check where the request came from. The URL is the only secret.</li>
      </List>
      <Callout tone="warning" title="Treat it like a password">
        Anyone with the URL can deploy that project. If it leaks, press Make a new URL.
      </Callout>
      {limits("hooks", [
        ["Hooks per project", "One", "Make a new URL replaces it."],
        ["Running deployments", "One per project at a time", "409 “A deployment is already running for this project.”"],
        ["Branch name", "Same rules as a project branch", "400 with the reason."],
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
          "“A hook is active and its URL is hidden.”",
          <>This is normal. Make a new URL to see one again; the old one stops working at once.</>,
        ],
      ])}
      {example("hooks", {
        title: "Redeploy every night",
        given: (
          <>
            Sam wants <C>recipe-bot</C> to redeploy every night so it picks up a data file fetched at build
            time.
          </>
        ),
        steps: [
          { title: "Create the hook", body: <>Sam creates the hook and copies the URL.</> },
          { title: "Store it", body: <>Sam stores the URL as a secret in a cron service.</> },
          { title: "Schedule the call", body: <>Sam runs the <C>curl -X POST</C> line at 03:00.</> },
        ],
        result: (
          <>
            Each night a deployment appears in the list with source “hook”. If Sam is mid-deploy at that time,
            the call answers 409 and nothing breaks.
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
        You need an incoming webhook URL from Discord or Slack. The same webhook also carries the alerts
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
              <B>Send</B> (Every deployment, or Failures only) and press <B>Save</B>.
            </>
          ),
        },
        {
          title: "Send a test",
          body: (
            <>
              Press <B>Send test message</B>. It posts “Test from Nest Deploy for PROJECT” and the card says
              “Sent. Check the channel.”
            </>
          ),
        },
      ])}
      <List>
        <li>
          Accepted: https only, no port, query or credentials. Discord hosts are <C>discord.com</C>,{" "}
          <C>discordapp.com</C>, and both with a <C>ptb.</C> or <C>canary.</C> prefix, with a path{" "}
          <C>/api/webhooks/ID/TOKEN</C>. Slack is <C>hooks.slack.com</C> with a path{" "}
          <C>/services/…</C>.
        </li>
        <li>
          The URL is stored encrypted and never shown again. The card says “Sending to Discord for every
          finished deployment. The URL is hidden. Paste a new one to replace it.” <B>Remove</B> deletes it.
        </li>
        <li>
          A message says “PROJECT is live in production” (or “a preview”) or “PROJECT failed to deploy”, then
          branch, short commit and message (or the error, up to 200 characters), the duration and a link.
          Discord messages cannot ping anyone.
        </li>
        <li>
          Failures only hides the “is live” messages. A failed post is only logged and never changes the
          deployment.
        </li>
      </List>
      {limits("notifications", [
        ["Webhook per project", "One", "Saving a new URL replaces it."],
        ["URL length", "500 characters", "The form refuses it."],
        ["Time to post", "5 seconds", "The post is dropped and logged; redirects are refused."],
        ["Error text in a message", "200 characters", "The rest is cut off."],
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
          "Messages stop arriving",
          <>
            Check the Alerts card: the “Deployment results” channel and an active pause also stop deployment
            messages. The events still appear in the history.
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
            The channel shows “Test from Nest Deploy for recipe-bot”. From now on it only hears about failed
            deployments, and about alerts if those are on.
          </>
        ),
      })}
      <H2 id="notifications-webhooks" title="Signed webhooks for your own code" />
      <P>
        Discord and Slack are for people. To tell a program, use <B>Webhooks</B> in Account. Nest Deploy sends a
        signed JSON message to an https address when a deployment starts, succeeds or fails. It covers every project
        on your account.
      </P>
      <Steps
        id="notifications-webhooks-steps"
        level={3}
        items={([
        {
          title: "Add the address",
          body: <>Open Account, find <B>Webhooks</B>, paste the address under <B>Add a webhook address</B> and press <B>Add webhook</B>.</>,
        },
        {
          title: "Copy the secret",
          body: <>The card shows the signing secret once, starting with <C>whsec_</C>. Copy it before you press <B>I have copied it</B>. It cannot be read again.</>,
        },
        {
          title: "Send a test",
          body: <>Press <B>Send test</B> on the new row. The toast says “Test message delivered”, and the row lists the delivery under <B>Recent deliveries</B>.</>,
        },
        {
          title: "Check the signature in your code",
          body: (
            <>
              Every request has an <C>X-NestDeploy-Signature</C> header of the form <C>t=TIME,v1=HEX</C>. The value
              is an HMAC-SHA256 of <C>TIME.BODY</C>, keyed with your secret. Refuse a request that does not match,
              or whose time is more than 300 seconds from yours.
            </>
          ),
          code: {
            label: "Node.js",
            code: `import { createHmac, timingSafeEqual } from "node:crypto";

export function isFromNestDeploy(secret, header, body) {
  const m = /^t=(\\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > 300) return false;
  const want = createHmac("sha256", secret).update(m[1] + "." + body).digest();
  return timingSafeEqual(want, Buffer.from(m[2], "hex"));
}`,
          },
        },
      ] as Step[]).map(toStep)}
      />
      <P>
        The body is JSON with the event (<C>deployment.started</C>, <C>deployment.succeeded</C> or{" "}
        <C>deployment.failed</C>), the project’s id and slug, the deployment’s id, branch, short commit and state,
        and the time. It never carries variables, logs, commit messages, errors or links. The headers{" "}
        <C>X-NestDeploy-Event</C> and <C>X-NestDeploy-Delivery</C> name the event and this delivery.
      </P>
      <Limits
        id="notifications-webhooks-limits"
        level={3}
        items={([
        ["Webhooks per account", "10", "Delete one to add another."],
        ["Address", "https, a domain name, no port, no credentials, 500 characters at most", "The form says what to change."],
        ["Where it can point", "A public address", "Private, loopback and internal addresses are refused when the message is sent."],
        ["Time to answer", "5 seconds", "The attempt counts as failed. Redirects are not followed."],
        ["Attempts", "3, with pauses of 2 and 10 seconds", "A failed delivery is listed with a short reason."],
        ["Delivery history", "30 days", "Older rows are removed."],
      ] as [string, string, ReactNode][]).map(([name, value, atLimit]) => ({ name, value, atLimit }))}
      />
      <P>
        <B>Pause</B> stops messages without deleting the webhook, <B>New secret</B> makes the old secret stop
        working at once, and <B>Delete</B> removes the webhook and its history.
      </P>
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
        <li>It refreshes when the page opens and every 30 seconds while the tab is visible.</li>
        <li><B>Check now</B> reads it on demand.</li>
        <li>
          <B>Restart</B> restarts the production service after you confirm “Restart the service?”. It builds
          nothing.
        </li>
      </List>
      <H3 id="monitoring-resources" />
      <P>
        The project’s card shows memory and CPU of this one service for the last 24 hours. CPU is a share of one
        core, so it can pass 100. A point is left blank when there is no earlier reading, the gap is over 30
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
        answering since TIME” or “Not checked yet”. Each project sets its own alerts.
      </P>
      {steps("monitoring", [
        {
          title: "Open the Alerts card",
          body: <>Open the project, Settings, <B>Alerts</B>. A webhook must be saved under Notifications for any message to be sent.</>,
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
          title: "Pause when you need quiet",
          body: (
            <>
              Choose “For 1 hour”, “For 24 hours” or “Until I resume” and press <B>Pause</B>. Press{" "}
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
        ["Failed checks before down", "1 to 10, default 2", "“Failed checks must be a whole number from 1 to 10.”"],
        ["Resource limits", "1 to 100 each, default 90", "“The disk limit must be a whole number from 1 to 100.” (and memory, CPU)"],
        ["Slow response limit", "50 to 60000 ms", "“The response time limit must be at least 50 ms.” or “…cannot be above 60000 ms.”"],
        ["Samples kept", "7 days", "Older readings are deleted; the charts show 24 hours or 7 days."],
        ["Service card refresh", "30 seconds, 20 second read", "“Could not read the service from your container.”"],
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
          <>Press Try again.</>,
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
          { title: "Keep the channels", body: <>Sam leaves the four channels on and presses Save.</> },
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
              Open the project, Settings, <B>Public Status Page</B>, and press <B>Publish status page</B>.
            </>
          ),
        },
        {
          title: "Share the link",
          body: (
            <>
              The page is at <C>/status/KEY</C> on your Nest Deploy address. The key is 12 random URL-safe
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
          answering, a strip of 30 days, and the latest 10 outages. Nothing else: no repository, port, server
          or commit.
        </li>
        <li>
          The state card reads “Operational” (“The app is answering.”), “Not responding” (“The app has stopped
          answering.”) or “No data yet” (“Checks have not run for this app yet.”). The percentage is withheld
          until a check has run.
        </li>
        <li>
          The strip has one square per UTC day. Green means the app answered all day, amber that it was down
          for part of the day, red that it was down for more than half of it, and grey that no checks had run.
          Hover a square, or use a screen reader, to see the minutes.
        </li>
        <li>
          A slow answer over your Slow response limit counts as down here too, because it fails the check.
        </li>
      </List>
      {limits("status-page", [
        ["Window", "30 days", "Older days are not shown."],
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
          body: <>Copy the “Tracking snippet” into the head of every page you want counted.</>,
          code: {
            label: "HTML",
            code: `<script defer data-key="nda_..." src="https://your-nest-deploy/api/analytics/script?key=nda_..."></script>`,
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
        Page views and visitors for the last 30 days, a bar for each day, your top 10 pages, and the top 10
        sites visitors came from. Visitors are counted per day, so someone who comes on two days counts twice.
        Percentages, shares and the median appear only with at least 50 visits behind them. Below that you see
        counts and “Not enough data”.
      </P>
      <P>
        The “What else to record” card adds three things. Each is off until you turn it on, and with all three
        off the script is the plain page view script.
      </P>
      <List>
        <li>
          <B>Clicks</B> (“Top clicks”). The label of the link, button or element with <C>data-nd-track</C> that
          was clicked: <C>data-nd-track</C>, else <C>aria-label</C>, else the text, at most 40 characters. A label
          holding an email address is dropped. It never records input values or form content, and stores only
          the project, the UTC day and the label.
        </li>
        <li>
          <B>Time on page.</B> How long the page was open and visible, in four groups: under 10 seconds, 10 to
          60 seconds, 1 to 5 minutes, over 5 minutes. It is sent when the visitor leaves.
        </li>
        <li>
          <B>Funnel.</B> Two to six steps in order, each a page path starting with <C>/</C> or a tracked name.
          A visitor counts at a step only after reaching the ones before it, on the same UTC day.
        </li>
      </List>
      <H3 id="analytics-privacy" />
      <List>
        <li>By default only the page path and the referring site are recorded. No cookies.</li>
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
          The path loses its query and fragment. The referrer is reduced to its host without <C>www.</C>.
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
        ["Page views", "1 per second per project and address", "Extra views are dropped."],
        ["Click, time and goal events", "30 per 10 seconds per project and address", "Extra events are dropped."],
        ["Path and referrer", "200 and 100 characters", "The rest is cut off."],
      ])}
      {wrong("analytics", [
        [
          "No numbers appear",
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
          "“Could not save” or “Could not change analytics”",
          <>The change did not go through. Try again.</>,
        ],
        [
          "A funnel does not turn on",
          <>It needs at least 2 steps. A funnel with fewer counts as off.</>,
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
          { title: "Record clicks", body: <>Sam turns on Clicks and marks the button <C>data-nd-track=&quot;subscribe&quot;</C>.</> },
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





