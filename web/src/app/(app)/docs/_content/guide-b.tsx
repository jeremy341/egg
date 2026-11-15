import type { ReactNode } from "react";
import { BUILD_RESOURCES, repoLink, scopeNeeds, TOKEN_PLACEHOLDER } from "@/lib/developer";
import { REPO_URL } from "@/lib/site";
import { B, C, Callout, ExternalLink, H3, InternalLink, List, P, Section, Table } from "../_components/prose";
import {
  Limits,
  Steps,
  WhatCanGoWrong,
  WorkedExample,
  type LimitItem,
  type ProblemItem,
  type StepItem,
} from "../_components/worked-example";
import { docsHref, subsectionTitle } from "../_data/nav";

const setupDoc = `${REPO_URL}/blob/main/docs/backend-setup.md`;

// Small adapters so each page below reads as data. Every block takes a heading
// id that is unique on its page. Topic sections are `<H3 id />` (an h2 from
// `_data/nav.ts`); steps sit one level down (h3); the limits, the failures and
// the worked example close the page as h2 sections.

type Step = { title: string; body?: ReactNode; code?: StepItem["code"]; path?: string[] };
const toStep = (s: Step): StepItem => ({ title: s.title, children: s.body, code: s.code, path: s.path });

/** Numbered steps under a heading. `level` 3 when they sit inside a topic. */
const steps = (id: string, title: string, items: Step[], level: 2 | 3 = 3) => (
  <Steps id={id} title={title} items={items.map(toStep)} level={level} />
);

/** Limits as name, value and what happens at it. */
const limits = (id: string, rows: [string, string, ReactNode][], level: 2 | 3 = 2) => {
  const items: LimitItem[] = rows.map(([name, value, atLimit]) => ({ name, value, atLimit }));
  return <Limits id={id} items={items} level={level} />;
};

/** Each failure: the exact message (shown as code), then the fix. */
const wrong = (id: string, rows: [string, ReactNode][], title?: string, level: 2 | 3 = 2) => {
  const items: ProblemItem[] = rows.map(([symptom, fix]) => ({ symptom, fix }));
  return <WhatCanGoWrong id={id} items={items} level={level} {...(title ? { title } : {})} />;
};

/** A worked example: what you start with, what you do, what you see. */
const example = (
  id: string,
  e: { title: string; given: ReactNode; steps: Step[]; result: ReactNode },
  level: 2 | 3 = 2
) => (
  <WorkedExample id={id} title={e.title} given={e.given} steps={e.steps.map(toStep)} result={e.result} level={level} />
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
 * The guides for security, the container, activity, the account, limits,
 * running your own copy, troubleshooting and the API. Every number is read from
 * the code that enforces it and every message is quoted as the product prints
 * it. Titles come from `_data/nav.ts`.
 */
export const GUIDE_B: Record<string, () => ReactNode> = {
  /* ---------------------------------------------------------------- */
  security: () => (
    <Section
      id="security"
      intro="How Nest Deploy keeps your SSH key, your builds and your secrets, and what the people who run it can and cannot see."
    >
      <H3 id="security-key" />
      <P>
        When you press <B>Create key</B> on the Connect page, Nest Deploy makes one ed25519 key for that server and
        for nothing else. You paste the public half into the SSH Keys page of the Nest dashboard. The private half is
        sealed with AES-256-GCM before it is stored. The sealing key comes from the <C>APP_SECRET</C> setting, and the
        sealed value is tied to that one server, so it cannot be copied into another row and still open. The private
        key is never shown, and no API call returns it.
      </P>
      <Callout tone="warning" title="This key is root on your container">
        SSH into Nest lands in a root shell inside your own container, so the key can do anything you can do there.
        The Connect page says so before you add it. Connect only a container you are happy to deploy to.
      </Callout>
      <P>
        The first successful <B>Test connection</B> pins the SHA-256 fingerprint of Nest’s SSH host. After that, if
        the host presents any other key, Nest Deploy stops before it sends anything. <B>New key</B> replaces your key
        but keeps the pin. The only way to clear a pin is <B>Disconnect</B>, then adding the server again.
      </P>
      <Callout tone="warning" title="Disconnect also deletes the server’s projects">
        Disconnect removes the server here, and with it every project on that server: its deployments, logs,
        variables, hook and status page. Nothing is removed from the container, and the dialog does not mention the
        projects, so read this before you press it.
      </Callout>
      {steps("security-key-steps", "Take access back", [
        {
          title: "Delete the key in Nest",
          body: "Access ends at once. Your apps keep running, because they are ordinary systemd services in your container.",
          path: ["Nest dashboard", "SSH Keys", "Delete the key"],
        },
        {
          title: "Check it",
          body: (
            <>
              Press <B>Test connection</B> on the Connect page. It should report “Could not connect”.
            </>
          ),
        },
        {
          title: "Tidy up",
          body: (
            <>
              Press <B>Disconnect</B> when you are done with the server, or <B>New key</B> to start again with a
              fresh key.
            </>
          ),
        },
      ])}

      <H3 id="security-builds" />
      <P>
        Builds run on the Nest Deploy side, never on your container. Each one runs in a Docker sandbox with 2 GB of
        memory, 2 CPUs, at most 2048 processes, every Linux capability dropped and <C>no-new-privileges</C> set. The
        build gets your project’s variables and normal outbound network access, because installing packages needs it.
        The source folder is deleted when the deployment ends. Only plain <C>https</C> repositories on{" "}
        <C>github.com</C> are cloned.
      </P>
      <P>
        Pull requests from forks are never built, because that would run a stranger’s code next to your variables. A
        copy of Nest Deploy that you run yourself can set <C>BUILD_RUNNER=local</C>, which runs builds on the host
        with no isolation. See <InternalLink href={docsHref("selfhost")}>Running your own</InternalLink>.
      </P>

      <H3 id="security-vars" />
      <List>
        <li>
          <B>Environment variables</B> are sealed with AES-256-GCM, tied to the project, the name and where the
          value applies. The list shows names only. Values are never sent back by the browser routes or the API. At
          deploy time they are written to a <C>.env</C> file on your container with mode 600.
        </li>
        <li>
          <B>Log masking.</B> A value of 4 or more characters is replaced by <C>***</C> in build and deploy logs. It
          matches the exact text only: a shorter value, or one your build prints in another form such as base64, is
          not masked. Do not print secrets.
        </li>
        <li>
          <B>Deploy hooks, access tokens and sessions.</B> Only a SHA-256 of each is stored. A hook URL and a token
          secret are shown once, when you make them.
        </li>
        <li>
          <B>Notification webhook URLs</B> are sealed and never shown again.
        </li>
      </List>
      <Callout tone="note" title="One place a value can be read">
        The Files tab can open <C>current/.env</C> and each release’s <C>.env</C> in plain text, because reading files
        is not behind a switch. Anyone signed in to your account can do this. The API refuses those files with “That
        file holds the project’s environment variable values, which are never returned by the API.” Treat your Nest
        Deploy sign-in as the key to your variables.
      </Callout>

      <H3 id="security-signin" />
      <List>
        <li>
          <B>Sign-in.</B> Hack Club Auth proves who you are. Nest Deploy asks only for <C>openid</C>, <C>profile</C>{" "}
          and <C>email</C>, and none of that reaches your container.
        </li>
        <li>
          <B>Session.</B> A random token in an <C>httpOnly</C>, <C>SameSite=Lax</C> cookie called{" "}
          <C>nd_session</C>. It lasts 30 days. Only a hash is stored.
        </li>
        <li>
          <B>Requests.</B> Every change from the browser must come from this site, because the <C>Origin</C> header
          is checked. The API and the MCP endpoint never read cookies. They take a bearer token only.
        </li>
        <li>
          <B>Sensitive switches.</B> The Terminal and File changes switches need a Hack Club sign-in from the last 5
          minutes before they turn on.
        </li>
        <li>
          <B>GitHub events.</B> A webhook is accepted only with a valid <C>X-Hub-Signature-256</C> signature over the
          raw body.
        </li>
      </List>

      <H3 id="security-visibility" />
      <List>
        <li>
          <B>You</B> can see everything that belongs to your account and nothing that belongs to anyone else. Another
          account’s project, server or deployment answers as if it did not exist.
        </li>
        <li>
          <B>The people who run Nest Deploy</B> have no admin screen in the product. What shows through the site is
          the public stats page, which gives totals only: a count under 10 shows as “fewer than 10”, and a percentage
          or median appears only with at least 50 items behind it.
        </li>
        <li>
          <B>They also host the database and hold the secret.</B> <C>APP_SECRET</C> seals your SSH key and your
          variables. The sealing protects a copied database or a backup. It does not stop whoever holds both the
          database and the secret. If that is not acceptable, run your own copy.
        </li>
        <li>
          <B>The public</B> can see three things you turn on: a status page, the analytics script and its collector,
          and the comment on a pull request. A status page shows the project name, whether the app answers, a 30-day
          strip and the latest 10 outages, and nothing else.
        </li>
        <li>
          <B>The log of your actions</B> records what you did, with names and paths. It never records the contents of
          a file, a variable’s value, or what you typed or saw in the terminal.
        </li>
      </List>

      {limits("security-limits", [
        ["Session", "30 days", "The cookie and the stored session both expire. Sign in again."],
        ["Fresh sign-in", "5 minutes", "Older than that, turning on Terminal or File changes sends you to Hack Club again."],
        ["Sign-in handshake", "10 minutes", "A sign-in that takes longer fails. Start again from the login page, in one browser."],
        ["Token with terminal or file changes", "7 days at most", "The token form refuses a longer expiry."],
        ["Servers per account", "5", "“You can connect up to 5 servers.”"],
        ["Notification post", "5 seconds", "The post is dropped and logged. Redirects are refused."],
      ])}

      {wrong("security-wrong", [
        [
          "The host key of <host> changed (was <old>, now <new>). Nothing was sent. If you expected this, reconnect the server.",
          "Stop. Something else answered where Nest should be, or Nest changed its key. If you expected it, Disconnect and add the server again, remembering that Disconnect deletes the server’s projects here.",
        ],
        [
          "Nest rejected the key. Check that you pasted the public key on the SSH Keys page of the Nest dashboard, and that the username is exactly your Nest username.",
          "Paste the public key again. After New key, the old one stops working.",
        ],
        [
          "Confirm with Hack Club first. Turning this on needs a sign-in in the last 5 minutes.",
          "Flip the switch again. It sends you through Hack Club and back to Account.",
        ],
      ])}

      {example("security-example", {
        title: "End Nest Deploy’s access",
        given: "A server connected as sam-r, with two projects running.",
        steps: [
          {
            title: "Delete the key in Nest",
            path: ["Nest dashboard", "SSH Keys", "Delete the key"],
          },
          {
            title: "Test the connection",
            body: (
              <>
                In Nest Deploy, open Connect and press <B>Test connection</B>.
              </>
            ),
          },
        ],
        result: (
          <>
            The server shows “Could not connect” with “Nest rejected the key.” Both apps still answer, because their
            services are still running on your container.
          </>
        ),
      })}
      {related([
        ["servers", "Servers"],
        ["container", "Container, terminal and files"],
        ["env", "Environment variables"],
      ])}
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  activity: () => (
    <Section
      id="activity"
      intro="A newest-first log of what you changed and what the monitor saw, with a search and two filters."
    >
      <P>
        Open Activity in the sidebar. Entries are grouped by day in UTC. Each row says what happened, to which
        project, server or domain, and what did it. A change made with an access token shows the token’s name, so you
        can tell a script from yourself.
      </P>
      <H3 id="activity-log" />
      <P>
        The log covers your own actions and the monitor’s. Examples of the wording: “Created project”, “Changed
        settings for”, “Redeployed”, “Rolled back”, “Canceled a deployment of”, “Deployed through the deploy hook
        for”, “Detected downtime on”, “Created an access token”, “Opened a terminal on”, “Saved a file on”, “Changed
        container permissions for” and “Removed a leftover from the container”.
      </P>
      <P>
        Terminal and file entries record that something happened, with a path or a duration. They never record file
        contents or what you typed or saw. Anything that looks like a secret is dropped before an entry is shown.
      </P>
      <H3 id="activity-filters" />
      {steps("activity-filters-steps", "Find an entry", [
        { title: "Search", body: "Type in “Search by action, project or detail”. Every word you type has to match." },
        {
          title: "Pick a kind",
          body: "Choose All, Projects, Deployments, Domains, Servers, Access and tokens, Monitoring, or Terminal and files.",
        },
        { title: "Pick a date range", body: "Choose Last 24 hours, Last 7 days, Last 30 days or All time." },
        { title: "Load more", body: "Press Load more at the bottom to read the next 50." },
      ])}

      {limits("activity-limits", [
        ["Entries per page", "50", "Press Load more for the next 50."],
        ["Search depth", "The newest 5000", "A search reads in batches of 200 and says when it stopped at the limit. Narrow the date range instead."],
        ["Search text", "80 characters", "Anything longer is cut."],
        ["Retention", "No pruning", "Nest Deploy does not delete old entries. Deleting your account removes all of them."],
      ])}

      {wrong("activity-wrong", [
        ["No activity yet", "Nothing has been recorded for your account yet. Make a change and it appears."],
        ["Nothing in this range yet", "Pick a longer date range, or set Kind back to All."],
        ["Could not load more", "Press Load more again. If it keeps failing, reload the page."],
      ])}

      {example("activity-example", {
        title: "Find who deployed a project",
        given: "A project named recipe-api that went live at an odd hour.",
        steps: [
          { title: "Open Activity", body: "Type recipe-api in the search box." },
          { title: "Narrow it", body: "Set Kind to Deployments and Date range to Last 24 hours." },
        ],
        result: (
          <>
            Rows such as “Deployed through the deploy hook for recipe-api” or “Redeployed recipe-api” show the time
            and what started it, with the token’s name when a script did it.
          </>
        ),
      })}
      {related([
        ["account", "Account"],
        ["api", "Access tokens and the API"],
      ])}
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  account: () => (
    <Section
      id="account"
      intro="Your Hack Club sign-in, the browsers that are signed in, and how to delete your account."
    >
      <P>
        Open Account from the account menu. It has cards for Profile, GitHub, Container permissions, Signed-in
        browsers and Delete Account. Profile shows your name and email from Hack Club and is read only: change them
        there. GitHub lists the accounts where the Nest Deploy app is installed, each with a “Manage on GitHub” link.
        Container permissions are covered on the{" "}
        <InternalLink href={docsHref("container")}>container</InternalLink> page.
      </P>
      <H3 id="account-signin" />
      {steps("account-signin-steps", "Sign in", [
        { title: "Open the login page", body: "Its heading is “Log in to Nest Deploy”." },
        { title: "Press Continue with Hack Club", body: "Approve at Hack Club." },
        { title: "Land on Projects", body: "Nest Deploy sets a session cookie that lasts 30 days." },
      ])}
      <P>
        The account menu has <B>Sign out</B>. It ends this browser’s session and closes every terminal your account
        has open. Some switches ask you to confirm with Hack Club again. That is a second sign-in that counts for 5
        minutes, and it must be the same Hack Club account.
      </P>
      <H3 id="account-sessions" />
      <P>
        The Signed-in browsers card lists each session with a label such as “Chrome on Windows” and when it was
        signed in. This one has a “This browser” badge. Press <B>Sign out</B> on another to end it, or{" "}
        <B>Sign out everywhere else</B> to end them all. Ending another session closes your open terminals.
      </P>
      <H3 id="account-delete" />
      {steps("account-delete-steps", "Delete your account", [
        { title: "Open the Delete Account card", body: "It is at the bottom of Account." },
        { title: "Type your name", body: "Type it exactly as Profile shows it. Spaces at the start and end are ignored." },
        { title: "Press Delete account", body: "Your terminals close first, then your records are deleted." },
      ])}
      <P>
        This deletes your projects, servers, domains, keys, access tokens, sessions and your activity log. Apps
        already on your container keep running, but nothing manages them any more. Delete the key on the SSH Keys page
        of the Nest dashboard as well, so Nest Deploy’s old key does not stay on your container.
      </P>

      {limits("account-limits", [
        ["Session", "30 days", "Sign in again."],
        ["Fresh sign-in", "5 minutes", "It matters only for turning on Terminal or File changes."],
        ["Servers", "5 per account", "“You can connect up to 5 servers.”"],
        ["Access tokens", "25 active", "Revoke one to make another."],
      ])}

      {wrong("account-wrong", [
        ["Hack Club sign-in is not set up on this installation yet.", "The button is off. On your own copy, set HACKCLUB_CLIENT_ID and HACKCLUB_CLIENT_SECRET."],
        ["You did not approve the sign-in. Try again when you are ready.", "Press Continue with Hack Club and approve."],
        ["That sign-in link was not valid. Please try again.", "Start again from the login page."],
        ["The sign-in took too long or came from another browser. Please try again.", "Start and finish in one browser within 10 minutes."],
        ["Hack Club could not sign you in. Please try again in a moment.", "Wait a minute and try again."],
        ["Something went wrong signing in.", "Try again. If it repeats, open an issue on GitHub."],
        ["That is the session you are using. Sign out instead.", "Use Sign out in the account menu for this browser."],
        ["Type your name exactly to confirm.", "Copy your name from the Profile card."],
        [
          "A switch stays off after confirming",
          "You signed in with a different Hack Club account, so you land back on Account with no message. Sign in with the same account and flip the switch again.",
        ],
      ])}

      {example("account-example", {
        title: "End a lost laptop’s session",
        given: "You signed in on a laptop you no longer have.",
        steps: [
          { title: "Open Account", body: "Find the other row under Signed-in browsers." },
          { title: "Press Sign out", body: "Use the button on that row." },
        ],
        result: "The row disappears and any terminal that session had open closes. This browser stays signed in.",
      })}
      {related([
        ["activity", "Activity"],
        ["security", "Security"],
      ])}
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  container: () => (
    <Section
      id="container"
      intro="Three switches decide what Nest Deploy may do inside your container beyond deploying. All three start off."
    >
      <P>
        You need a connected server. The switches live in Account, under Container permissions, one card per server
        named like <C>sam-r.hackclub.app</C>. The server checks the switch on every request, before it opens an SSH
        session, so turning one off stops the very next call. Turning a switch on or off never restarts an app.
      </P>

      <H3 id="container-switches" />
      <Table
        caption="The three container permission switches"
        head={["Switch", "Default", "Fresh sign-in"]}
        rows={[
          [<B key="t">Terminal</B>, "Off", "Needed to turn on"],
          [<B key="f">File changes</B>, "Off", "Needed to turn on"],
          [<B key="r">Removing leftovers</B>, "Off", "Not needed"],
        ]}
      />
      {steps("container-switches-steps", "Turn a switch on", [
        { title: "Open Account", body: "Find Container permissions and the card for your server.", path: ["Account", "Container permissions"] },
        { title: "Flip a switch", body: "It saves at once and a message names the switch and the server." },
        {
          title: "Confirm if asked",
          body: "Terminal and File changes send you to Hack Club and back to Account, where the switch is applied. Turning any switch off never asks.",
        },
      ])}
      <P>
        Reading is separate from changing. You can browse, read and download files, and read the Container page, with
        every switch off.
      </P>
      <Callout tone="warning" title="Check your older servers">
        The File changes switch was reset to off once, for every server that existed at the time of that update. Do
        not assume an older server kept its old setting: open Account and look. A server connected before the
        switches existed may also still have Removing leftovers on. Turn off what you do not use.
      </Callout>
      <Table
        caption="What each switch can destroy"
        head={["Switch", "What it can destroy"]}
        rows={[
          [
            <B key="t">Terminal</B>,
            "Anything the container user can touch, including apps and files Nest Deploy did not create. It is a root shell, and anyone signed in to your account can use it while it is on.",
          ],
          [
            <B key="f">File changes</B>,
            <>
              Anything inside <C>shared/</C> for every project on that server, including data your app keeps there. A
              folder delete is recursive. A change can alter the code your app runs at its next restart, so treat it
              like terminal access.
            </>,
          ],
          [
            <B key="r">Removing leftovers</B>,
            <>
              Nest Deploy services (<C>nd-*.service</C>) that no project uses, and whole folders under{" "}
              <C>~/.nest-deploy</C> that no project uses, including their <C>shared/</C> data.
            </>,
          ],
        ]}
      />

      <H3 id="container-page" />
      <P>
        Container in the sidebar reads your container in one read-only SSH round trip and shows what is running and
        what Nest Deploy left behind. Pick a server if you have more than one, and press <B>Refresh</B> to read it
        again.
      </P>
      <List>
        <li>
          <B>Disk used</B> shows the percentage and how much of it is Nest Deploy folders.
        </li>
        <li>
          <B>Projects</B> shows each project’s service (Running, Starting, Crashed, Stopped, or No service yet), its
          port, folder size and previews. If another program holds a project’s port you see “Port &lt;n&gt; is held
          by &lt;x&gt;, not by &lt;project&gt;” with a “Change the port” link.
        </li>
        <li>
          <B>Orphans</B> lists leftovers, described next.
        </li>
        <li>
          <B>Other ports</B> lists programs listening that Nest Deploy did not start. It is read only.
        </li>
      </List>

      <H3 id="container-leftovers" />
      <P>
        A leftover is a service named <C>nd-&lt;project&gt;.service</C> or a preview unit that no project uses, or a
        folder under <C>~/.nest-deploy</C> that is not a project. It usually appears after you delete a project with
        “Also stop the service and delete releases” unticked, or after a failed cleanup.
      </P>
      {steps("container-leftovers-steps", "Remove a leftover", [
        { title: "Turn on Removing leftovers", body: "In Account, under Container permissions, for that server." },
        { title: "Open Container", body: "Find the row under Orphans. Its kind is Service, Preview service or Folder." },
        {
          title: "Press Remove",
          body: "A service asks “Remove <unit>?”. It stops the service, turns off starting at boot and deletes its unit file. Files in its folder are not touched.",
        },
        {
          title: "Confirm a folder by name",
          body: "A folder asks “Delete the folder <name>?” and you type its name, then press Delete folder. This deletes it and everything inside, including shared data, and cannot be undone.",
        },
      ])}
      <P>
        Nest Deploy knows what it made by two markers. A service file starts with a comment{" "}
        <C>nest-deploy:managed</C>, and a project folder holds a file named <C>.nest-deploy-managed</C>. An older
        folder without that file counts only if it holds nothing but <C>releases</C>, <C>incoming</C>,{" "}
        <C>shared</C>, <C>current</C> and <C>current.new</C> and has no <C>.git</C>. Anything without a marker is
        never overwritten, stopped, moved or deleted: a deploy refuses, cleanup refuses and project deletion leaves
        it.
      </P>
      <P>
        Every request is checked again against a fresh read of the container. A row that now belongs to a project,
        that is a symbolic link, or that has no marker is refused, even if you press Remove. Access tokens and the MCP
        endpoint cannot remove leftovers at all.
      </P>

      <H3 id="container-adopt" />
      <P>
        If an app of yours already runs on the container, Nest Deploy can check what the new project would collide
        with before it touches anything. In New Project the check runs by itself once the name, server and port are
        valid, and again at the start of every deploy. It never stops, moves or deletes anything.
      </P>
      <List>
        <li>
          <B>Blocks the deploy:</B> a service called <C>nd-&lt;name&gt;.service</C> that Nest Deploy did not create;
          the project folder being a link, a file, someone else’s git checkout, or a folder with other files in it;
          the port used by another program; a program or service already running from the project folder; and, for the
          first production deploy only, the same repository already running by hand from another checkout.
        </li>
        <li>
          <B>Good to know, does not block:</B> a stopped service for the same repository, a checkout that is only
          sitting there, leftovers from an earlier Nest Deploy project of the same name (they are reused), and ports
          the container would not let it read.
        </li>
      </List>
      <P>
        When something blocks, the form says “Deploy is turned off because N thing(s) on this container is/are in the
        way” and links to Open container status. Tick <B>Adopt an existing checkout</B> when the repository already
        runs on this container. The project is created with automatic deploys off, so the first deploy is manual.
        Nothing turns them on afterwards: when the first deploy works, open Settings, Build and Run and tick{" "}
        <B>Deploy automatically on push</B>.
      </P>

      <H3 id="container-terminal" />
      <P>
        The terminal is a live shell on your container in the browser, started in{" "}
        <C>~/.nest-deploy/&lt;project&gt;</C>. It is off until you turn it on for a server, and turning it on needs a
        Hack Club sign-in from the last 5 minutes. Anything you type runs for real.
      </P>
      {steps("container-terminal-steps", "Open a terminal", [
        { title: "Turn on Terminal", body: "In Account, under Container permissions, then confirm with Hack Club." },
        {
          title: "Open the project’s Terminal tab",
          body: "With the switch off the page says “The terminal is turned off for this server.” and links to Account.",
        },
        { title: "Press Open terminal", body: "It shows who the shell runs as, for example “This shell runs as root on <host>.”" },
        { title: "Type, then press Close", body: "A countdown shows the time left. Close ends the shell." },
      ])}
      <List>
        <li>It closes after 10 minutes without input. Output does not count as activity.</li>
        <li>It closes after 60 minutes in total, whatever you are doing.</li>
        <li>
          It closes when you sign out, when another of your sessions is ended, when you delete your account, when you
          switch the terminal off, and when the connection drops or the shell exits.
        </li>
        <li>Only the opening and closing are recorded, with the duration and the reason. Keystrokes and output never are.</li>
      </List>

      <H3 id="container-files" />
      <P>
        The project’s Files tab browses <C>~/.nest-deploy/&lt;project&gt;</C>. Reading and downloading need no switch.
        Creating, uploading, editing, renaming and deleting need File changes on, and work only inside{" "}
        <C>shared/</C>. The live release <C>current/</C> is always read only, as are <C>releases/</C> and{" "}
        <C>incoming/</C>. <C>shared</C> itself cannot be renamed or deleted.
      </P>
      {steps("container-files-steps", "Change a file", [
        { title: "Turn on File changes", body: "In Account, then confirm with Hack Club." },
        { title: "Open shared/", body: "Uploads and edits are refused anywhere else." },
        {
          title: "Act",
          body: "Use New folder or Upload, or select a file, edit it and save. Renaming and deleting are in the row. Deleting a folder asks you to type its name.",
        },
      ])}
      <P>
        Code changes belong in your repository, then a deploy. Files that must last, like data or settings, belong in{" "}
        <C>shared/</C>, which deploys never touch.
      </P>

      {limits("container-limits", [
        ["Terminal idle", "10 minutes", "“Terminal closed after a pause”. Anything running in it was stopped."],
        ["Terminal total", "60 minutes", "“Terminal reached its time limit”."],
        ["Terminals open", "1 per project per person, 50 on the server", "“A terminal is already open for this project. Resume or close it first.” or “Too many terminals are open right now. Try again soon.”"],
        ["Terminal input", "8 KB a request, 300 requests a minute", "“Too many requests for terminal input.” Wait and retry."],
        ["Terminal size", "20 to 400 columns, 5 to 200 rows", "“The terminal size must be 20 to 400 columns and 5 to 200 rows.”"],
        ["Terminal output kept", "The last 64 KB", "A reload resumes with that much."],
        ["File preview and edit", "The first 1 MB", "A larger file shows “Too large to preview”."],
        ["File upload and download", "50 MB", "“That file is over the 50 MB limit.”"],
        ["Folder listing", "3000 entries", "More are not shown."],
        ["File changes", "60 a minute", "“Too many requests for file changes.” Wait and retry."],
        ["Leftover removal", "50 items a request, 10 requests a minute", "“Remove at most 50 items at a time.”"],
        ["Container reads", "60 seconds a read, 120 seconds for a removal", "The read fails with the SSH message. Press Refresh."],
        ["Conflict checks", "20 a minute", "“Too many checks. Wait <n> second(s) and try again.”"],
      ])}

      {wrong("container-wrong", [
        ["The terminal is turned off for this server. Turn it on in Account, under Container permissions.", "Turn on Terminal in Account."],
        ["Changing files is turned off for this server. Turn it on in Account, under Container permissions.", "Turn on File changes. Reading still works without it."],
        ["Removing leftovers is turned off for this server. Turn it on in Account, under Container permissions.", "Turn on Removing leftovers. Leftovers stay listed while it is off."],
        ["This server has not been verified yet. Run Test connection on the Connect page first.", "The host key is not pinned yet. Press Test connection."],
        ["The terminal was closed before it opened.", "You signed out or switched the terminal off while it was connecting. Open it again."],
        ["This project has no folder on your container yet. Deploy it first.", "Deploy the project once, then open Files."],
        ["This location is read only. Files in shared/ can be changed. The live release (current/) cannot.", "Open shared/ and work there."],
        ["The upload arrived incomplete. Nothing was saved.", "Upload again."],
        ["Nest Deploy did not create this, so it was left alone.", "The leftover has no marker. If you are sure, remove it yourself in a terminal."],
        ["This belongs to one of your projects, so it was left alone.", "It is not a leftover. Delete the project first if you want it gone."],
        ["The container’s answer was cut short, so nothing was classified.", "Press Refresh."],
        ["Nothing was changed on your container. <details>", "The conflict check refused. The details say what is in the way: choose another name or port, or stop that program yourself."],
      ])}

      {example("container-example-leftover", {
        title: "Remove a leftover service",
        given: (
          <>
            You deleted a project named old-api with “Also stop the service” unticked, so <C>nd-old-api.service</C>{" "}
            still runs.
          </>
        ),
        steps: [
          { title: "Turn on Removing leftovers", path: ["Account", "Container permissions", "Removing leftovers"] },
          { title: "Find the row", body: "Open Container and look under Orphans for nd-old-api.service." },
          { title: "Remove it", body: "Press Remove, then confirm with Remove service." },
        ],
        result: (
          <>
            A message says the service was removed and the row leaves Orphans. Its folder, if any, is its own row and
            stays until you delete it by typing its name.
          </>
        ),
      })}
      {example("container-example-files", {
        title: "Keep an upload across deploys",
        given: "An app that reads uploads from a folder, and File changes switched on.",
        steps: [
          { title: "Open the Files tab", body: "Open shared/ in the project." },
          { title: "Make a folder and upload", body: "Press New folder, name it, then press Upload." },
        ],
        result: (
          <>
            The files are still there after the next deploy, because <C>shared/</C> is never touched by a release.
          </>
        ),
      })}
      {related([
        ["account", "Account"],
        ["security", "Security"],
        ["api", "Access tokens and the API"],
      ])}
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  limits: () => (
    <Section
      id="limits"
      intro="Every number Nest Deploy enforces, grouped by what it limits. Each one comes from the code that applies it."
    >
      <H3 id="limits-deploys" />
      <Table
        caption="Projects and deploys"
        head={["What", "Limit"]}
        rows={[
          ["Servers per account", "5."],
          ["Project name", "1 to 60 characters. The slug uses lowercase letters, digits and hyphens, 1 to 40 characters."],
          ["Port", "1024 to 65535, and not 20000 to 29999, which previews use."],
          ["Commands", "500 characters each, on one line."],
          ["Root directory", "200 characters, relative, no .."],
          ["Deployments at once", "One per project. Two at a time overall by default."],
          ["Clone", "5 minutes."],
          ["Build", "15 minutes by default (900 seconds)."],
          ["Build output", "500 MB."],
          ["Health wait", "45 seconds after the switch. A failed production deploy puts the previous release back."],
          ["Production releases kept", "The 5 newest ready ones, plus the live one."],
          ["Previews kept", "The 2 newest."],
          ["Preview ports", "20000 to 29999, one per preview."],
          ["Environment variables", "100 per project, names up to 100 characters, values up to 10,000."],
        ]}
      />
      <H3 id="limits-container" />
      <Table
        caption="Container features"
        head={["What", "Limit"]}
        rows={[
          ["Terminal", "Closes after 10 minutes without input or 60 minutes in total. One per project per person, 50 on the server."],
          ["Terminal input", "8 KB a request, 300 requests a minute."],
          ["File preview and edit", "The first 1 MB."],
          ["File upload and download", "50 MB."],
          ["Folder listing", "3000 entries."],
          ["File changes", "60 a minute."],
          ["Leftover removal", "50 items a request, 10 requests a minute."],
          ["Conflict checks", "20 a minute."],
          ["Bulk cancel or delete of previews", "50 per request."],
        ]}
      />
      <H3 id="limits-api" />
      <Table
        caption="Access tokens and the API"
        head={["What", "Limit"]}
        rows={[
          ["Active tokens", "25 per account. Revoked and expired ones do not count."],
          ["Token life", "7, 30, 90 or 365 days. 90 is the default."],
          ["Terminal or file changes", "A token holding either lives 7 days at most."],
          ["Reads", "120 a minute per token."],
          ["Changes", "30 a minute per token."],
          ["Calls that open a session to your container", "10 a minute per token."],
          ["Terminal input through the API", "300 a minute per token."],
          ["Request body", "16 KB. A file write takes 4 MB and the MCP endpoint 64 KB."],
          ["File write through the API", "1 MB. A download is 2 MB."],
        ]}
      />
      <H3 id="limits-watch" />
      <Table
        caption="Watching and history"
        head={["What", "Limit"]}
        rows={[
          ["Uptime checks", "Every 5 minutes by default. Down after 2 failed checks in a row, which you can set from 1 to 10 per project."],
          ["Resource history", "Sampled every 5 minutes, kept 7 days, shown for 24 hours or 7 days."],
          ["Runtime logs", "Up to 300 lines shown. A search or the Warnings and errors level reads the newest 1000 first."],
          ["Alert history", "The newest 50 shown, kept 90 days."],
          ["Analytics history", "90 days."],
          ["Status page", "30 days and the latest 10 outages."],
          ["Deployments page", "The newest 100, shown 25 at a time."],
          ["Activity", "50 a page. A search reads the newest 5000."],
        ]}
      />
      <H3 id="limits-account" />
      <Table
        caption="Sign-in"
        head={["What", "Limit"]}
        rows={[
          ["Session", "30 days."],
          ["Fresh sign-in", "5 minutes."],
          ["Sign-in handshake", "10 minutes."],
        ]}
      />
      <Callout tone="note" title="Your container’s size">
        How much CPU, memory and disk your Nest container has is set by Nest, not by Nest Deploy. Test connection and
        the Container page show what it has.
      </Callout>
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  selfhost: () => (
    <Section
      id="selfhost"
      intro="Nest Deploy is open source. You can run your own copy, with your own database, secret and worker."
    >
      <P>
        You need Node.js, pnpm and, for real builds, Docker. This page lists what the code reads. The{" "}
        <ExternalLink href={setupDoc}>backend setup guide</ExternalLink> has the Hack Club and GitHub registration
        steps in full.
      </P>
      <H3 id="selfhost-start" />
      {steps("selfhost-start-steps", "Start it locally", [
        {
          title: "Install and set up",
          body: (
            <>
              From the <C>web</C> folder, <C>pnpm setup</C> writes <C>.env.local</C> with a fresh <C>APP_SECRET</C>.
              It never overwrites an existing file.
            </>
          ),
          code: { label: "Terminal", code: "cd web\npnpm install\npnpm setup" },
        },
        {
          title: "Start it",
          body: (
            <>
              Setup turns on <C>RUN_WORKER=1</C>, so the queue runs in the same process. Open{" "}
              <C>http://localhost:3000</C> and use the Development sign-in form.
            </>
          ),
          code: { label: "Terminal", code: "pnpm dev" },
        },
        {
          title: "Try deploys without a Nest account",
          body: (
            <>
              Run <C>pnpm fake-nest</C> in a second terminal and set the three values it prints:{" "}
              <C>NEST_HOST</C>, <C>NEST_PORT</C> and <C>UNIT_DIR</C>. It is for development only.
            </>
          ),
        },
      ])}

      <H3 id="selfhost-config" />
      <Table
        caption="Settings the code reads"
        head={["Setting", "What it does"]}
        rows={[
          [<C key="1">APP_SECRET</C>, "Required, 32 or more characters. Seals SSH keys and variables. Back it up: losing or changing it makes stored keys unreadable."],
          [<C key="2">APP_URL</C>, "The public address. Used for sign-in redirects, hook URLs and links. Default http://localhost:3000."],
          [<C key="3">DATABASE_URL</C>, "The SQLite file. Default file:./data/nest-deploy.db. Migrations apply on startup."],
          [<C key="4">HACKCLUB_CLIENT_ID, HACKCLUB_CLIENT_SECRET</C>, "From a Hack Club Auth app. Without them the login button is off."],
          [<C key="5">DEV_LOGIN</C>, "1 shows a fake sign-in. It is ignored in a production build."],
          [<C key="6">GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET</C>, "All six are needed for private repositories, the repository picker and deploys on push. The private key may use \\n escapes."],
          [<C key="7">RUN_WORKER</C>, "1 runs the queue inside the web process. Anything else means no builds run there. Use pnpm worker."],
          [<C key="8">WORKER_CONCURRENCY</C>, "Deployments at once. Default 2. One project never builds twice at a time."],
          [<C key="9">BUILD_RUNNER</C>, "docker (default) isolates builds. local runs them on the host with no isolation and prints a warning."],
          [<C key="10">BUILD_IMAGE_NODE, BUILD_IMAGE_PYTHON</C>, "Sandbox images. Defaults node:22-bookworm and python:3.12-bookworm."],
          [<C key="11">BUILD_TIMEOUT_SECONDS</C>, "How long a build may run. Default 900."],
          [<C key="12">DEPLOY_WORK_DIR</C>, "Where builds are cloned. Default ./data/work."],
          [<C key="13">MONITOR_INTERVAL_MS</C>, "How often uptime and usage are checked. Default 300000. 0 turns the checks off."],
          [<C key="14">NEST_HOST, NEST_PORT, UNIT_DIR</C>, "Nest’s SSH host (hackclub.app, 22) and where systemd units are written (/etc/systemd/system). Change only for testing."],
        ]}
      />

      <H3 id="selfhost-worker" />
      <P>
        The worker takes queued deployments and runs the uptime monitor. It polls every second and never runs two jobs
        of one project at once. With <C>RUN_WORKER=1</C> it lives inside the web process. For production you can set{" "}
        <C>RUN_WORKER=0</C> and run <C>pnpm worker</C> on another machine. It finishes running jobs when it gets
        SIGINT or SIGTERM. Builds run on the machine the worker runs on, so give it Docker and keep nothing private
        reachable from it, because builds have normal network access. A job that has been running for an hour is
        presumed dead and failed.
      </P>
      <Callout tone="warning" title="Without a worker, nothing builds">
        If <C>RUN_WORKER</C> is not <C>1</C> and no <C>pnpm worker</C> is running, deployments stay queued, and uptime
        checks and resource history do not run.
      </Callout>

      <H3 id="selfhost-database" />
      <P>
        The database is one SQLite file at <C>DATABASE_URL</C>. Users, servers, projects, deployments, logs, jobs and
        history are all in it. Back up the file together with <C>APP_SECRET</C>: the file alone cannot open your sealed
        keys, and the secret alone has nothing to open. Foreign keys are on, so disconnecting a server deletes its
        projects.
      </P>

      <H3 id="selfhost-apps" />
      <List>
        <li>
          <B>Hack Club Auth.</B> Make an app at <C>auth.hackclub.com/developer/apps</C> with the redirect URI{" "}
          <C>&lt;APP_URL&gt;/api/auth/callback</C>.
        </li>
        <li>
          <B>GitHub App.</B> Callback and setup URL <C>&lt;APP_URL&gt;/api/github/callback</C> with “Request user
          authorization (OAuth) during installation” on, webhook URL <C>&lt;APP_URL&gt;/api/webhooks/github</C>,
          repository permissions Contents and Metadata read only, Pull requests read and write, and the Push and Pull
          request events.
        </li>
      </List>

      {limits("selfhost-limits", [
        ["Concurrent deployments", "2 by default", "Set WORKER_CONCURRENCY to change it."],
        ["Build time", "900 seconds by default", "“The build timed out.”"],
        ["Build memory and CPU", "2 GB and 2 CPUs", "The build is stopped by Docker."],
        ["Uptime check", "Every 300000 ms by default", "Set MONITOR_INTERVAL_MS to 0 to stop checks."],
      ])}

      {wrong("selfhost-wrong", [
        ["Invalid environment configuration", "The first request or the worker start checks every setting, and the lines under it name the one that is wrong. Fix it, or run pnpm setup."],
        ["APP_SECRET must be at least 32 characters", "Use a longer secret. pnpm setup makes one."],
        ["The GitHub App is not configured.", "Set all six GITHUB_APP settings and GITHUB_WEBHOOK_SECRET."],
        ["webhook not configured", "The webhook route answers 503 until GITHUB_WEBHOOK_SECRET is set."],
        ["Hack Club sign-in is not set up on this installation yet.", "Set HACKCLUB_CLIENT_ID and HACKCLUB_CLIENT_SECRET."],
      ])}

      {example("selfhost-example", {
        title: "Move to a new machine",
        given: "A copy running on one machine with a database file and an .env.local.",
        steps: [
          { title: "Stop it", body: "Stop the web process and any worker." },
          { title: "Copy two things", body: "Copy the database file and the APP_SECRET value to the new machine." },
          { title: "Set and start", body: "Set DATABASE_URL and APP_SECRET, then start it." },
        ],
        result:
          "Your servers and variables open as before. With a different APP_SECRET, stored keys cannot be read and you would have to make new keys.",
      })}
      {related([
        ["security", "Security"],
        ["limits", "Limits"],
      ])}
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  troubleshooting: () => (
    <Section
      id="troubleshooting"
      intro="One entry per message Nest Deploy shows, with the fix. Find the heading for what you were doing."
    >
      {wrong(
        "troubleshooting-connection",
        [
          ["Nest rejected the key. Check that you pasted the public key on the SSH Keys page of the Nest dashboard, and that the username is exactly your Nest username.", "Paste the public key again, exactly as shown. After New key, the old one is dead. Check the username."],
          ["Timed out connecting to Nest. Your container may be stopped or starting; try again in a minute.", "Wait a minute and press Test connection again."],
          ["Could not reach the Nest SSH host (<reason>).", "The reason is the network error. Try again later."],
          ["The host key of <host> changed (was <old>, now <new>). Nothing was sent. If you expected this, reconnect the server.", "This stops on purpose. Disconnect and add the server again, knowing Disconnect deletes the server’s projects here."],
          ["SSH error: <message>", "Anything else. Read the message, then try again."],
          ["That does not look like a Nest username. Use the name you log in with, for example sam-r.", "Use letters, digits, dot, underscore and hyphen, starting with a letter or digit, up to 32 characters."],
          ["<name> is already connected.", "One server per Nest username. Use the one you have."],
          ["You can connect up to 5 servers.", "Disconnect one you no longer use."],
        ],
        subsectionTitle("troubleshooting-connection")
      )}
      <P>
        After a successful test, the list of issues may show warnings such as “curl is missing. Health checks fall
        back to a plain TCP connection check.” They are shown for your information and do not block a deploy.
      </P>

      {wrong(
        "troubleshooting-build",
        [
          ["Could not clone the repository. Check the branch name and that Nest Deploy has access to it.", "Check the production branch in Settings and, for a private repository, that the GitHub app is installed on it."],
          ["The root directory \"<dir>\" does not exist in this repository.", "Fix Root directory in Settings, Build and Run."],
          ["The build failed (exit <code>).", "Read the log above it. The usual causes are a missing lockfile or build script, the wrong root directory, or a command that needs a variable you have not set."],
          ["The build timed out.", "A build may run 15 minutes by default. Make it faster."],
          ["The output folder \"<dir>\" was not created by the build.", "Set Output directory to the folder your build really writes."],
          ["The build output is <n> MB, over the 500 MB limit.", "Leave out what the app does not need to run."],
          ["Set a start command for this project (for example ./my-binary).", "A Custom command project needs a Start command."],
          ["Static sites need Python 3 or Node.js on your Nest container to be served.", "Install one of them on the container."],
          ["The worker stopped while this deployment was running. Try again.", "Press Redeploy. The worker restarted during the build."],
          ["No free preview ports on this server.", "All of 20000 to 29999 are in use. Delete old previews."],
        ],
        subsectionTitle("troubleshooting-build")
      )}

      {wrong(
        "troubleshooting-no-answer",
        [
          ["The new release did not become healthy on port <port>. Make sure your app listens on the PORT environment variable and on 0.0.0.0.", "Listen on PORT and on 0.0.0.0, not only localhost. The log shows the last 30 lines of the app’s output, and the previous release is put back."],
          ["Service crashed on start", "The service failed before the wait ended. Read the output printed under it."],
          ["The previous release did not come back either. Check the logs.", "Open Logs and read the runtime lines, then redeploy or use Instant rollback to an earlier release."],
        ],
        subsectionTitle("troubleshooting-no-answer")
      )}
      <P>
        A health path that answers with anything from 200 to 499 counts as healthy, so a 404 passes. Only 500 and above
        fails.
      </P>

      <H3 id="troubleshooting-adopt" />
      {wrong(
        "troubleshooting-adopt-list",
        [
          ["Nothing was changed on your container. <details>", "The conflict check refused. The details say what is in the way. Choose another name or port, or stop that program yourself first."],
          ["A service called nd-<slug>.service already exists and Nest Deploy did not create it. It will not be replaced. Choose another project name.", "Rename the project."],
          ["Port <n> is already in use by <process>. Nest Deploy will not stop it. Choose another port, or stop that program yourself first.", "Pick another port, or stop that program."],
          ["<path> already exists and was not created by Nest Deploy, so it was left alone.", "Pick another name, or move that folder yourself."],
          ["Could not check this container just now: <reason>. The deploy checks again before it changes anything.", "Try again in a moment."],
        ],
        "The conflict check",
        3
      )}

      <H3 id="troubleshooting-project" />
      {wrong(
        "troubleshooting-project-list",
        [
          ["You already have a project called \"<slug>\".", "Pick another name."],
          ["Port <n> is already used by another project on this server.", "Pick another port. In Settings the same refusal reads “Port <n> is already used on this server.”"],
          ["Ports 20000 to 29999 are reserved for previews", "Choose a port from 1024 to 19999 or 30000 to 65535."],
          ["Use lowercase letters, numbers and hyphens.", "Fix the name. The slug is at most 40 characters."],
          ["Only plain https repository URLs are supported.", "Use an https URL. Only github.com is supported."],
          ["The project was created, but <NAME> was not saved: <reason>. Press Deploy to try again.", "The project exists. Fix the variable in Settings and deploy."],
          ["Could not remove the project from your container.", "Your records are kept so you can try again."],
        ],
        "Project messages",
        3
      )}
      <P>
        A project made from a pasted public URL does not deploy on push. It builds from Deploy, a deploy hook or the
        API. Import it through the GitHub app for push deploys.
      </P>

      <H3 id="troubleshooting-rollback" />
      {wrong(
        "troubleshooting-rollback-list",
        [
          ["That release was removed from your server to save space.", "Only 5 production releases are kept. Deploy the commit again."],
          ["That deployment is already live.", "Pick an earlier one."],
          ["Only production deployments can be rolled back to.", "Choose a production deployment."],
          ["That deployment never finished, so there is nothing to roll back to.", "Choose one that was Ready."],
          ["The older release did not become healthy, so nothing was changed.", "The release that was live is still live. Check the older release’s logs."],
          ["That deployment is already finished.", "Cancel works only while a deployment is Queued, Building or Deploying."],
        ],
        "Rollback and cancel messages",
        3
      )}

      <H3 id="troubleshooting-env" />
      {wrong(
        "troubleshooting-env-list",
        [
          ["Names use letters, digits and underscores, and do not start with a digit", "Rename the variable."],
          ["That name is set by Nest Deploy", "PORT, HOST, PATH, HOME and NEST_DEPLOY are reserved."],
          ["A project can have up to 100 variables.", "Delete one you do not need."],
          ["No example env file (such as .env.example) was found in the repository.", "Add .env.example, or type the names by hand."],
        ],
        "Variable messages",
        3
      )}
      <P>A saved change reaches your app at the next deployment. Redeploy to apply it.</P>

      {wrong(
        "troubleshooting-domain",
        [
          ["No CNAME found yet. Create one pointing to <target>. DNS changes can take a few minutes.", "Add the CNAME at your DNS provider, wait, and press Check."],
          ["The CNAME points to <x>. It should point to <target>.", "Change the CNAME value."],
          ["The name does not resolve yet. Add it in the Nest dashboard first.", "Add the domain and port on the Domains page of the Nest dashboard."],
          ["DNS could not be checked right now. Try again in a minute.", "Press Check again."],
          ["<domain> is already added.", "A domain can be added once across all accounts."],
          ["Certificate not verified yet", "The app check found no trusted certificate. Wait for Nest to issue one, then press Check again."],
        ],
        subsectionTitle("troubleshooting-domain")
      )}

      {wrong(
        "troubleshooting-hook-409",
        [
          ["A deployment is already running for this project.", "The hook answers 409 while any deployment of the project is queued, building or deploying. Try again when it finishes."],
          ["Unknown hook", "The URL is wrong or was replaced. Make a new URL."],
          ["Request body must be JSON", "Send valid JSON, or no body. The only field is branch."],
        ],
        subsectionTitle("troubleshooting-hook-409")
      )}

      <H3 id="troubleshooting-pr-comment" />
      <P>
        The pull request must come from the same repository, must not be a draft, and its branch must not be your
        production branch. The GitHub app needs Pull requests read and write and the Pull request event. When a
        comment fails the deploy is unaffected and nothing is shown to you. A pull request from a fork is never built.
      </P>

      {wrong(
        "troubleshooting-alerts",
        [
          ["Add a webhook URL first.", "Save a Discord or Slack webhook URL in Notifications."],
          ["Use the plain https webhook URL from Discord or Slack.", "Remove ports, queries and credentials."],
          ["Only Discord and Slack incoming webhook URLs are supported.", "Use a discord.com, discordapp.com or hooks.slack.com URL."],
          ["Discord answered <status>.", "Slack gives the same message with its own name. The webhook was deleted or the URL is wrong. Make a new one."],
        ],
        subsectionTitle("troubleshooting-alerts")
      )}
      <P>
        If the test arrives but alerts do not, check three things. An app is reported down only after 2 failed checks
        in a row by default. Alerts may be paused for the project. And the channel you want may be switched off.
      </P>

      <H3 id="troubleshooting-container" />
      <P>
        These refusals are on the <InternalLink href={docsHref("container")}>container</InternalLink> page: the
        terminal, files and leftovers switches, and the messages they give.
      </P>

      {wrong(
        "troubleshooting-token",
        [
          ["Send an access token as an Authorization: Bearer ndp_... header.", "401. Add the header."],
          ["That access token is not valid.", "401. Missing, revoked, expired and unknown tokens all look the same. Make a new one."],
          ["This token does not have the <scope> permission.", "403. Edit the token on the Developer page and tick it."],
          ["No such item, or it belongs to someone else.", "404. Check the id."],
          ["Too many requests for this token. Wait <n> second(s) and try again.", "429. Wait for the number of seconds in the Retry-After header."],
          ["The request body is too large.", "413. The limit is 16 KB for most calls, 4 MB for a file write and 64 KB for MCP."],
          ["A token with the terminal or file change permission expires in 7 days at most. Pick 7 days, or remove that permission.", "Pick 7 days."],
          ["You can have up to 25 active tokens. Revoke one first.", "Revoke a token you no longer use."],
        ],
        subsectionTitle("troubleshooting-token")
      )}

      <H3 id="troubleshooting-signin" />
      <P>
        The sign-in messages and their fixes are on the <InternalLink href={docsHref("account")}>account</InternalLink>{" "}
        page.
      </P>
      <Callout tone="note" title="Still stuck?">
        Look at <InternalLink href="/projects">your dashboard</InternalLink> or open an issue on{" "}
        <ExternalLink href={REPO_URL}>GitHub</ExternalLink>.
      </Callout>
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  api: () => (
    <Section
      id="api"
      intro="Access tokens let a script or an AI agent act for you, with only the permissions you pick."
    >
      <P>
        You make tokens on the Developer page. A token is a bearer secret that starts with <C>ndp_</C>. Everything
        here is also in the OpenAPI description.
      </P>
      <H3 id="api-tokens" />
      {steps("api-tokens-steps", "Make a token", [
        { title: "Open Developer", body: "Press Create token to open the New token dialog.", path: ["Developer", "Access tokens", "Create token"] },
        { title: "Name it", body: "A name is 1 to 60 characters. Pick one you will recognise later." },
        { title: "Tick Permissions", body: "Read only ticks every read permission. Deploy ticks what a deploy script needs." },
        { title: "Choose Expires after", body: "7, 30, 90 or 365 days. 90 is the default." },
        { title: "Copy the secret", body: "It is shown once: “Copy it now. It will not be shown again.”" },
      ])}
      <P>
        Each active token has Edit and Revoke. Edit changes the name, the permissions and the expiry, counted from
        now. A revoked token is final. Dropping the deploy permission warns that deploys will stop working for
        anything that uses the token.
      </P>

      <H3 id="api-scopes" />
      <Table
        caption="Token permissions"
        head={["Permission", "What it allows"]}
        rows={[
          [<C key="1">projects:read</C>, "Read projects, their settings and status page."],
          [<C key="2">projects:write</C>, "Create, change and delete projects, including build and start commands."],
          [<C key="3">deployments:read</C>, "Read deployments and build output."],
          [<C key="4">deployments:write</C>, "Deploy, redeploy, cancel and roll back, and replace or revoke the deploy hook."],
          [<C key="5">logs:read</C>, "Read runtime logs."],
          [<C key="6">env:read</C>, "List variable names. Never their values."],
          [<C key="7">env:write</C>, "Set and remove variables."],
          [<C key="8">domains:read</C>, "Read domains."],
          [<C key="9">domains:write</C>, "Add, check and remove domains."],
          [<C key="10">notifications:read</C>, "Read notification settings and send a test message."],
          [<C key="11">alerts:read</C>, "Read alert settings and history."],
          [<C key="12">analytics:read</C>, "Read visitor analytics."],
          [<C key="13">activity:read</C>, "Read your activity log."],
          [<C key="14">resources:read</C>, "Read CPU, memory and disk, now and over time."],
          [<C key="15">container:read</C>, "List servers and see what is on the container. Read only."],
          [<C key="16">files:read</C>, "List and read files in a project’s folder."],
          [<C key="17">files:write</C>, "Create, change, rename and delete files in a project’s shared/ folder."],
          [<C key="18">terminal:use</C>, "Open and use a shell on the container."],
        ]}
      />
      <P>
        Only projects, deployments, environment variables and domains have a write permission. Notifications, alerts,
        analytics, resources, activity, the container and logs are read only, and no permission changes notification
        or alert settings. Those stay in the browser.
      </P>

      <H3 id="api-limits" />
      <P>
        Terminal and file changes are off until you switch them on for a server, and switching them on asks you to
        sign in with Hack Club again. A token can use them only while that switch is on. A token that holds{" "}
        <C>terminal:use</C> or <C>files:write</C> expires within 7 days, whatever length you picked, and the form shows
        that as you tick it. If you send no expiry, it gets 7 days.
      </P>
      <P>
        Some things stay with you in the browser. A token cannot remove leftovers, change the container permissions,
        manage your account or sessions, or create other tokens.
      </P>

      <H3 id="api-mcp" />
      <P>
        The API is under <C>/api/v1</C> and takes the token as a bearer header. The description of every call is at{" "}
        <C>/api/v1/openapi.json</C>. Start with <C>/api/v1/me</C>. It needs no permission, so any valid token can call
        it. It returns the token’s name, permissions and expiry and how many servers and projects there are, and never
        an email address.
      </P>
      <P>
        AI agents connect to <C>/api/mcp</C> instead. It speaks JSON-RPC 2.0 with one message per request, no
        sessions and no batches, and it offers the same calls as tools, with the same permissions and limits. An
        agent should call the <C>get_me</C> tool first. A tool error comes back as a result with <C>isError</C> set.
      </P>
      <P>
        Deploys, redeploys, rollbacks, cancels and file or terminal actions made with a token are recorded in{" "}
        <InternalLink href={docsHref("activity")}>Activity</InternalLink> with the token’s name.
      </P>

      <H3 id="api-examples" />
      <P>
        Ready-made starting points live in the repository. Each says which permissions it needs. Every example uses a
        placeholder like <C>{TOKEN_PLACEHOLDER}</C>, so keep your real token in an environment variable or a secret
        store. The TypeScript client is one file with no dependencies: copy it into your project and call its typed
        methods.
      </P>
      <List>
        {BUILD_RESOURCES.map((r) => (
          <li key={r.id}>
            <ExternalLink href={repoLink(r.path)}>{r.title}</ExternalLink>. {r.summary} {scopeNeeds(r)}
          </li>
        ))}
      </List>

      <H3 id="api-addresses" />
      <Table
        caption="Addresses"
        head={["For", "Address"]}
        rows={[
          ["API calls", <C key="1">https://your-nest-deploy/api/v1</C>],
          ["Client generators and API tools", <C key="2">https://your-nest-deploy/api/v1/openapi.json</C>],
          ["AI agents", <C key="3">https://your-nest-deploy/api/mcp</C>],
        ]}
      />
      <P>
        Replace <C>your-nest-deploy</C> with the address of your Nest Deploy. All three take the same token in an{" "}
        <C>Authorization: Bearer</C> header, and none of them reads cookies.
      </P>

      {limits("api-rates", [
        ["Reads", "120 a minute per token", "429 with a Retry-After header."],
        ["Changes", "30 a minute", "429."],
        ["Calls that open a session to your container (build logs, resource history, the inventory, files)", "10 a minute", "429."],
        ["Terminal input", "300 a minute", "429."],
        ["Request body", "16 KB (4 MB for a file write, 64 KB for MCP)", "413 “The request body is too large.”"],
        ["File write and download", "1 MB and 2 MB", "413 “The API writes files of up to 1 MB. Upload larger files in the dashboard.”"],
      ])}

      {wrong("api-wrong", [
        ["Send an access token as an Authorization: Bearer ndp_... header.", "401. Add the header."],
        ["That access token is not valid.", "401. A missing, revoked, expired or unknown token looks the same. Make a new one."],
        ["This token does not have the <scope> permission.", "403. Edit the token on the Developer page and tick the permission."],
        ["That file holds the project's environment variable values, which are never returned by the API.", "403. The API never reads .env files. Use env:read for names."],
        ["Too many requests for this token. Wait <n> second(s) and try again.", "429. Wait for the Retry-After seconds."],
        ["Unknown field \"<name>\". Allowed: ...", "400. Remove the field. Unknown body fields are refused."],
        ["Unknown tool: <name>", "The MCP endpoint does not have that tool. Call tools/list."],
      ])}

      {example("api-example", {
        title: "List your projects with curl",
        given: "A token with projects:read, kept in an environment variable.",
        steps: [
          {
            title: "Call the projects endpoint",
            code: {
              label: "Terminal",
              code: `export NEST_TOKEN=ndp_...\ncurl -H "Authorization: Bearer $NEST_TOKEN" https://your-nest-deploy/api/v1/projects`,
            },
          },
        ],
        result: "A JSON list of your projects. A token without the permission gets 403 naming it.",
      })}
      {related([
        ["security", "Security"],
        ["limits", "Limits"],
        ["container", "Container, terminal and files"],
      ])}
    </Section>
  ),
};
