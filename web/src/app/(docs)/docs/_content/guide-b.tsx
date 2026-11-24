import type { ReactNode } from "react";
import { BUILD_RESOURCES, repoLink, scopeNeeds, TOKEN_PLACEHOLDER } from "@/lib/developer";
import { REPO_URL } from "@/lib/site";
import { B, C, Callout, ExternalLink, H2, H3, InternalLink, List, P, Section, Table } from "../_components/prose";
import {
  Limits,
  Steps,
  WhatCanGoWrong,
  WorkedExample,
  type LimitItem,
  type ProblemItem,
  type StepItem,
} from "../_components/worked-example";
import { CodeBlock } from "../_components/code-block";
import { docsHref, subsectionTitle } from "../_data/nav";

const setupDoc = `${REPO_URL}/blob/main/docs/backend-setup.md`;

// Small adapters so each page below reads as data. Every block takes a heading
// id that is unique on its page. Topic sections are `<H2 id />` (an h2 from
// `_data/nav.ts`) or `<H2 id title />` for a section the nav does not list;
// steps sit one level down (h3); the limits, the failures and the worked
// example close the page as h2 sections.

type Step = { title: string; body?: ReactNode; code?: StepItem["code"]; path?: string[] };
const toStep = (s: Step): StepItem => ({ title: s.title, children: s.body, code: s.code, path: s.path });

/** Numbered steps under a heading. `level` 3 when they sit inside a topic. */
const steps = (id: string, title: string, items: Step[], level: 2 | 3 = 3) => (
  <Steps id={id} title={title} items={items.map(toStep)} level={level} />
);

/** Limits as name, value and what happens at it. The optional last item is the file that sets the number. */
const limits = (id: string, rows: [string, string, ReactNode, string?][], level: 2 | 3 = 2) => {
  const items: LimitItem[] = rows.map(([name, value, atLimit, source]) => ({
    name,
    source,
    value,
    atLimit,
  }));
  return (
    <Limits id={id} items={items} level={level}>
      These numbers are read from the code that enforces them. Under each message is the file that holds the number,
      relative to the web/src folder.
    </Limits>
  );
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

/** A short rationale for a choice that is not obvious. */
const why = (children: ReactNode) => (
  <Callout tone="note" title="Why it works this way">
    {children}
  </Callout>
);

/** A stand-alone code block under a paragraph. */
const code = (label: string, text: string) => <CodeBlock label={label} code={text} />;

/* -------------------------------------------------------------------- */
/* Messages shared by more than one page. Each string is what the code   */
/* sends, word for word.                                                 */
/* -------------------------------------------------------------------- */

const SWITCH_OFF: [string, ReactNode][] = [
  [
    "The terminal is turned off for this server. Turn it on in Account, under Container permissions.",
    "403. Turn on Terminal in Account. Nothing else is needed to read files or the Container page.",
  ],
  [
    "Changing files is turned off for this server. Turn it on in Account, under Container permissions.",
    "403. Turn on File changes. Reading and downloading still work without it.",
  ],
  [
    "Removing leftovers is turned off for this server. Turn it on in Account, under Container permissions.",
    "403. Turn on Removing leftovers. Leftovers stay listed while it is off.",
  ],
  [
    "Confirm with Hack Club first. Turning this on needs a sign-in in the last 5 minutes.",
    "403. Flip the switch again. It sends you through Hack Club and back to Account, where the switch is applied.",
  ],
];

const TERMINAL_PROBLEMS: [string, ReactNode][] = [
  [
    "This server has not been verified yet. Run Test connection on the Connect page first.",
    "409. The host key is not pinned yet, and a terminal never opens to a host Egg has not checked. Press Test connection.",
  ],
  [
    "A terminal is already open for this project. Resume or close it first.",
    "409. Only one terminal per project and person. Press Resume terminal, or Close it, then open a new one.",
  ],
  [
    "You can have 5 terminals open at once. Close one first.",
    "429. One account may hold 5 terminals across all its projects, so one account cannot use up the server’s share. Close one you are not using.",
  ],
  [
    "Too many terminals are open right now. Try again soon.",
    "503. The server as a whole holds 50 terminals. Wait a little and open yours again.",
  ],
  [
    "The terminal was closed before it opened.",
    "403. You signed out, or switched Terminal off, while it was still connecting. Open it again.",
  ],
  [
    "Could not open a terminal: <reason>",
    "502. Egg could not reach your container. The reason is the SSH error. Check the container is running, then try again.",
  ],
  [
    "Could not open a terminal on your container.",
    "502. The same, with no detail from the connection. Try again in a minute.",
  ],
  [
    "The terminal size must be 20 to 400 columns and 5 to 200 rows.",
    "400. Only scripts and the API see this: the page sends a size that fits.",
  ],
  [
    "Send at most 8192 bytes at a time.",
    "413. One input request carries at most 8 KB. Split the text.",
  ],
  [
    "That is too much input at once.",
    "413. The whole request was over 64 KB, which is room for 8 KB of text after JSON escaping.",
  ],
  [
    "Too many requests for terminal input. Wait <n> second(s) and try again.",
    "429. 300 input requests a minute for your account. Wait for the seconds in Retry-After.",
  ],
  [
    "Terminal session not found",
    "404. The session ended, or the id is wrong, or it belongs to someone else. Open a new one.",
  ],
];

const FILE_PROBLEMS: [string, ReactNode][] = [
  [
    "This project has no folder on your container yet. Deploy it first.",
    "404. The folder is created by the first deploy. Deploy once, then open Files.",
  ],
  [
    "This location is read only. Files in shared/ can be changed. The live release (current/) cannot.",
    "403. Open shared/ and work there. The page shows the same rule as “current/ is the live release and is read only.”",
  ],
  [
    "current/ is the live release and is read only. Changing it would change the code your app runs. Make the change in your repository and deploy, or use shared/ for files that last.",
    "403. Change the code in your repository and deploy. Put files that must last in shared/.",
  ],
  [
    "This file holds the project's environment variable values, so it is not shown here. Change the values in the project's settings.",
    "403. The Files tab never opens a variables file. Change the values in the project’s settings, then deploy.",
  ],
  [
    "That file holds the project's environment variable values, which are never returned by the API.",
    "403. The API refuses those files too. Use env:read to list names.",
  ],
  ["Nothing exists at that path.", "404. Check the spelling, or refresh the folder."],
  ["That path is not a folder.", "409. You asked to list a file. Open its folder instead."],
  ["That path is not a file.", "409. You asked to read or download a folder."],
  ["That path is a folder.", "409. You tried to write over a folder. Pick a file name."],
  [
    "That path is a symbolic link. Files are not written through links.",
    "409. A link could lead outside shared/, so it is never written through. Write to the real path.",
  ],
  [
    "Something with that name already exists.",
    "409. Pick another name. An upload to an existing file asks whether to replace it.",
  ],
  ["That path leaves the project folder.", "403. A path must stay inside the project’s folder, links included."],
  [
    "That file is over the 50 MB limit.",
    "413. Uploads and downloads stop at 50 MB. Put larger files on the container by SSH.",
  ],
  [
    "The upload arrived incomplete. Nothing was saved.",
    "The connection broke part way. Upload again.",
  ],
  [
    "Too many file requests. Wait <n> second(s) and try again.",
    "429. Listing, reading and downloading are 120 a minute for your account.",
  ],
  [
    "Too many requests for file changes. Wait <n> second(s) and try again.",
    "429. Creating, writing, renaming and deleting are 60 a minute for your account.",
  ],
  ["Enter a name.", "A new name cannot be empty."],
  ["A name cannot contain a slash.", "A rename or new folder takes one name. Open the folder first."],
  ["That name is not allowed.", "“.” and “..” are not names."],
  ["That is the same path.", "A rename must change the name."],
  ["A folder cannot move into itself.", "Pick a destination outside the folder you are moving."],
  [
    "This container's tools are too limited to list files.",
    "502. The container lacks tools Egg uses to list a folder. Test connection lists what is missing.",
  ],
  [
    "Your container could not finish that. Try again.",
    "502. The container failed part way. Try again, and check Container for disk space.",
  ],
];

const TOKEN_PROBLEMS: [string, ReactNode][] = [
  [
    "Send an access token as an Authorization: Bearer egg_... header.",
    "401. Add the header. A cookie is never accepted here.",
  ],
  [
    "That access token is not valid.",
    "401. Missing, revoked, expired and unknown tokens all look the same on purpose. Make a new one on the Developer page.",
  ],
  [
    "This token does not have the <scope> permission.",
    "403. The message names it. Press Edit on the token on the Developer page and tick it. The change applies to the next request.",
  ],
  [
    "Too many requests for unrecognised access tokens. Wait <n> second(s) and try again.",
    "429. 60 tokens that did not check out from one address in a minute. Fix the token your script sends.",
  ],
  [
    "Too many requests for this token. Wait <n> second(s) and try again.",
    "429. Wait for the seconds in the Retry-After header. Reads are 120 a minute, changes 30, container sessions 10, terminal input 300.",
  ],
  ["No such item, or it belongs to someone else.", "404. Check the id. Another account’s items answer the same way."],
  [
    "The request body is too large.",
    "413. 16 KB for most calls, 4 MB for a file write, 64 KB for MCP and 4 KB for webhooks.",
  ],
  ["Request body must be JSON", "400. Send valid JSON, or no body."],
  ["Request body must be a JSON object", "400. Send { … }, not a list or a bare value."],
  [
    "Unknown field \"<name>\". Allowed: ...",
    "400. Unknown body fields are refused so a typo cannot silently do nothing. The message lists the allowed ones.",
  ],
  [
    "A token with the terminal or file change permission expires in 7 days at most. Pick 7 days, or remove that permission.",
    "400. Pick 7 days, or untick Use the terminal and Change files.",
  ],
  [
    "A token with the terminal or file change permission expires in 7 days at most. Set the expiry to 7 days in the same change, or remove that permission.",
    "400. Raised when you edit a token. Set Expires after to 7 days in the same edit.",
  ],
  ["You can have up to 25 active tokens. Revoke one first.", "400. Revoke a token you no longer use. Expired and revoked ones do not count."],
  ["Give the token a name.", "400. A name is 1 to 60 characters."],
  ["Pick at least one permission.", "400. A token with no permissions can do nothing."],
  ["Send at least one field to change.", "400. An edit must change the name, the permissions or the expiry."],
  ["This token is revoked and cannot be edited.", "409. A revoked token is final. Make a new one."],
  ["Token not found", "404. It was deleted, or it is not yours."],
  ["content is not valid base64.", "400. With encoding set to base64, send standard base64 text."],
  [
    "The API writes files of up to 1 MB. Upload larger files in the dashboard.",
    "413. Use the Files tab for bigger files.",
  ],
  [
    "That file is over the 2 MB limit for this endpoint. Download larger files in the dashboard.",
    "413. The API download returns at most 2 MB, as base64.",
  ],
  ["This endpoint only accepts POST.", "405. The MCP address takes POST only."],
];

/** Every API call, grouped as the code lists them: tool name, method and path, permission, allowance. */
type Call = [tool: string, method: string, path: string, scope: string | null, allowance: string];
const CALLS: Call[] = [
  ["get_me", "GET", "/me", null, "Reads"],
  ["list_projects", "GET", "/projects", "projects:read", "Reads"],
  ["get_project", "GET", "/projects/{projectId}", "projects:read", "Reads"],
  ["create_project", "POST", "/projects", "projects:write", "Changes"],
  ["update_project", "PATCH", "/projects/{projectId}", "projects:write", "Changes"],
  ["delete_project", "DELETE", "/projects/{projectId}", "projects:write", "Changes"],
  ["get_status_page", "GET", "/projects/{projectId}/status-page", "projects:read", "Reads"],
  ["list_deployments", "GET", "/projects/{projectId}/deployments", "deployments:read", "Reads"],
  ["deploy_branch", "POST", "/projects/{projectId}/deployments", "deployments:write", "Changes"],
  ["get_deployment", "GET", "/deployments/{deploymentId}", "deployments:read", "Reads"],
  ["get_deployment_logs", "GET", "/deployments/{deploymentId}/logs", "deployments:read", "Container session"],
  ["redeploy", "POST", "/deployments/{deploymentId}/redeploy", "deployments:write", "Changes"],
  ["cancel_deployment", "POST", "/deployments/{deploymentId}/cancel", "deployments:write", "Changes"],
  ["rollback_deployment", "POST", "/deployments/{deploymentId}/rollback", "deployments:write", "Changes"],
  ["rotate_deploy_hook", "POST", "/projects/{projectId}/hook/rotate", "deployments:write", "Changes"],
  ["revoke_deploy_hook", "DELETE", "/projects/{projectId}/hook", "deployments:write", "Changes"],
  ["get_logs", "GET", "/projects/{projectId}/logs", "logs:read", "Reads"],
  ["list_env_vars", "GET", "/projects/{projectId}/env", "env:read", "Reads"],
  ["set_env_var", "PUT", "/projects/{projectId}/env/{key}", "env:write", "Changes"],
  ["delete_env_var", "DELETE", "/projects/{projectId}/env/{key}", "env:write", "Changes"],
  ["list_domains", "GET", "/domains", "domains:read", "Reads"],
  ["add_domain", "POST", "/domains", "domains:write", "Changes"],
  ["verify_domain", "POST", "/domains/{domainId}/verify", "domains:write", "Changes"],
  ["remove_domain", "DELETE", "/domains/{domainId}", "domains:write", "Changes"],
  ["get_notifications", "GET", "/projects/{projectId}/notify", "notifications:read", "Reads"],
  ["test_notification", "POST", "/projects/{projectId}/notify/test", "notifications:read", "Changes"],
  ["get_alerts", "GET", "/projects/{projectId}/alerts", "alerts:read", "Reads"],
  ["get_analytics", "GET", "/projects/{projectId}/analytics", "analytics:read", "Reads"],
  ["get_activity", "GET", "/activity", "activity:read", "Reads"],
  ["get_server_usage", "GET", "/servers/{serverId}/usage", "resources:read", "Reads"],
  ["get_resource_history", "GET", "/servers/{serverId}/usage/history", "resources:read", "Container session"],
  ["get_project_resources", "GET", "/projects/{projectId}/resources", "resources:read", "Container session"],
  ["list_servers", "GET", "/servers", "container:read", "Reads"],
  ["get_container_inventory", "GET", "/servers/{serverId}/inventory", "container:read", "Container session"],
  ["list_files", "GET", "/projects/{projectId}/files", "files:read", "Container session"],
  ["read_file", "GET", "/projects/{projectId}/files/content", "files:read", "Container session"],
  ["download_file", "GET", "/projects/{projectId}/files/download", "files:read", "Container session"],
  ["write_file", "PUT", "/projects/{projectId}/files/content", "files:write", "Container session"],
  ["make_folder", "POST", "/projects/{projectId}/files/folders", "files:write", "Container session"],
  ["rename_file", "POST", "/projects/{projectId}/files/rename", "files:write", "Container session"],
  ["delete_file", "DELETE", "/projects/{projectId}/files", "files:write", "Container session"],
  ["terminal_status", "GET", "/projects/{projectId}/terminal", "terminal:use", "Reads"],
  ["terminal_open", "POST", "/projects/{projectId}/terminal", "terminal:use", "Container session"],
  ["terminal_send", "POST", "/projects/{projectId}/terminal/{sessionId}/input", "terminal:use", "Terminal input"],
  ["terminal_read", "GET", "/projects/{projectId}/terminal/{sessionId}/output", "terminal:use", "Reads"],
  ["terminal_resize", "POST", "/projects/{projectId}/terminal/{sessionId}/resize", "terminal:use", "Changes"],
  ["terminal_close", "DELETE", "/projects/{projectId}/terminal/{sessionId}", "terminal:use", "Changes"],
];

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
      intro="How Egg keeps your SSH key, your builds and your secrets, what each part can reach, and what the people who run it can and cannot see."
    >
      <P>
        Every statement on this page is enforced by the server, and every number is the value the code uses. The
        Limits table at the end says where each one is set. To report a vulnerability, use the{" "}
        <InternalLink href="/security">security page</InternalLink>, not a public issue.
      </P>
      <P>
        Words used on this page. Your <B>container</B> is the Nest account Egg deploys into. A <B>server</B> is one
        connected container in Egg’s list. <B>Egg’s machine</B> is the computer that runs Egg: Egg’s own host, or
        your computer if you run a copy yourself. The <B>worker</B> is the part of Egg that takes queued deployments
        and runs them. A <B>build</B> installs and builds your project on your container, in a new release folder,
        under a <B>cap</B>, a memory and CPU limit that the kernel enforces. <B>Sealed</B> means encrypted, so it cannot be read without <C>APP_SECRET</C>. A{" "}
        <B>webhook</B> is a message one program sends to a web address when something happens. GitHub sends Egg one
        on every push, and Egg sends one to your own address if you add it under Webhooks. An <B>access token</B> is
        a secret you make on the Developer page for scripts and agents. A <B>session</B> is one signed-in browser.
      </P>

      <H2 id="security-key" />
      <P>
        Press <B>Create key</B> on the Connect page. Egg makes one ed25519 key for that server and for nothing else.
        Then you paste the public half into the SSH Keys page of the Nest dashboard. The private half is sealed with
        AES-256-GCM before it is stored in Egg’s database. The sealing key comes from the <C>APP_SECRET</C> setting,
        and each sealed value is tied to its own record, so a value copied into another row does not open. The
        private key is never shown, and no API call returns it.
      </P>
      <Callout tone="warning" title="This key is root on your container">
        SSH into Nest lands in a root shell inside your own container, so the key can do anything you can do there.
        The Connect page says so before you add it. Connect only a container you are happy to deploy to.
      </Callout>
      <P>
        Egg does not trust Nest’s SSH host on sight. The first time you press <B>Test connection</B>, Egg reaches the
        host, reads its host key, hangs up and shows the SHA-256 fingerprint in a “Confirm host key” box. Nothing is
        sent to your container yet. Check the fingerprint against the one Nest shows for your server, then press{" "}
        <B>Confirm host key</B>. Only then is the fingerprint pinned, which means stored and required from then on.
        Until it is pinned, no deploy, file change or terminal connects to the server. After that, if the host
        presents any other key, Egg stops before it sends anything and the connection fails.
      </P>
      <P>
        <B>New key</B> deletes Egg’s old private key at once and keeps the pin. The server goes back to “Waiting for
        the key”, and deploys, files and terminals fail until you paste the new public key into the Nest dashboard
        and press <B>Test connection</B>. Apps that are already running are not touched. To clear a pin, press{" "}
        <B>Disconnect</B> and connect the server again. That asks you to confirm the fingerprint again.
      </P>
      {why(
        <>
          Nest cannot hand Egg a narrower login than yours, so the key is as strong as your own. A key made for one
          server means you can end Egg’s access by deleting that one key in the Nest dashboard, without touching
          anything else. The pin exists because SSH trusts whatever answers the first time. After you
          confirm the fingerprint, a different host is refused before any file or variable is sent. Egg cannot
          know the right fingerprint for you, so check it against the one Nest shows for your server. If you
          confirm a fingerprint without checking it and something sat between Egg and Nest at that moment, its key
          is the one that gets pinned.
        </>
      )}
      <Callout tone="warning" title="Disconnect asks about the server’s projects">
        Disconnect closes the terminals opened with this server’s key and deletes Egg’s copy of the private key. The
        public key stays on the SSH Keys page of the Nest dashboard until you delete it there. When the server has
        projects, a box asks whether to delete them as well: “Also delete the project on this server”, or “Also
        delete the N projects on this server”. Left unticked, which is the default, the projects are kept, the server
        shows as disconnected, and connecting the same Nest username again reattaches them. Ticked, the projects and
        their deployments and logs are deleted from Egg. Nothing on the container is removed either way, and running
        apps keep running.
      </Callout>
      {steps("security-key-steps", "Take access back", [
        {
          title: "Delete the key in Nest",
          body: "Egg’s access ends at once. Your apps keep running, because they are ordinary services in your container (systemd, the Linux service manager) and do not need Egg to run.",
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

      <H2 id="security-builds" />
      <P>
        A build turns your repository into files your app can run. Egg does it in four steps. Three of them happen on
        your container, so this page says what they use.
      </P>
      {steps("security-builds-steps", "Where each step runs", [
        {
          title: "Clone and pack the source, on Egg’s machine",
          body: "The worker downloads a shallow copy of your branch from github.com (the latest commit only) into a work folder and packs the source into one archive, a compressed .tar.gz file. Nothing is installed or built there. The GitHub token is used for the clone and is never sent to your container. The clone stops after 5 minutes. The work folder is deleted when the deployment ends.",
        },
        {
          title: "Check your container, then upload and unpack",
          body: "Before anything is uploaded, Egg looks at your container: the Node.js version (the project’s engines range, or 22.13 or newer), the package manager the lockfile needs, Python 3 and venv for a Python project, systemd-run, timeout, and at least 2048 MB of free disk. If a check fails, the deployment ends with one line that says what to fix, and nothing is uploaded. If all pass, Egg uploads the source over SSH and unpacks it into a new release, a folder that holds one deployed version of your app. The running release is not touched.",
        },
        {
          title: "Install and build, on your container, under a cap",
          body: "Your install and build commands run in the new release folder, then the production install. All of it runs under the cap, a hard memory and CPU limit that the kernel enforces. The table below lists it. Your app keeps serving the whole time. Your project’s variables are written to a file with mode 600 for the build, and Egg deletes that file when the build ends. If the build fails, runs out of memory, times out or is canceled, Egg deletes the new folder and the running release stays.",
        },
        {
          title: "Switch, on your container",
          body: "Egg writes the release’s variables file, points the service at the new release and restarts it, so the app is unavailable for a moment. Then it waits up to 45 seconds for the app to answer.",
        },
      ])}
      <P>
        If the clone, the checks, the build or the upload fails, the deployment shows Error and your container keeps
        running its current release. If the new release does not answer after the restart, a production deploy puts the
        previous release back and shows Error.
      </P>
      <P>The cap is set like this:</P>
      <Table
        caption="The cap on a build"
        head={["Setting", "Value"]}
        rows={[
          [
            "Memory",
            <>
              The server’s Build memory (MB), 512 MB by default, set on the Container page. A project with a build step
              gets at least 1024 MB while it builds, if your container has room for it (its memory minus 512 MB is at
              least 1024 MB). Installs use the setting. It is never more than your container’s memory minus 512 MB,
              which stays free for your app. If that leaves less than 256 MB, the build does not start. There is no
              swap, so the limit is real.
            </>,
          ],
          ["CPU", "The server’s Build CPU limit (cores), 2 by default, as a quota of 100% for each core. The build also runs at a low priority, so your app gets the CPU first when it is busy."],
          ["Processes", "At most 4096."],
          ["Time", "15 minutes, then the build is stopped. This limit cannot be changed."],
          ["Builds at once", "One at a time on a container. A second build waits for up to 30 minutes."],
          ["If memory runs out", "The kernel is told to stop the build before your app, so a build that goes over its cap is the one that dies."],
          ["What it can see", "Everything your Nest user can see on your container. The cap limits memory and CPU. It does not hide your files from the build, which runs as the same user as your app."],
          ["Network", "Normal access from your container, because installing packages needs it."],
          ["What it is given", <>Your project’s variables for a production or a preview deployment, and <C>CI=true</C>.</>],
        ]}
      />
      <List>
        <li>
          <B>What is checked first.</B> The repository must be a plain <C>https</C> URL on <C>github.com</C>. A
          branch name may use letters, digits, dots, underscores, hyphens and slashes, and may not start with a hyphen or contain{" "}
          <C>..</C>, so it cannot be read as a Git option. The root and output folders are resolved to their real
          paths, so a link inside a repository cannot pull in a file from Egg’s machine.
        </li>
        <li>
          <B>What is limited.</B> The packed source may be 500 MiB (524,288,000 bytes). A larger one fails the
          deployment before anything is uploaded. The work folder is deleted when the deployment ends. A deployment
          stores at most 20,000 log lines, and then one line says “Further log output was dropped: this deployment
          reached its log limit.” The build carries on. Colour codes and control characters are removed from each
          line, and a line is cut at 4000 characters.
        </li>
        <li>
          <B>Pull requests from forks are never built</B>, because that would run a stranger’s code next to your
          variables.
        </li>
      </List>
      {why(
        <>
          A build runs code from a repository, so it has to run somewhere. Egg runs it on your container, a machine
          you already control and already run your own code on, and keeps strangers’ build code off the machine that
          holds everyone’s data. The cap protects your running app from a build that uses too much memory or CPU. It
          does not protect your files from the build. That is a deliberate trade, and it is why you should build only
          code you wrote or trust, and why variables should hold only what the build needs. The build has network
          access, because a build that cannot install packages is no build.
        </>
      )}

      <H2 id="security-vars" />
      <List>
        <li>
          <B>Environment variables</B> are sealed with AES-256-GCM, tied to the project, the name and where the
          value applies. The list shows names only. Values are never sent back by the browser routes or the API. At
          deploy time they are written to a <C>.env</C> file on your container with mode 600.
        </li>
        <li>
          <B>Log masking.</B> A value is replaced by <C>***</C> in build and deploy logs and in a deployment’s error
          text. The base64 form of a value (padded, unpadded or URL-safe) and its percent-encoded form are replaced
          too. A value of 2 or 3 characters is masked only where it stands alone, not inside a longer word or number.
          A value of one character is never masked, because it would garble every line. A value that spans several
          lines, such as a PEM key, is also masked line by line for each line of 8 or more characters. Any other
          change to a value, such as hex or a hash, is not recognised. Do not print secrets.
        </li>
        <li>
          <B>Deploy hooks, access tokens and sessions.</B> Only a SHA-256 of each is stored. A hook URL and a token
          secret are shown once, when you make them.
        </li>
        <li>
          <B>Notification webhook URLs and webhook signing secrets</B> are sealed. A Discord or Slack URL is never
          shown again. A signing secret starts with <C>whsec_</C> and is shown once.
        </li>
        <li>
          <B>Analytics keys</B> are the exception: a key starting with <C>nda_</C> sits in your page source on
          purpose, and can only add a page view to its own project.
        </li>
      </List>
      <Callout tone="note" title="Where a value can still be read">
        The Files tab and the API both refuse <C>current/.env</C> and each release’s <C>.env</C>, by name and after
        links are followed, so a link in <C>shared/</C> cannot reach them. A terminal can still read them, because a
        shell reads anything its user can. That is why the terminal is off by default and why an access token with
        the terminal permission lives 7 days at most. Treat the terminal switch, and your Egg sign-in, as the key to
        your variables.
      </Callout>

      <H2 id="security-signin" />
      <List>
        <li>
          <B>Sign-in.</B> Hack Club Auth proves who you are. Egg asks only for <C>openid</C>, <C>profile</C> and{" "}
          <C>email</C>, and none of that reaches your container. The sign-in handshake must finish within 10
          minutes, in the browser that began it.
        </li>
        <li>
          <B>Session.</B> A random token in an <C>httpOnly</C>, <C>SameSite=Lax</C> cookie called <C>egg_session</C>,
          marked <C>Secure</C> in production. It lasts 30 days. Only a hash is stored. Signing in again replaces the
          session you were using, so an old cookie does not live on.
        </li>
        <li>
          <B>Requests.</B> Every change from the browser must come from this site, because the <C>Origin</C> header
          is checked. A write with no <C>Origin</C> that the browser marks as cross-site is refused too. The API and
          the MCP endpoint never read cookies. They take a bearer token only. A JSON request from the dashboard is
          read up to 256 KB and a larger one is refused with 413.
        </li>
        <li>
          <B>Sensitive switches.</B> The Terminal and File changes switches need a Hack Club sign-in from the last 5
          minutes before they turn on. Turning one off never asks.
        </li>
        <li>
          <B>Guessing.</B> One IP address may make 20 sign-in attempts a minute, and 60 requests a minute with access
          tokens that are not valid. Past that the answer is 429. Egg reads the address from the proxy headers only
          when the <C>TRUST_PROXY</C> setting is on. It is off by default, so with it off there is no address to
          count and these two limits do not apply. Turn it on only when every request reaches Egg through a reverse
          proxy you run.
        </li>
        <li>
          <B>GitHub events.</B> A message from GitHub is accepted only with a valid <C>X-Hub-Signature-256</C>{" "}
          signature over the raw body. The body is capped at 5 MB, and a request with no length or a missing or malformed signature is refused before its body is read. Each message has an id, called a delivery id, and
          Egg remembers it for 1 hour, so a replayed delivery does nothing. A deploy hook takes a body of 4 KB at
          most.
        </li>
        <li>
          <B>Browser headers.</B> Every page is sent with <C>X-Frame-Options: DENY</C> and a policy that forbids
          framing, <C>nosniff</C>, a strict referrer policy and a permissions policy that turns off the camera,
          microphone, location and payment. In production it also sends <C>Strict-Transport-Security</C> for two
          years. The content policy still allows inline scripts, because Next.js writes the ones that start a page.
        </li>
      </List>

      <H2 id="security-visibility" />
      <List>
        <li>
          <B>You</B> can see everything that belongs to your account and nothing that belongs to anyone else. Another
          account’s project, server or deployment answers as if it did not exist.
        </li>
        <li>
          <B>The people who run Egg</B> have no admin screen in the product. What shows through the site is the
          public stats page, which gives totals only: a count under 10 shows as “fewer than 10”, a larger one keeps
          two significant figures, and a percentage or median appears only with at least 50 items behind it.
        </li>
        <li>
          <B>They also host the database and hold the secret.</B> <C>APP_SECRET</C> seals your SSH key and your
          variables. The sealing protects a copied database or a backup. It does not stop whoever holds both the
          database and the secret. If that is not acceptable, run your own copy.
        </li>
        <li>
          <B>The public</B> can see three things you turn on: a status page, the analytics script and its collector,
          and the comment on a pull request. A status page shows the project name, whether the app answers, a 30-day
          strip and the latest 10 outages, and nothing else. The collector answers 204 whether or not a key exists,
          so keys cannot be probed.
        </li>
        <li>
          <B>Your receivers</B>, the addresses you add under Webhooks, get a signed message when a deployment starts,
          succeeds or fails. It never carries variables, logs, commit messages or errors. Egg refuses to send to a
          private or internal address and does not follow redirects.
        </li>
        <li>
          <B>The log of your actions</B> records what you did, with names and paths. It never records the contents of
          a file, a variable’s value, or what you typed or saw in the terminal, and anything that looks like a secret
          is dropped before an entry is shown.
        </li>
      </List>

      {limits("security-limits", [
        ["Session", "30 days", "The cookie and the stored session both expire. Sign in again.", "server/auth/session.ts (SESSION_DAYS)"],
        ["Fresh sign-in", "5 minutes", "Older than that, turning on Terminal or File changes sends you to Hack Club again, and turning on password sign-in is refused until you sign in again.", "server/auth/session.ts (REAUTH_WINDOW_MS)"],
        ["Sign-in handshake", "10 minutes", "A sign-in that takes longer fails. Start again from the login page, in one browser.", "app/api/auth/login/route.ts (maxAge)"],
        ["Sign-in attempts", "20 a minute per address", "A redirect to the login page. Wait a minute.", "server/rate-limit.ts (RATE_LIMITS.signIn)"],
        ["Invalid access tokens", "60 a minute per address", "429 with Retry-After.", "server/rate-limit.ts (RATE_LIMITS.badToken)"],
        ["Token with terminal or file changes", "7 days at most", "The token form refuses a longer expiry.", "server/api-tokens.ts (SHORT_LIVED_MAX_DAYS)"],
        ["Terminals", "5 per account, 50 on the server", "“You can have 5 terminals open at once. Close one first.”", "server/terminal.ts (TERMINAL_LIMITS)"],
        ["Servers per account", "5", "“You can connect up to 5 servers.”", "server/servers.ts (MAX_SERVERS_PER_USER)"],
        ["GitHub delivery", "5 MB, id remembered 1 hour", "A larger body or a repeated id is dropped.", "app/api/webhooks/github/route.ts, server/github/webhook.ts (DELIVERY_TTL_MS)"],
        ["Deploy hook body", "4 KB", "413.", "app/api/hooks/deploy/[token]/route.ts (MAX_BODY_BYTES)"],
        ["Dashboard JSON request", "256 KB", "413 “That request is too large.”", "server/body-limit.ts (JSON_BODY_LIMIT)"],
        ["Host key", "Confirmed by you on the first Test connection", "Nothing connects until it is confirmed. A different key later stops the connection.", "server/servers.ts"],
        ["Clone", "5 minutes", "“The build timed out.” Nothing changes on your container.", "server/deploy/build.ts (clone timeoutMs)"],
        ["Build time", "15 minutes. It cannot be changed.", "The build is stopped and the deployment fails with “The build took longer than 15 minutes and was stopped.” The new release folder is deleted and the live release keeps running.", "server/deploy/container-build.ts (BUILD_TIMEOUT_SECONDS)"],
        ["Free disk before a build", "2048 MB", "The deployment ends before the upload with “Free up disk space on your container: <n> MB is free and a build needs at least 2048 MB.”", "server/deploy/container-probe.ts (MIN_FREE_DISK_MB)"],
        ["Build output", "500 MiB (524,288,000 bytes), measured on the packed archive", "The deployment fails with the size in the message, before the upload.", "server/deploy/build.ts (MAX_ARCHIVE_BYTES)"],
        ["Unpack the source on your container", "15 minutes", "The deployment fails and the live release keeps running.", "server/deploy/container-build.ts (unpackSourceScript)"],
        ["Build log", "20,000 lines", "One line says the rest was dropped. The build carries on.", "server/deploy/logger.ts (MAX_LOG_ROWS)"],
        ["Build memory", "512 MB by default, 512 MB up to the server’s memory. A project with a build step gets at least 1024 MB while it builds, if the container has room. A build never gets more than the container’s memory minus 512 MB, and does not start under 256 MB.", "“Build memory must be a whole number of MB from 512 to <max>.”", "lib/build-memory.ts, server/deploy/container-build.ts (containerMemoryCapMb)"],
        ["Build CPU", "2 cores by default, 0.5 to the Nest server’s reported cores in 0.25-core steps", "“Build CPU must be a number from 0.5 to <max> cores in 0.25-core steps.”", "lib/build-memory.ts, server/deploy/container-build.ts (cpuQuotaPercent)"],
        ["Notification post", "5 seconds", "The post is dropped and logged. Redirects are refused.", "server/notify.ts"],
      ])}

      {wrong("security-wrong", [
        [
          "The host key of <host> changed (was <old>, now <new>). Nothing was sent. If you expected this, reconnect the server.",
          "Stop. Something else answered where Nest should be, or Nest changed its key. If you expected it, Disconnect and add the server again, and choose whether to keep its projects.",
        ],
        [
          "Nest rejected the key. Check that you pasted the public key on the SSH Keys page of the Nest dashboard, and that the username is exactly your Nest username.",
          "Paste the public key again. After New key, the old one stops working.",
        ],
        ...SWITCH_OFF.slice(3),
        [
          "<name> is disconnected. Connect it again to manage its projects.",
          "409. You kept the projects when you disconnected. Connect the same Nest username again from Connect and run Test connection.",
        ],
        [
          "Too many requests for unrecognised access tokens. Wait <n> second(s) and try again.",
          "429. Many invalid tokens came from your address. Fix the token your script sends, then wait.",
        ],
      ])}

      {example("security-example", {
        title: "End Egg’s access",
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
                In Egg, open Connect and press <B>Test connection</B>.
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
      {example("security-example-mask", {
        title: "See a secret masked",
        given: (
          <>
            A project with a variable <C>STRIPE_KEY</C> set to <C>sk_live_abc123</C>, and a build command of{" "}
            <C>{"echo \"key is $STRIPE_KEY\""}</C>.
          </>
        ),
        steps: [
          { title: "Deploy", body: "Press Deploy and open the deployment’s log." },
          { title: "Find the line", body: "Look for the line the echo printed." },
        ],
        result: (
          <>
            The log shows <C>key is ***</C>. The same happens if the build prints the base64 form of the value. Had the
            value been printed as a hash or in hex, the log would have shown it.
          </>
        ),
      })}
      {related([
        ["servers", "Servers"],
        ["container", "Container, terminal and files"],
        ["env", "Environment variables"],
        ["api", "Access tokens and the API"],
      ])}
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  activity: () => (
    <Section
      id="activity"
      intro="A newest-first log of what you changed and what the monitor saw, with a search, two filters and a CSV export."
    >
      <P>
        Open Activity in the sidebar. Entries are grouped by day in UTC, with Today and Yesterday named. Each row
        says what happened, to which project, server or domain, and what did it. A change made with an access token
        shows the token’s name, so you can tell a script from yourself. A project, token or server that has since been
        deleted still shows by the name it had, marked as gone. The log is kept in Egg’s database, so reading,
        searching and exporting it never contacts your container and changes nothing.
      </P>
      {why(
        <>
          Days are cut at midnight UTC so the log reads the same wherever you are and two people on one account see
          the same groups. Two entries a second apart on either side of midnight UTC land under different days. The
          build log on a deployment page shows your browser’s time, which is the only place that does.
        </>
      )}

      <H2 id="activity-log" />
      <P>
        The log covers your own actions and the monitor’s. Examples of the wording: “Created project”, “Changed
        settings for”, “Saved environment variable on”, “Started a deployment of”, “Redeployed”, “Rolled back”,
        “Canceled a deployment of”, “Deployed through the deploy hook for”, “Turned on analytics for”, “Published a
        status page for”, “Detected downtime on”, “Detected recovery of”, “Created an access token”, “Opened a
        terminal on”, “Saved a file on”, “Created a webhook”, “Replaced the SSH key for”, “Changed the build memory limit for”, “Disconnected”, “Changed
        container permissions for” and “Removed a leftover from the container”.
      </P>
      <Table
        caption="What each Kind covers"
        head={["Kind", "What it holds"]}
        rows={[
          [<B key="p">Projects</B>, "Creating, changing, restarting and deleting projects. Saving and removing variables. Turning analytics on or off or changing what it records. Publishing or unpublishing a status page."],
          [<B key="d">Deployments</B>, "Starting, redeploying, rolling back and canceling deployments. Deleting previews. Creating, revoking and using a deploy hook."],
          [<B key="o">Domains</B>, "Adding, changing and removing a domain."],
          [<B key="s">Servers</B>, "Replacing the SSH key, changing the build memory limit, changing container permissions, removing leftovers and disconnecting a server. A disconnect entry records how many projects were kept or deleted."],
          [<B key="a">Access and tokens</B>, "Creating, editing and revoking access tokens. Signing out other browsers. Confirming sign-in with Hack Club. Creating, changing, testing and deleting webhooks."],
          [<B key="m">Monitoring</B>, "“Detected downtime on” and “Detected recovery of”."],
          [<B key="t">Terminal and files</B>, "Opening and closing a terminal, and saving, creating, renaming and deleting files."],
        ]}
      />
      <P>
        An entry that fits none of these shows only under All. Terminal and file entries record that something
        happened, with a path or a duration. They never record file contents or what you typed or saw. A detail that
        looks like a secret, by its name or its value, is dropped before an entry is shown or exported.
      </P>

      <H2 id="activity-filters" />
      {steps("activity-filters-steps", "Find an entry", [
        { title: "Search", body: "Type in “Search by action, project or detail”. Every word you type has to match." },
        {
          title: "Pick a kind",
          body: "Choose All, Projects, Deployments, Domains, Servers, Access and tokens, Monitoring, or Terminal and files.",
        },
        { title: "Pick a date range", body: "Choose Last 24 hours, Last 7 days, Last 30 days or All time." },
        { title: "Load more", body: "Press Load more at the bottom to read the next 50." },
        { title: "Start again", body: "Press Clear filters to go back to All kinds, All time and no search." },
      ])}
      <P>
        The filters are in the address, so a filtered list can be bookmarked or shared with yourself on another
        device. With Kind on All and nothing in the search box, three or more neighbouring entries of one kind fold
        into one row such as “4 token and access changes”, and every entry is still inside it. Search and a chosen
        Kind show every row.
      </P>

      <H2 id="activity-export" title="Exporting to CSV" />
      <P>
        Press <B>Export CSV</B> at the top of the page to download what the list shows. The file follows the search,
        kind and date range you have set, newest first. Its columns are Time (UTC), Kind, Action, Description,
        Target, Details, Access token and Entry id. Secrets are left out exactly as they are on the page, and a value
        that starts with <C>=</C>, <C>+</C>, <C>-</C> or <C>@</C> gets a leading quote so a spreadsheet shows it as
        text. The response carries an <C>x-export-truncated</C> header that is <C>true</C> when more entries matched
        than the file holds.
      </P>
      <H3 id="activity-api" title="Reading it from a script" />
      <P>
        A token with <C>activity:read</C> can read the same log with <C>GET /api/v1/activity</C>, with the same kinds
        and ranges. <C>kind</C> is one of <C>all</C>, <C>projects</C>, <C>deployments</C>, <C>domains</C>,{" "}
        <C>servers</C>, <C>access</C>, <C>monitoring</C> and <C>terminal</C>. <C>range</C> is <C>24h</C>, <C>7d</C>,{" "}
        <C>30d</C> or <C>all</C>. <C>limit</C> is 1 to 100 and defaults to 50. The answer has <C>items</C>,{" "}
        <C>nextCursor</C> and <C>total</C>. Pass <C>nextCursor</C> back as <C>cursor</C> for the next page.
      </P>
      {code(
        "Terminal",
        `curl -H "Authorization: Bearer $NEST_TOKEN" \\\n  "https://your-egg/api/v1/activity?kind=deployments&range=24h&limit=20"`
      )}

      {limits("activity-limits", [
        ["Entries per page", "50", "Press Load more for the next 50.", "server/activity.ts (PAGE_SIZE)"],
        ["Search depth", "The newest 5000", "A search reads in batches of 200 and says “Searched the latest 5,000 entries.” when it stopped at the limit. Narrow the date range instead.", "server/activity-query.ts (SCAN_LIMIT, SCAN_BATCH)"],
        ["Search text", "80 characters", "Anything longer is cut.", "server/activity.ts (MAX_QUERY)"],
        ["CSV export size", "5000 entries", "The file stops there and x-export-truncated is true. Narrow the date range or search to export the rest.", "server/export-csv.ts (EXPORT_ROW_LIMIT)"],
        ["CSV export rate", "10 a minute per account", "“Too many exports. Wait <n> second(s) and try again.”", "server/export-csv-data.ts (EXPORT_RATE)"],
        ["API page", "1 to 100, default 50", "A value outside the range is a 400.", "server/api-v1-more.ts (activity query)"],
        ["Detail length", "200 characters", "A longer detail is cut with an ellipsis.", "server/activity.ts (MAX_VALUE)"],
        ["Retention", "No pruning", "Egg does not delete old entries. Deleting your account removes all of them.", "server/account.ts"],
      ])}

      {wrong("activity-wrong", [
        ["No activity yet", "Nothing has been recorded for your account yet. Make a change and it appears."],
        ["Nothing in this range yet", "Pick a longer date range, or set Kind back to All. Press Clear filters."],
        ["Could not load more", "Press Try again. If it keeps failing, reload the page. Your filters stay as they were."],
        ["Searched the latest 5,000 entries.", "An older match may exist. Narrow the date range and search again."],
        ["Too many exports. Wait <n> second(s) and try again.", "429. 10 exports a minute for your account."],
        ["A row shows the action name instead of a sentence", "The entry is of a kind this version has no wording for. Its time, target and details are still right."],
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
      {example("activity-example-export", {
        title: "Keep a record of one month",
        given: "You want every token and sign-in change from the last 30 days in a spreadsheet.",
        steps: [
          { title: "Set the filters", body: "Set Kind to Access and tokens and Date range to Last 30 days." },
          { title: "Export", body: "Press Export CSV." },
        ],
        result: (
          <>
            A file named for activity downloads with one row per entry, newest first. The Access token column names
            the token that made a change, and is empty for changes you made in the browser.
          </>
        ),
      })}
      {related([
        ["account", "Account"],
        ["api", "Access tokens and the API"],
        ["monitoring", "Monitoring and uptime"],
      ])}
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  account: () => (
    <Section
      id="account"
      intro="Your Hack Club sign-in, the Settings page, the browsers that are signed in, the cards on the Account page, and how to delete your account."
    >
      <P>
        Open Account from the account menu. It has cards for Profile, GitHub, Container permissions, Webhooks,
        Signed-in browsers and Delete account. How Egg looks and what new projects start with are on a separate
        page, Settings, which is in the same menu.
      </P>
      <List>
        <li>
          <B>Profile</B> shows “Shown as” (your display name and character, with a “Change in Settings” link),
          your Hack Club name, and your Email, or “Not shared” when there is no email. The Hack Club name and email
          are read only: change them at Hack Club. The name and character you are shown as are changed in Settings.
        </li>
        <li>
          <B>GitHub</B> lists the accounts where the GitHub app is installed, each with a “Manage on GitHub” link.
          With none installed it says “Not connected yet. Import a project to install the app.”
        </li>
        <li>
          <B>Container permissions</B> are covered on the{" "}
          <InternalLink href={docsHref("container")}>container</InternalLink> page.
        </li>
        <li>
          <B>Webhooks</B> send a signed message to your own code when a deployment starts, succeeds or fails. They
          are covered on the <InternalLink href={docsHref("notifications")}>notifications</InternalLink> page.
        </li>
      </List>
      <H2 id="account-settings" />
      <P>
        Settings holds your own choices. They are saved to your account as you make them, with a “Saved at” time
        under each card, and they follow you to other devices. The look is also kept in a browser cookie called{" "}
        <C>egg_prefs</C>, so a page is drawn the right way before it loads. Nothing on this page changes a project
        that already exists.
      </P>
      <Table
        caption="The Settings page"
        head={["Card and setting", "Choices", "Default"]}
        rows={[
          [
            "Profile, Display name",
            "Up to 40 characters. Shown in the menu and on the Account page. It is not used in any address, and two people can share a name. Control and invisible characters are refused.",
            "Empty: your Hack Club name is shown",
          ],
          [
            "Profile, Character",
            "One of eight small pixel characters: Egg, Cat, Ghost, Robot, Frog, Alien, Owl or Mushroom. You cannot upload a picture.",
            "Egg",
          ],
          [
            "Appearance, Match my device",
            "On or off. On, Egg uses your light theme while your device is light and your dark theme while it is dark, and switches by itself when the device does. Off, one theme stays whatever the device does.",
            "On",
          ],
          [
            "Appearance, Light theme",
            "Shown while Match my device is on. One of the light themes: Egg Light, GitHub Light, VS Code Light+, Inspired by Catppuccin Latte, Inspired by Rosé Pine Dawn, Inspired by Solarized Light, Inspired by Ayu Light or Inspired by One Light, or a light theme of your own.",
            "Egg Light",
          ],
          [
            "Appearance, Dark theme",
            "Shown while Match my device is on. One of the dark themes: Egg Dark, GitHub Dark, VS Code Dark+, Nord, Gruvbox Dark, Inspired by Dracula, Inspired by One Dark, Inspired by Tokyo Night, Inspired by Catppuccin Mocha, Inspired by Rosé Pine, Inspired by Monokai, Inspired by Ayu Dark or Inspired by Solarized Dark, or a dark theme of your own.",
            "Egg Dark",
          ],
          [
            "Appearance, Theme",
            "Shown while Match my device is off. Any one theme, listed as Light themes and Dark themes, that stays as you picked it.",
            "Egg Dark",
          ],
          [
            "Appearance, Your themes",
            "New theme opens an editor with a name, light or dark, and eight colours: page background, card surface, border, text, muted text, primary, link and danger. Each colour is a picker and a hex field. A sample page and the contrast checks update as you type. Edit, Export and Delete are on each saved theme, and Import reads a theme file. Up to 20 themes.",
            "None",
          ],
          ["Appearance, Density", "Comfortable or Compact", "Comfortable"],
          [
            "Deploys, Default branch",
            "A valid git branch name of up to 100 characters. It is filled in as the production branch when you add a project from a pasted repository URL. A repository you pick from GitHub keeps its own default branch.",
            <C key="b">main</C>,
          ],
          [
            "Analytics defaults",
            "Eight checkboxes: Clicks, Time on page, Funnel, Referrers, Speed and errors, Custom events, Live view and Retention. They decide which analytics features a project starts with the first time you turn analytics on for it.",
            "All off",
          ],
          [
            "Preferences, Motion",
            "Device follows your system setting. Reduce turns animation off. Allow keeps transitions even if your device asks for less.",
            "Device",
          ],
        ]}
      />
      <List>
        <li>
          <B>Themes</B> are each light or dark, as in VS Code, and none has a second version. A theme sets every
          colour together: backgrounds, cards, borders, text, links, buttons, the selected item, the focus ring and
          the status colours. Themes apply in the signed-in pages; the public site keeps the Egg look. Egg Light and
          Egg Dark are the two defaults. Themes named “Inspired by” take their colours from well-known palettes and are not made or endorsed by those projects.
        </li>
        <li>
          <B>Your own themes</B> are private to your account and follow you to every device. A colour is only ever
          a hex value such as <C>#1a2b3c</C> (3, 4, 6 or 8 digits); nothing else is accepted. Egg builds the rest of the
          theme from your eight colours. Text on the page and on a card must reach 4.5:1 contrast, or the theme is not
          saved, and Egg names the pair, shows the ratio and suggests the nearest colour that passes. Weaker pairs
          (button text, danger text, links, the focus ring at 3:1) only warn. An exported file holds the name, light
          or dark, and the colours, and nothing about you; an import over 8 KB or with unknown keys is refused. If you
          delete a theme you are using, Egg Light or Egg Dark takes its place.
        </li>
        <li>
          <B>Earlier choices</B> are moved once. An account set to Light or Dark keeps that as one fixed theme, and
          one set to System now has Match my device on. An old accent becomes the nearest theme (Blue becomes GitHub
          Light, Nord becomes Nord, Amber and Gruvbox become Gruvbox Dark, and the rest become Egg Light). You can pick
          another at any time.
        </li>
        <li>
          <B>Analytics defaults</B> only apply to a project the first time analytics is turned on for it. A project
          that already has analytics is not changed, and every project can still change its own switches. A Funnel
          switched on by default does nothing until the project has two steps. Retention stores a random id in the
          visitor’s browser, so leave it off unless you want returning visitors. Campaigns and Record visitor countries are not in this list: you turn them on for each project, and Campaigns also needs a list of allowed values. See{" "}
          <InternalLink href={docsHref("analytics")}>Analytics</InternalLink>.
        </li>
        <li>
          <B>Default branch</B> changes only the starting value of the form. You can still type another branch on
          each project.
        </li>
      </List>
      <H2 id="account-signin" />
      {steps("account-signin-steps", "Sign in", [
        { title: "Open the login page", body: "Its heading is “Log in to Egg”." },
        { title: "Press Continue with Hack Club", body: "Approve at Hack Club." },
        { title: "Land on Projects", body: "Egg sets a session cookie that lasts 30 days." },
      ])}
      <P>
        The account menu has <B>Sign out</B>. It ends this browser’s session and closes every terminal your account
        has open. Some switches ask you to confirm with Hack Club again. That is a second sign-in that counts for 5
        minutes, and it must be the same Hack Club account. A copy of Egg running in local mode has no Hack Club
        account, so it skips the confirmation.
      </P>
      <P>
        Hack Club is the way to sign in until you add another. The <B>Sign in with a password</B> card on Account
        can also turn on sign-in with your email and a password. It is off until you turn it on. You can turn it on
        only within 5 minutes of a Hack Club sign-in. If your last one is older, Egg answers “Confirm with Hack Club
        first. Turning on password sign-in needs a sign-in in the last 5 minutes.” Sign in with Hack Club again, then
        retry. The account must share an email address with Egg, the password needs at least 12 characters, and Egg
        shows a recovery key during setup, which you confirm you saved before the password is accepted. You cannot turn it
        off if it would leave you with no way to sign in.
      </P>
      {why(
        <>
          Egg never stores your Hack Club password. Hack Club proves who you are, and Egg keeps only a hash of its own
          session token. If you turn on a password, Egg keeps only a salted hash of it and of the recovery key, never
          the text itself. The 5 minute rule means a borrowed session cookie cannot add a password that would outlive
          the cookie. The second confirmation also exists because turning on a root shell is the one change that should not
          ride on a session cookie someone else may have borrowed from a laptop left open.
        </>
      )}
      <H2 id="account-sessions" />
      <P>
        The Signed-in browsers card lists each session with a label such as “Chrome on Windows” and when it was
        signed in. This one has a “This browser” badge. Press <B>Sign out</B> on another to end it, or{" "}
        <B>Sign out everywhere else</B> to end them all. Ending another session closes every terminal your account
        has open, because a terminal belongs to the account and not to one browser.
      </P>
      <H2 id="account-delete" />
      {steps("account-delete-steps", "Delete your account", [
        { title: "Open the Delete account card", body: "It is at the bottom of Account." },
        { title: "Type your name", body: "Type your Hack Club name exactly as Profile shows it under Hack Club name. Spaces at the start and end are ignored." },
        { title: "Press Delete account", body: "Your terminals close first, then your records are deleted." },
      ])}
      <P>
        This deletes your projects, servers, domains, keys, access tokens, webhooks, sessions and your activity log
        from Egg, and it cannot be undone. Nothing on your container is removed. Apps already there keep running, but
        nothing manages them any more. Delete the key on the SSH Keys page of the Nest dashboard as well, so Egg’s
        old public key does not stay on your container.
      </P>

      {limits("account-limits", [
        ["Session", "30 days", "Sign in again.", "server/auth/session.ts (SESSION_DAYS)"],
        ["Fresh sign-in", "5 minutes", "It matters only for turning on Terminal, File changes or password sign-in.", "server/auth/session.ts (REAUTH_WINDOW_MS)"],
        ["Sign-in handshake", "10 minutes", "Start again from the login page, in one browser.", "app/api/auth/login/route.ts (maxAge)"],
        ["Sign-in attempts", "20 a minute per address", "A redirect to the login page. Wait a minute.", "server/rate-limit.ts (RATE_LIMITS.signIn)"],
        ["Servers", "5 per account", "“You can connect up to 5 servers.”", "server/servers.ts (MAX_SERVERS_PER_USER)"],
        ["Access tokens", "25 active", "Revoke one to make another.", "server/api-tokens.ts (MAX_TOKENS_PER_USER)"],
        ["Webhooks", "10 per account", "“You can have up to 10 webhooks. Delete one first.”", "server/webhooks.ts (MAX_WEBHOOKS_PER_USER)"],
        ["Display name", "40 characters", "“The display name can be at most 40 characters”", "server/preferences.ts"],
        ["Default branch", "100 characters, a valid git branch name", "“That is not a valid git branch name”", "server/preferences.ts, lib/preferences.ts"],
      ])}

      {wrong("account-wrong", [
        ["Hack Club sign-in is not set up on this installation yet.", "The button is off. On your own copy, set HACKCLUB_CLIENT_ID and HACKCLUB_CLIENT_SECRET."],
        ["You did not approve the sign-in. Try again when you are ready.", "Press Continue with Hack Club and approve."],
        ["That sign-in link was not valid. Please try again.", "Start again from the login page."],
        ["The sign-in took too long or came from another browser. Please try again.", "Start and finish in one browser within 10 minutes."],
        ["Hack Club could not sign you in. Please try again in a moment.", "Wait a minute and try again."],
        ["Too many sign-in attempts. Wait a minute and try again.", "More than 20 sign-in attempts in a minute from one address. Wait a minute. On your own copy this only counts attempts when TRUST_PROXY is on."],
        ["Something went wrong signing in.", "Try again. If it keeps happening, open an issue on GitHub."],
        ["That is the session you are using. Sign out instead.", "Use Sign out in the account menu for this browser."],
        ["Session not found", "That session already ended. Reload the page."],
        ["Type your name exactly to confirm.", "Copy your Hack Club name from the Profile card."],
        ["Could not delete the account", "Nothing was deleted. Try again."],
        ["Could not sign that browser out", "Try again."],
        ["Could not sign the others out", "Try again."],
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
      {example("account-example-everywhere", {
        title: "Start clean after a scare",
        given: "You think a token or a cookie may have leaked.",
        steps: [
          { title: "Sign out everywhere else", body: "Press it on the Signed-in browsers card. Every other session ends and your terminals close." },
          { title: "Revoke the tokens", body: "On the Developer page, press Revoke on each token you do not recognise." },
          { title: "Read Activity", body: "Set Kind to Access and tokens and look for entries you did not make." },
        ],
        result: "Only this browser stays signed in, no token works, and Activity shows what happened and when.",
      })}
      {related([
        ["activity", "Activity"],
        ["security", "Security"],
        ["api", "Access tokens and the API"],
      ])}
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  container: () => (
    <Section
      id="container"
      intro="Three switches decide what Egg may do inside your container beyond deploying. All three start off."
    >
      <P>
        You need a connected server, which is one container in Egg’s list. The switches live in Account, under
        Container permissions, one card per server named like <C>sam-r.hackclub.app</C>. Egg checks the switch on
        every request, before it opens an SSH session to your container, so turning one off stops the very next
        call. Turning a switch on or off never restarts an app. Only the Terminal switch closes anything: it closes
        your open terminals on that server.
      </P>

      <H2 id="container-switches" />
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
        { title: "Flip a switch", body: "It saves at once and a message names the switch and the server, for example “Terminal turned on”." },
        {
          title: "Confirm if asked",
          body: "Terminal and File changes send you to Hack Club and back to Account, where the switch is applied. Turning any switch off never asks. Turning Terminal off closes your open terminals on that server, and says so.",
        },
      ])}
      <P>
        Reading is separate from changing. You can browse, read and download files, and read the Container page, with
        every switch off.
      </P>
      <Callout tone="warning" title="Check your older servers">
        An update once set File changes to off on every server that already existed. Do not assume an older server
        kept its old setting: open Account and look at each card. A server connected before the switches started off
        may also still have Removing leftovers on. Turn off what you do not use.
      </Callout>
      <Table
        caption="What each switch can destroy"
        head={["Switch", "What it can destroy"]}
        rows={[
          [
            <B key="t">Terminal</B>,
            "Anything the container user can touch, including apps and files Egg did not create. It is a root shell, and anyone signed in to your account can use it while it is on.",
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
              Egg services (<C>egg-*.service</C>) that no project uses, and whole folders under{" "}
              <C>~/.egg</C> that no project uses, including their <C>shared/</C> data.
            </>,
          ],
        ]}
      />
      {why(
        <>
          All three switches start off because each one reaches past “deploy my app”. The server enforces them, not
          just the page: a request to a feature that is off is refused with a 403 before any SSH connection is
          opened, and an access token cannot turn a switch on. A switch that is off is the only part of this you do
          not have to trust Egg about.
        </>
      )}

      <H2 id="container-page" />
      <P>
        Container in the sidebar opens one SSH connection to your container and runs read-only commands, so it changes
        nothing there. It shows what is running and what Egg left behind. Pick a server if you have more than one, and
        press <B>Refresh</B> to read it again. A read that takes longer than 60 seconds fails.
      </P>
      <List>
        <li>
          <B>Disk used</B> shows the percentage and how much of it is Egg folders.
        </li>
        <li>
          <B>Projects</B> shows each project’s service (Running, Starting, Crashed, Stopped, or No service yet), its
          port, folder size and previews. If another program holds a project’s port you see “Port &lt;n&gt; is held
          by &lt;x&gt;, not by &lt;project&gt;” with a “Change the port” link. The next deploy of that project fails
          its health check until the clash is sorted.
        </li>
        <li>
          <B>Orphans</B> lists leftovers, described next.
        </li>
        <li>
          <B>Other ports</B> lists programs listening that Egg did not start, with “This container only” or “Open
          to the network”. It is read only. Without <C>ss</C> or <C>netstat</C> on the container it says so.
        </li>
      </List>
      <H3 id="container-build-memory" title="Build memory" />
      <P>
        Build memory is the cap on a build. The setting belongs to the server, so every project on that server builds
        with the same amount. A new server starts at 512 MB. A server that still had the old 1024 MB default saved was
        lowered to 512 MB; a value you saved yourself was kept. The Build memory card on the Container page has a field,{" "}
        <B>Build memory (MB)</B>, and a <B>Save</B> button. The allowed range is 512 MB up to the memory your
        container reported when Egg last read it, at Test connection or during a deploy, or up to 8192 MB when it
        reported none. The hint under the field shows the range for this server.
      </P>
      <P>
        A build runs on your container, so it can never use all of its memory. At deploy time Egg lowers the cap to
        your container’s memory minus 512 MB, which stays free for your app, whatever the field says. A field set to
        2048 MB on a container that reports 2048 MB gives a cap of 1536 MB. If that leaves less than 256 MB, the
        build does not start.
      </P>
      <P>
        Projects with a build step get at least 1024 MB while they build, if your container has room for it. A build
        step is a build command, or a build script such as <C>next build</C>. The floor applies only when your
        container’s memory minus 512 MB is at least 1024 MB, so a container that reports 1536 MB or more qualifies and
        a 1 GB container keeps the setting. It is applied when the build starts: the saved setting does not change,
        and a plain app or an install alone stays at the setting.
      </P>
      {steps("container-build-memory-steps", "Change the build memory", [
        { title: "Open Container", body: "Pick the server from the list if you have more than one.", path: ["Container", "Build memory"] },
        { title: "Type a number in Build memory (MB)", body: "A whole number of MB inside the range in the hint. Save stays off until the number differs from the saved one." },
        { title: "Press Save", body: "A message says “Build memory set to <n> MB”. The next build on that server uses it. A build already running keeps the old limit." },
        { title: "Go back to the default", body: "Press Use 512 MB, then Save. The button shows only while the saved value is not 512." },
      ], 3)}
      <P>
        A value outside the range is refused with “Build memory must be a whole number of MB from 512 to &lt;max&gt;.”
        A build that needs more than the cap stops with “The build needed more memory than the cap of &lt;n&gt; MB.”
        When a release was already serving, “Your app is still running.” follows. The deployment shows Error, Egg
        deletes the new release folder, and the live release keeps running. Raise the limit and deploy again. The
        setting is changed in the browser only: no access token or agent call can change it. Each change is recorded
        in Activity as “Changed the build memory limit for”.
      </P>
      {why(
        <>
          A build shares your container with your app, so the default is 512 MB, which covers installs and plain apps, a project with a
          build step gets at least 1024 MB when the container has room, and the cap always leaves 512 MB for the app. The limit is per server because servers differ: some can use more, and a build that fits a
          small server should not be given more than that server could ever offer. The top of the range follows what
          the server reported, so the page does not let you ask for memory the server does not have. A build gets no
          swap, so the limit is a real one and a build cannot slip past it by swapping.
        </>
      )}

      <H3 id="container-build-cpu" title="Build CPU" />
      <P>
        The CPU limit applies to the build. It does not limit the app after it is installed on your Nest container.
        Each connected server has its own limit: 2 cores by default, adjustable from 0.5 cores in 0.25-core steps up
        to the core count the Nest container last reported when Egg checked it. If no count was reported, the maximum
        stays at 2 cores. The default is capped to the reported count when a server has fewer than 2 cores. The build
        also runs at a low priority, so your app gets the CPU first when it is busy.
      </P>
      {steps("container-build-cpu-steps", "Change the build CPU limit", [
        { title: "Open Container", body: "Pick the server from the list if you have more than one.", path: ["Container", "Build CPU"] },
        { title: "Set Build CPU limit (cores)", body: "Enter a value in 0.25-core steps within the range shown under the field." },
        { title: "Press Save", body: "The next build on that server uses the new CPU cap. A build already running keeps its current limit." },
        { title: "Restore the default", body: "Press Use 2 cores, or the lower capacity-based default shown by the button, then Save." },
      ], 3)}
      <P>
        A value outside the range is refused with “Build CPU must be a number from 0.5 to &lt;max&gt; cores in
        0.25-core steps.” The cap limits the build’s maximum CPU time; it does not reserve cores for a build.
      </P>

      <H2 id="container-leftovers" />
      <P>
        A leftover is a service named <C>egg-&lt;project&gt;.service</C> or a preview unit that no project uses, or a
        folder under <C>~/.egg</C> that is not a project. It usually appears after you delete a project with
        “Also stop the service and delete releases” unticked, or after a failed cleanup.
      </P>
      {steps("container-leftovers-steps", "Remove a leftover", [
        { title: "Turn on Removing leftovers", body: "In Account, under Container permissions, for that server." },
        { title: "Open Container", body: "Find the row under Orphans. Its kind is Service, Preview service or Folder." },
        {
          title: "Press Remove",
          body: "A service asks “Remove <unit>?”. It stops the service, so anything running under it goes down, turns off starting at boot and deletes its unit file, the small file that tells Linux how to run it. Files in its folder are not touched.",
        },
        {
          title: "Confirm a folder by name",
          body: "A folder asks “Delete the folder <name>?” and you type its name, then press Delete folder. This deletes it and everything inside, including shared data, and cannot be undone.",
        },
      ])}
      <P>
        Egg knows what it made by two markers. A service file starts with a comment <C>egg:managed</C>, and a
        project folder holds a file named <C>.egg-managed</C>. An older folder without that file counts only
        if it holds nothing but <C>releases</C>, <C>incoming</C>, <C>shared</C>, <C>current</C> and{" "}
        <C>current.new</C> and has no <C>.git</C>. Anything without a marker is never overwritten, stopped, moved or
        deleted: a deploy refuses, cleanup refuses and project deletion leaves it.
      </P>
      <P>
        Every request is checked again against a fresh read of the container. A row that now belongs to a project,
        that is a symbolic link, or that has no marker is refused, even if you press Remove. Access tokens and the MCP
        endpoint cannot remove leftovers at all, and one request removes at most 50 items.
      </P>
      {why(
        <>
          Something you set up yourself can have a service whose name also starts with{" "}
          <C>egg-</C>, and a folder you made by hand can sit in <C>~/.egg</C>. A name alone proves nothing,
          so Egg trusts only its own marker, and checks it again at the moment you press Remove instead of
          trusting the list you were looking at.
        </>
      )}

      <H2 id="container-adopt" />
      <P>
        If an app of yours already runs on the container, Egg can check what the new project would collide with
        before it touches anything. In New Project the check runs by itself once the name, server and port are
        valid, and again at the start of every deploy. It never stops, moves or deletes anything.
      </P>
      <List>
        <li>
          <B>Blocks the deploy:</B> a service called <C>egg-&lt;name&gt;.service</C> that Egg did not create; the
          project folder being a link, a file, someone else’s git checkout, or a folder with other files in it; the
          port used by another program; a program or service already running from the project folder; and, for the
          first production deploy only, the same repository already running by hand from another checkout.
        </li>
        <li>
          <B>Good to know, does not block:</B> a stopped service for the same repository, a checkout that is only
          sitting there, leftovers from an earlier Egg project of the same name (they are reused), and ports the
          container would not let it read.
        </li>
      </List>
      <P>
        When something blocks, the form says “Deploy is turned off because N thing(s) on this container is/are in the
        way” and links to Open container status. Tick <B>Start with automatic deploys off</B> when you already run the
        repository on this container by hand. The project is created with automatic deploys off, so the first deploy
        is manual. Nothing turns them on afterwards: when the first deploy works, open Settings, Build and Run and
        tick <B>Deploy automatically on push</B>. This does not import, take over or stop the copy that is already
        running, and Egg does not import a running service yet. If that copy holds the port, stop it yourself first.
      </P>

      <H2 id="container-terminal" />
      <P>
        The terminal is a live shell on your container in the browser, started in{" "}
        <C>~/.egg/&lt;project&gt;</C>. It is off until you turn it on for a server, and turning it on needs a
        Hack Club sign-in from the last 5 minutes. Anything you type runs for real.
      </P>
      {steps("container-terminal-steps", "Open a terminal", [
        { title: "Turn on Terminal", body: "In Account, under Container permissions, then confirm with Hack Club." },
        {
          title: "Open the project’s Terminal tab",
          body: "With the switch off the page says “The terminal is turned off for this server.” and links to Account with a Go to Account button.",
        },
        { title: "Press Open terminal", body: "It shows who the shell runs as, for example “Connected as root” on the host name." },
        {
          title: "Type, then press Close terminal",
          body: "A “Time left” countdown shows the time before the shell closes. Close terminal ends it.",
        },
      ])}
      <List>
        <li>It closes after 10 minutes without input. Output does not count as activity, and neither does resizing.</li>
        <li>It closes after 60 minutes in total, whatever you are doing. A banner warns “This terminal closes in under a minute.”</li>
        <li>
          It closes when you sign out, when another of your sessions is ended, when you delete your account, when you
          switch the terminal off, and when the connection drops or the shell exits.
        </li>
        <li>
          Leaving the page keeps the terminal open until it times out. Come back and press <B>Resume terminal</B>,
          which replays the last 64 KB of output, or <B>Close it</B>.
        </li>
        <li>
          The terminal takes every key while it has focus, including Tab. Press Escape, then Tab, to move focus to
          Close terminal. Copy with Ctrl+Shift+C and paste with Ctrl+V.
        </li>
        <li>Only the opening and closing are recorded, with the duration and the reason. Keystrokes and output never are.</li>
      </List>
      <Table
        caption="How a terminal ends"
        head={["Title on the page", "Why", "Button"]}
        rows={[
          ["Terminal closed after a pause", "10 minutes without typing.", "Reopen terminal"],
          ["Terminal reached its time limit", "60 minutes in total.", "Reopen terminal"],
          ["Terminal closed", "You pressed Close terminal.", "Open a new terminal"],
          ["The shell ended", "The shell exited, for example after typing exit.", "Open a new terminal"],
          ["The connection dropped", "The link to your container was lost.", "Open a new terminal"],
          ["The terminal stopped", "The shell stopped unexpectedly.", "Open a new terminal"],
          ["This terminal is no longer open", "It closed or timed out while you were away.", "Open a new terminal"],
        ]}
      />

      <H2 id="container-files" />
      <P>
        The project’s Files tab browses <C>~/.egg/&lt;project&gt;</C>. Reading and downloading need no switch.
        Creating, uploading, editing, renaming and deleting need File changes on, and work only inside{" "}
        <C>shared/</C>. The live release <C>current/</C> is always read only, as are <C>releases/</C> and{" "}
        <C>incoming/</C>. <C>shared</C> itself cannot be renamed or deleted. A release’s <C>.env</C> is not shown or
        downloaded.
      </P>
      <Table
        caption="The top-level folders of a project"
        head={["Folder", "What it is", "Can you change it"]}
        rows={[
          [<C key="s">shared/</C>, "Survives deploys. Keep uploads and databases here.", "Yes, with File changes on."],
          [<C key="c">current/</C>, "The live release. Replaced on the next deploy.", "Never."],
          [<C key="r">releases/</C>, "Every deployed version, newest last.", "No."],
          [<C key="i">incoming/</C>, "Archives on their way to a release.", "No."],
        ]}
      />
      {steps("container-files-steps", "Change a file", [
        { title: "Turn on File changes", body: "In Account, then confirm with Hack Club." },
        { title: "Open shared/", body: "Uploads and edits are refused anywhere else. Elsewhere the page says “Uploads are not allowed here” and “Open shared/ first.”" },
        {
          title: "Act",
          body: "Use New folder or Upload (or drop files on the list), or select a file and press Edit, change it and press Save. Discard throws the edit away. Rename (or F2) and Delete are in the row. Deleting a folder asks you to type its name.",
        },
        {
          title: "Restart if the app needs to re-read it",
          body: "A change does not restart the app. Press Restart on the Service card when your app reads the file only at start. The app is unavailable for a moment while it restarts.",
        },
      ])}
      <P>
        Code changes belong in your repository, then a deploy. Files that must last, like data or settings, belong in{" "}
        <C>shared/</C>, which deploys never touch. A file you upload over an existing name asks before it replaces
        it. A link is never written through, and a link to a folder opens as a folder.
      </P>
      {why(
        <>
          <C>current/</C> is read only even with File changes on because it is the code your app runs: editing it
          would put code on your container that is in no repository and that the next deploy silently erases.{" "}
          <C>shared/</C> is the one place a deploy never touches, so it is the one place a change can safely last.
        </>
      )}

      {limits("container-limits", [
        ["Terminal idle", "10 minutes", "“Terminal closed after a pause”. Anything running in it was stopped.", "server/terminal.ts (TERMINAL_LIMITS.idleMs)"],
        ["Terminal total", "60 minutes", "“Terminal reached its time limit”.", "server/terminal.ts (TERMINAL_LIMITS.maxAgeMs)"],
        ["Terminals open", "1 per project per person, 5 per account, 50 on the server", "“A terminal is already open for this project. Resume or close it first.”, “You can have 5 terminals open at once. Close one first.” or “Too many terminals are open right now. Try again soon.”", "server/terminal.ts (TERMINAL_LIMITS.maxSessionsPerUser, maxSessions)"],
        ["Terminal input", "8 KB a request, 300 requests a minute", "“Send at most 8192 bytes at a time.” or “Too many requests for terminal input.” Wait and retry.", "server/terminal.ts (inputBytes), server/rate-limit.ts (RATE_LIMITS.terminalInput)"],
        ["Terminal size", "20 to 400 columns, 5 to 200 rows", "“The terminal size must be 20 to 400 columns and 5 to 200 rows.”", "server/terminal.ts (TERMINAL_LIMITS.minCols to maxRows)"],
        ["Terminal output kept", "The last 64 KB", "A reload resumes with that much.", "server/terminal.ts (TERMINAL_LIMITS.bufferBytes)"],
        ["File preview and edit", "The first 1 MB", "A larger file shows “Too large to preview”.", "server/files-paths.ts (READ_LIMIT)"],
        ["File upload and download", "50 MB", "“That file is over the 50 MB limit.” The row says “Over 50 MB”.", "server/files-paths.ts (UPLOAD_LIMIT, DOWNLOAD_LIMIT)"],
        ["Folder listing", "3000 entries", "More are not shown.", "server/files.ts (LIST_LIMIT)"],
        ["Path", "1024 characters, and 255 bytes in one name", "“Path is longer than 1024 characters.” or “A name in the path is longer than 255 bytes.”", "server/files-paths.ts (MAX_PATH_LENGTH, MAX_SEGMENT_BYTES)"],
        ["File reads", "120 a minute", "“Too many file requests.” Wait and retry.", "server/files.ts (FILE_READ_LIMIT)"],
        ["File changes", "60 a minute", "“Too many requests for file changes.” Wait and retry.", "server/rate-limit.ts (RATE_LIMITS.fileWrite)"],
        ["File operation time", "30 seconds, 120 for upload, download and delete", "The request fails with the container’s answer. Try again.", "server/files.ts (timeoutMs)"],
        ["Leftover removal", "50 items a request, 10 requests a minute", "“Remove at most 50 items at a time.”", "server/inventory.ts (MAX_ORPHANS_PER_REQUEST), server/rate-limit.ts (RATE_LIMITS.orphanRemoval)"],
        ["Container reads", "60 seconds a read, 120 seconds for a removal", "The read fails with the SSH message. Press Refresh.", "server/inventory.ts (timeoutMs)"],
        ["Conflict checks", "20 a minute", "“Too many checks. Wait <n> second(s) and try again.”", "app/api/projects/conflicts/route.ts (LIMIT)"],
        ["Build memory", "512 MB to the server’s memory, default 512 MB", "“Build memory must be a whole number of MB from 512 to <max>.”", "lib/build-memory.ts (DEFAULT_CONTAINER_BUILD_MEMORY_MB, buildMemoryRange)"],
        ["Build cap on the container", "The Build memory setting, raised to at least 1024 MB for a project with a build step when the container’s memory minus 512 MB is at least 1024 MB, and never more than the container’s memory minus 512 MB. No build starts under 256 MB.", "“The build did not start: your container reports <n> MB of memory, and 512 MB of that is kept for your app, which leaves too little to build in. Use a larger container.”", "server/deploy/container-build.ts (containerMemoryCapMb, CONTAINER_RESERVE_MB, MIN_CONTAINER_CAP_MB)"],
        ["Build CPU", "0.5 cores to the Nest server’s reported core count, in 0.25-core steps; defaults to 2 or the lower reported count", "“Build CPU must be a number from 0.5 to <max> cores in 0.25-core steps.”", "lib/build-memory.ts (DEFAULT_BUILD_CPUS, buildCpuRange, checkBuildCpu)"],
      ])}

      {wrong("container-wrong", [
        ...SWITCH_OFF,
        ...TERMINAL_PROBLEMS.slice(0, 5),
        ...FILE_PROBLEMS.slice(0, 5),
        ["Egg did not create this, so it was left alone.", "The leftover has no marker. If you are sure, remove it yourself in a terminal."],
        ["This belongs to one of your projects, so it was left alone.", "It is not a leftover. Delete the project first if you want it gone."],
        ["The container’s answer was cut short, so nothing was classified.", "Press Refresh."],
        ["Remove at most 50 items at a time.", "400. Remove in batches."],
        ["Nothing was changed on your container. <details>", "The conflict check refused. The details say what is in the way: choose another name or port, or stop that program yourself."],
        ["Could not read the container.", "The page could not reach the container. Check it is running, then press Refresh."],
        ["Build memory must be a whole number of MB from 512 to <max>.", "400. Type a whole number inside the range in the hint under Build memory (MB). The top of the range is the memory your container reported when Egg last read it, at Test connection or during a deploy."],
        ["The build needed more memory than the cap of <n> MB. Your app is still running.", "The build was stopped with exit 137. Your app was not. The second sentence is added only when a release was already serving. Raise Build memory (MB), press Save and deploy again, or make the build use less memory. The cap never goes above your container’s memory minus 512 MB."],
        ["Could not read the build memory.", "The Build memory card could not load the setting. Reload the page. It does not need the container to be reachable."],
        ["Could not save the build memory.", "The change did not go through. Try Save again."],
      ])}
      <P>
        The rest of the terminal and file messages, with their fixes, are on the{" "}
        <InternalLink href={docsHref("troubleshooting")}>troubleshooting</InternalLink> page.
      </P>

      {example("container-example-leftover", {
        title: "Remove a leftover service",
        given: (
          <>
            You deleted a project named old-api with “Also stop the service” unticked, so <C>egg-old-api.service</C>{" "}
            still runs.
          </>
        ),
        steps: [
          { title: "Turn on Removing leftovers", path: ["Account", "Container permissions", "Removing leftovers"] },
          { title: "Find the row", body: "Open Container and look under Orphans for egg-old-api.service." },
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
      {example("container-example-config", {
        title: "Edit a settings file without a deploy",
        given: (
          <>
            An app that reads <C>shared/config.json</C> when it starts, and File changes switched on.
          </>
        ),
        steps: [
          { title: "Open the file", body: "In the Files tab open shared/ and select config.json." },
          { title: "Edit and save", body: "Press Edit, change the value, press Save." },
          { title: "Restart", body: "Press Restart on the Service card so the app reads it." },
        ],
        result: "The app runs with the new setting. The change is in Activity as “Saved a file on” with the path and no contents.",
      })}
      {related([
        ["account", "Account"],
        ["security", "Security"],
        ["api", "Access tokens and the API"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  limits: () => (
    <Section
      id="limits"
      intro="Every number Egg enforces, grouped by what it limits, with the place in the code that sets it."
    >
      <P>
        Each table has a third column with the setting or constant that holds the number. Paths are inside{" "}
        <C>web/src</C>. If a number here ever disagrees with what you see, the code is right and the page is the bug.
      </P>
      <H2 id="limits-deploys" />
      <Table
        caption="Projects and deploys"
        head={["What", "Limit", "Set in"]}
        rows={[
          ["Servers per account", "5.", <C key="1">MAX_SERVERS_PER_USER, server/servers.ts</C>],
          ["Project name", "1 to 60 characters.", <C key="2">createProjectInput, server/projects.ts</C>],
          ["Project slug", "Lowercase letters, digits and hyphens, 1 to 40 characters, not starting or ending with a hyphen.", <C key="3">SLUG, server/deploy/layout.ts</C>],
          ["Port", "1024 to 65535, and not 20000 to 29999, which previews use.", <C key="4">port, server/projects.ts</C>],
          ["Commands", "500 characters each, on one line.", <C key="5">command, server/projects.ts</C>],
          ["Root directory", "200 characters, relative, no ..", <C key="6">rootDir, server/projects.ts</C>],
          ["Branch name", "200 characters. Letters, digits, dots, underscores, hyphens and slashes, not starting with a hyphen.", <C key="7">branch, server/projects.ts</C>],
          ["Deployments at once", "One per project. Two at a time overall by default. One build at a time on a container.", <C key="8">WORKER_CONCURRENCY, instrumentation.ts, server/deploy/build-lock.ts</C>],
          ["Clone", "5 minutes, on Egg’s machine.", <C key="9">server/deploy/build.ts</C>],
          ["Build", "15 minutes, on your container. It cannot be changed.", <C key="10">BUILD_TIMEOUT_SECONDS, server/deploy/container-build.ts</C>],
          ["Build output", "500 MiB (524,288,000 bytes), measured on the packed archive.", <C key="11">MAX_ARCHIVE_BYTES, server/deploy/build.ts</C>],
          ["Build cap", "On your container, for each build: a CPU cap (2 cores by default), 4096 processes, no swap, and memory (512 MB by default, at least 1024 MB for a project with a build step when the container has room, never more than the container’s memory minus 512 MB). The CPU cap and memory are set for each server.", <C key="12">systemdRunArgs, server/deploy/container-build.ts</C>],
          ["Build memory", "512 MB up to the server’s reported memory, or 8192 MB when it reports none. Default 512 MB.", <C key="12b">lib/build-memory.ts</C>],
          ["Free disk before a build", "2048 MB.", <C key="12c">MIN_FREE_DISK_MB, server/deploy/container-probe.ts</C>],
          ["Build log", "20,000 lines, 4000 characters each.", <C key="13">MAX_LOG_ROWS, server/deploy/logger.ts</C>],
          ["Health wait", "45 seconds after the switch. The service restarts at the switch, so the app is unavailable for a moment. A failed production deploy puts the previous release back.", <C key="14">healthTimeoutSeconds, server/deploy/pipeline.ts</C>],
          ["Production releases kept", "The 5 newest ready ones, plus the live one.", <C key="15">KEEP_RELEASES, server/deploy/layout.ts</C>],
          ["Previews kept", "The 2 newest.", <C key="16">KEEP_PREVIEWS, server/deploy/layout.ts</C>],
          ["Preview ports", "20000 to 29999, one per preview.", <C key="17">PREVIEW_PORT_MIN, PREVIEW_PORT_MAX, server/projects.ts</C>],
          ["Environment variables", "100 per project, names up to 100 characters, values up to 10,000.", <C key="18">envInput, server/projects.ts</C>],
          ["Bulk cancel or delete of previews", "50 per request.", <C key="19">MAX_BULK, server/deployments-bulk.ts</C>],
        ]}
      />
      <H2 id="limits-container" />
      <Table
        caption="Container features"
        head={["What", "Limit", "Set in"]}
        rows={[
          ["Terminal", "Closes after 10 minutes without input or 60 minutes in total.", <C key="1">TERMINAL_LIMITS, server/terminal.ts</C>],
          ["Terminals open", "1 per project per person, 5 per account, 50 on the server.", <C key="2">TERMINAL_LIMITS, server/terminal.ts</C>],
          ["Terminal input", "8 KB a request, 300 requests a minute.", <C key="3">inputBytes, RATE_LIMITS.terminalInput</C>],
          ["Terminal output kept", "The last 64 KB.", <C key="4">bufferBytes, server/terminal.ts</C>],
          ["File preview and edit", "The first 1 MB.", <C key="5">READ_LIMIT, server/files-paths.ts</C>],
          ["File upload and download", "50 MB.", <C key="6">UPLOAD_LIMIT, DOWNLOAD_LIMIT, server/files-paths.ts</C>],
          ["Folder listing", "3000 entries.", <C key="7">LIST_LIMIT, server/files.ts</C>],
          ["File reads", "120 a minute.", <C key="8">FILE_READ_LIMIT, server/files.ts</C>],
          ["File changes", "60 a minute.", <C key="9">RATE_LIMITS.fileWrite, server/rate-limit.ts</C>],
          ["Leftover removal", "50 items a request, 10 requests a minute.", <C key="10">MAX_ORPHANS_PER_REQUEST, server/inventory.ts</C>],
          ["Conflict checks", "20 a minute.", <C key="11">app/api/projects/conflicts/route.ts</C>],
          ["Scheduled jobs", "5 per project. At most one run every 5 minutes. A run is stopped after 30 minutes.", <C key="12">MAX_JOBS_PER_PROJECT, server/scheduled-jobs.ts; MIN_GAP_MINUTES, lib/cron-schedule.ts; JOB_TIMEOUT_SECONDS, server/deploy/jobs-remote.ts</C>],
        ]}
      />
      <H2 id="limits-api" />
      <Table
        caption="Access tokens and the API"
        head={["What", "Limit", "Set in"]}
        rows={[
          ["Active tokens", "25 per account. Revoked and expired ones do not count.", <C key="1">MAX_TOKENS_PER_USER, server/api-tokens.ts</C>],
          ["Token name", "1 to 60 characters.", <C key="2">createTokenInput, server/api-tokens.ts</C>],
          ["Token life", "7, 30, 90 or 365 days. 90 is the default.", <C key="3">createTokenInput, server/api-tokens.ts</C>],
          ["Terminal or file changes", "A token holding either lives 7 days at most.", <C key="4">SHORT_LIVED_MAX_DAYS, server/api-tokens.ts</C>],
          ["Reads", "120 a minute per token.", <C key="5">API_LIMITS.read, server/api-v1-kit.ts</C>],
          ["Changes", "30 a minute per token.", <C key="6">API_LIMITS.write</C>],
          ["Calls that open a session to your container", "10 a minute per token.", <C key="7">API_LIMITS.ssh</C>],
          ["Terminal input through the API", "300 a minute per token.", <C key="8">API_LIMITS.input</C>],
          ["Invalid tokens", "60 a minute per address. Counted only when TRUST_PROXY is on.", <C key="9">RATE_LIMITS.badToken, server/rate-limit.ts</C>],
          ["Request body", "16 KB. A file write takes 4 MB, terminal input 64 KB, webhooks 4 KB and the MCP endpoint 64 KB.", <C key="10">DEFAULT_MAX_BODY_BYTES, server/api-v1-kit.ts</C>],
          ["File write through the API", "1 MB. A download is 2 MB.", <C key="11">server/api-v1-shell.ts</C>],
          ["List sizes", "Deployments 1 to 100, runtime log lines 1 to 1000, build log lines 1 to 1000, activity 1 to 100, analytics 1 to 90 days, resource history 1 to 168 hours.", <C key="12">query fields in server/api-v1*.ts</C>],
          ["Webhooks", "10 per account.", <C key="13">MAX_WEBHOOKS_PER_USER, server/webhooks.ts</C>],
        ]}
      />
      <H2 id="limits-watch" />
      <Table
        caption="Watching and history"
        head={["What", "Limit", "Set in"]}
        rows={[
          ["Uptime checks", "Every 5 minutes by default. Down after 2 failed checks in a row, which you can set from 1 to 10 per project.", <C key="1">MONITOR_INTERVAL_MS, server/jobs.ts</C>],
          ["Alert limits", "Disk, memory and CPU 1 to 100, default 90. Slow response 50 to 60000 ms.", <C key="2">server/notify.ts</C>],
          ["Resource history", "Sampled every 5 minutes, kept 7 days, shown for 24 hours or 7 days.", <C key="3">SAMPLE_KEEP_MS, server/monitor.ts</C>],
          ["Runtime logs", "Up to 300 lines shown, and 300 more each time you press Load older lines. A search or the Warnings and errors level reads up to 1000 lines for each read.", <C key="4">components/logs-view.tsx, lib/log-page.ts</C>],
          ["Alert history", "The newest 50 shown, kept 90 days.", <C key="5">ALERT_KEEP_MS, server/notify.ts</C>],
          ["Analytics history", "30, 60 or 90 days for each project, 90 by default.", <C key="6">retentionDays, server/analytics-config.ts; prunePageviews, server/analytics.ts</C>],
          ["Funnel", "2 to 6 steps.", <C key="7">MIN_STEPS, MAX_STEPS, server/analytics-config.ts</C>],
          ["Analytics events", "30 per 10 seconds per project and address. Page views are 1 per second. With TRUST_PROXY off every visitor shares one address.", <C key="8">server/analytics-events.ts, server/analytics.ts</C>],
          ["Analytics fields", "Allowed campaign values up to 20 each for source, medium and campaign, 40 characters each, event value 40, error message 200, 5 errors per page view. Speed and returning-visitor figures need 50 page views and 20 visitors.", <C key="8b">server/analytics-fields.ts, server/analytics-retention.ts</C>],
          ["Live view and retention", "A 5 minute window. Signals are kept 1 hour. The retention code changes every 90 days.", <C key="8c">server/analytics.ts (LIVE_WINDOW_MS, LIVE_KEEP_MS, RETENTION_PERIOD_MS)</C>],
          ["Status page", "30 days and the latest 10 outages.", <C key="9">server/status-page.ts</C>],
          ["Webhook delivery", "3 attempts, 5 seconds each, history kept 30 days.", <C key="10">MAX_ATTEMPTS, DELIVERY_RETENTION_MS, server/webhooks.ts</C>],
          ["Deployments page", "All projects: the newest 100, shown 25 at a time. One project’s tab: 25 at a time with Load older, and search and filters run on the server.", <C key="11">server/queries.ts, server/deployment-page.ts, components/deployments-view.tsx</C>],
          ["Activity", "50 a page. A search reads the newest 5000. An export is 5000 entries and 10 a minute.", <C key="12">PAGE_SIZE, SCAN_LIMIT, EXPORT_ROW_LIMIT</C>],
        ]}
      />
      <H2 id="limits-account" />
      <Table
        caption="Sign-in"
        head={["What", "Limit", "Set in"]}
        rows={[
          ["Session", "30 days.", <C key="1">SESSION_DAYS, server/auth/session.ts</C>],
          ["Fresh sign-in", "5 minutes.", <C key="2">REAUTH_WINDOW_MS, server/auth/session.ts</C>],
          ["Sign-in handshake", "10 minutes.", <C key="3">app/api/auth/login/route.ts</C>],
          ["Sign-in attempts", "20 a minute per address. Counted only when TRUST_PROXY is on.", <C key="4">RATE_LIMITS.signIn, server/rate-limit.ts</C>],
          ["Dashboard JSON request", "256 KB.", <C key="5">JSON_BODY_LIMIT, server/body-limit.ts</C>],
        ]}
      />
      {why(
        <>
          Each allowance is counted against the thing that can misbehave. An access token has its own counts, so one
          noisy script cannot use up the allowance of another script or of you in the browser. Terminal and file
          requests are counted per account because the container behind them is shared by every project you have.
          Bad tokens are counted per address, because a token that does not check out has no account to count against.
          The counters live in the memory of the running process, so a restart of Egg clears them, and a copy of Egg
          that runs several processes counts in each one.
        </>
      )}
      {wrong("limits-wrong", [
        ["Too many requests for this token. Wait <n> second(s) and try again.", "429. A token went over its reads, changes, container sessions or terminal input. Wait for the seconds in the Retry-After header."],
        ["Too many requests for unrecognised access tokens. Wait <n> second(s) and try again.", "429. 60 tokens that did not check out came from one address in a minute. Fix the token your script sends."],
        ["Too many requests for terminal input. Wait <n> second(s) and try again.", "429. 300 input requests a minute for your account."],
        ["Too many file requests. Wait <n> second(s) and try again.", "429. Listing, reading and downloading are 120 a minute."],
        ["Too many requests for file changes. Wait <n> second(s) and try again.", "429. Creating, writing, renaming and deleting are 60 a minute."],
        ["Too many exports. Wait <n> second(s) and try again.", "429. 10 CSV exports a minute."],
        ["Too many checks. Wait <n> second(s) and try again.", "429. 20 conflict checks a minute."],
        ["You can connect up to 5 servers.", "Disconnect one you no longer use."],
        ["You can have up to 25 active tokens. Revoke one first.", "Revoke a token you no longer use."],
        ["You can have up to 10 webhooks. Delete one first.", "Delete a webhook you no longer use."],
        ["A project can have up to 100 variables.", "Delete a variable you do not need."],
      ])}
      <Callout tone="note" title="Your container’s size">
        How much CPU, memory and disk your Nest container has is set by Nest, not by Egg. Test connection and the
        Container page show what it has.
      </Callout>
      {example("limits-example", {
        title: "Poll a deploy without hitting a limit",
        given: "A script that starts a deploy and waits for it to finish.",
        steps: [
          { title: "Start it", body: "One POST to the deployments endpoint is one of your 30 changes a minute." },
          { title: "Poll", body: "List the project’s deployments every 2 seconds. That is 30 reads a minute, a quarter of the 120 allowed." },
          { title: "Back off", body: "On a 429, wait for the seconds in the Retry-After header, then carry on." },
        ],
        result: "The script finishes a normal build without a 429. Fetching the build log counts against the smaller 10 a minute allowance, so ask for it once the deploy is done.",
      })}
      {related([
        ["security", "Security"],
        ["api", "Access tokens and the API"],
        ["container", "Container, terminal and files"],
      ])}
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  selfhost: () => (
    <Section
      id="selfhost"
      intro="Egg is open source. You can run your own copy, with your own database, secret and worker."
    >
      <P>
        You need Node.js and pnpm. This page lists what the code reads. The{" "}
        <ExternalLink href={repoLink("docs/selfhost/README.md")}>self-hosting guide</ExternalLink> walks through a
        private install on your own computer and a server run with Docker Compose, the{" "}
        <ExternalLink href={repoLink("docs/selfhost/customising.md")}>customising guide</ExternalLink> lists the
        files to change for the name and the wording, and the{" "}
        <ExternalLink href={setupDoc}>backend setup guide</ExternalLink> has the Hack Club and GitHub registration
        steps in full.
      </P>
      <H2 id="selfhost-start" />
      {steps("selfhost-start-steps", "Start it locally", [
        {
          title: "Install and set up",
          body: (
            <>
              From the <C>web</C> folder, <C>pnpm run setup</C> writes <C>.env.local</C> with a fresh{" "}
              <C>APP_SECRET</C>. It never overwrites an existing file. Use <C>pnpm run setup</C>, not{" "}
              <C>pnpm setup</C>: pnpm has a built-in command of that name that does something else.
            </>
          ),
          code: { label: "Terminal", code: "cd web\npnpm install\npnpm run setup" },
        },
        {
          title: "Pick a way to sign in",
          body: (
            <>
              Setup writes <C>LOCAL_MODE=1</C>, so the login page gets a <B>Sign in on this computer</B> button and you
              need no external account. On first use, enter the generated <C>LOCAL_MODE_SECRET</C> from <C>.env.local</C>
              and choose a password; use that password for later sign-ins.
              Or set the Hack Club values to use Hack Club sign-in. Development sign-in is off by default.
            </>
          ),
        },
        {
          title: "Start it",
          body: (
            <>
              <C>pnpm egg start</C> creates <C>.env.local</C> if it is missing, checks the computer, builds Egg itself
              the first time, which makes that first start slower and uses your computer’s CPU and disk, starts it on
              the port in <C>APP_URL</C> and opens the browser. Setup turns on{" "}
              <C>RUN_WORKER=1</C>, so the queue runs in the same process. Ctrl+C stops it. Add <C>--dev</C> to run the
              development server instead.
            </>
          ),
          code: { label: "Terminal", code: "pnpm egg start" },
        },
        {
          title: "Try deploys without a Nest account",
          body: (
            <>
              Run <C>pnpm fake-nest</C> in a second terminal. Set <C>NEST_HOST=127.0.0.1</C> and{" "}
              <C>NEST_PORT=2222</C>, plus the <C>UNIT_DIR</C> value it prints, before you add the server. It is for trying things out only, never a
              substitute for a real Nest container. On Windows it runs its commands in WSL. The first Test connection
              still asks you to confirm the host key.
            </>
          ),
        },
      ])}
      <P>
        <C>pnpm run doctor</C> only checks the computer and starts nothing. A cross stops Egg from starting. A warning
        does not: for example, a missing optional tool is shown as a warning, and Egg itself starts without it. You can also run <C>pnpm build</C> and then <C>pnpm start</C> yourself. The database
        changes apply the first time a new version opens the file.
      </P>
      <P>
        Your data is one file, <C>web/data/egg.db</C>. It stays on disk when Egg stops. Back it up together
        with <C>APP_SECRET</C>, because the file cannot open your sealed keys without it.
      </P>

      {why(
        <>
          Local mode is off unless you set <C>LOCAL_MODE=1</C>. It requires a private <C>LOCAL_MODE_SECRET</C> of at
          least 32 characters to set or recover the owner password. Keep the recovery key private. It also refuses to start unless <C>APP_URL</C>
          is localhost, <C>127.0.0.1</C> or <C>::1</C>.{" "}
          <C>LOCAL_MODE_ALLOW_REMOTE=1</C> exists for a copy behind a VPN or an access proxy you control, where
          something else decides who can reach the site.
        </>
      )}

      <H2 id="selfhost-login" />
      <P>
        <C>pnpm run service:install</C> writes one file that starts Egg when you sign in to your computer. It is
        optional. Nothing starts until you run the command it prints. Run <C>pnpm egg start</C> once first, so a build
        exists, then press Ctrl+C. <C>pnpm run service:remove</C> stops the service and deletes the file.
      </P>
      <List>
        <li>
          <B>macOS.</B> A LaunchAgent at <C>~/Library/LaunchAgents/app.egg.web.plist</C>. Turn it on with{" "}
          <C>launchctl bootstrap gui/$(id -u)</C> and that file. The log is <C>~/Library/Logs/egg.log</C>.
        </li>
        <li>
          <B>Linux.</B> A systemd user unit at <C>~/.config/systemd/user/egg.service</C>. Turn it on with{" "}
          <C>systemctl --user enable --now egg</C>. To start at boot without signing in, run{" "}
          <C>loginctl enable-linger</C>.
        </li>
        <li>
          <B>Windows.</B> A script at <C>%LOCALAPPDATA%\Egg\egg-task.ps1</C>. Run it to register a Scheduled Task
          named Egg that runs <C>pnpm start</C> at sign-in.
        </li>
      </List>

      <H2 id="selfhost-config" />
      <Table
        caption="Settings the code reads"
        head={["Setting", "What it does"]}
        rows={[
          [<C key="1">APP_SECRET</C>, "Required, 32 or more characters. Seals SSH keys and variables. Back it up: losing or changing it makes stored keys unreadable."],
          [<C key="2">APP_URL</C>, "The public address. Used for sign-in redirects, hook URLs and links. Default http://localhost:3000."],
          [<C key="3">DATABASE_URL</C>, "The SQLite file. Default file:./data/egg.db. Migrations apply on startup."],
          [<C key="4">HACKCLUB_CLIENT_ID, HACKCLUB_CLIENT_SECRET</C>, "From a Hack Club Auth app. Without them the Continue with Hack Club button is off."],
          [<C key="5">LOCAL_MODE</C>, "1 or true enables password-based owner sign-in without an external account. Off by default. Refused unless APP_URL is localhost, 127.0.0.1 or ::1."],
          [<C key="5b">LOCAL_MODE_SECRET</C>, "Required in local mode; a private random recovery key of at least 32 characters for first-time setup and password reset. Setup generates it for new installations."],
          [<C key="6">LOCAL_MODE_ALLOW_REMOTE</C>, "1 lets LOCAL_MODE run on another address. Use it only behind a VPN or access proxy you control."],
          [<C key="6b">TRUST_PROXY</C>, "Off by default. 1 or true makes Egg believe X-Forwarded-For and X-Real-IP for the visitor’s address. Set it to 1 only when every request reaches Egg through a reverse proxy you run that sets those headers itself. Without it, every visitor counts as one address for analytics, and the sign-in and invalid-token limits do not apply."],
          [<C key="7">DEV_LOGIN</C>, "1 shows a fake sign-in in pnpm dev. It is ignored in a production build."],
          [<C key="8">GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET</C>, "All six are needed for private repositories, the repository picker and deploys on push. The private key may use \\n escapes."],
          [<C key="9">RUN_WORKER</C>, "1 runs the queue inside the web process. Anything else means no builds run there. Use pnpm worker."],
          [<C key="10">WORKER_CONCURRENCY</C>, "Deployments at once. Default 2. One project never builds twice at a time. Read by the worker, not by config.ts."],
          [<C key="14">DEPLOY_WORK_DIR</C>, "Where builds are cloned. Default ./data/work."],
          [<C key="15">MONITOR_INTERVAL_MS</C>, "How often uptime and usage are checked. Default 300000. 0 turns the checks off."],
          [<C key="16">NEST_HOST, NEST_PORT, UNIT_DIR</C>, "Nest’s SSH host (hackclub.app, 22) and where systemd units are written (/etc/systemd/system). Change only for testing."],
        ]}
      />
      <P>
        Build memory is not a setting in the file. It is per server, on that server’s Container page. See{" "}
        <InternalLink href={docsHref("container")}>Container, terminal and files</InternalLink>.
      </P>

      <H2 id="selfhost-worker" />
      <P>
        The worker takes queued deployments and runs the uptime monitor. It polls every second and never runs two jobs
        of one project at once. With <C>RUN_WORKER=1</C> it lives inside the web process. For production you can set{" "}
        <C>RUN_WORKER=0</C> and run <C>pnpm worker</C> on another machine. It finishes running jobs when it gets
        SIGINT or SIGTERM. Every project needs a worker, because the worker clones the repository and runs the
        container build over SSH. The build itself runs on the project’s own container, so the machine that runs the
        worker needs no Docker.
      </P>
      <P>
        What a deployment costs the worker’s machine: a clone and a packed copy of the source in{" "}
        <C>DEPLOY_WORK_DIR</C>, kept until the deployment ends, and an upload over SSH. Two deployments can run at
        once by default. Set <C>WORKER_CONCURRENCY=1</C> to allow one at a time. The install and build use the
        container’s memory and CPU, under the cap set for that server.
      </P>
      <P>
        A worker renews a lease on its running job every 15 seconds. If the lease is 60 seconds old, Egg logs a
        warning and leaves the job running, because commands it started on your container may still be changing
        files. That deployment keeps its project blocked until you recover it by hand. See{" "}
        <ExternalLink href={repoLink("docs/selfhost/README.md")}>Recovering a stale deployment</ExternalLink> in the
        self-hosting guide.
      </P>
      <Callout tone="warning" title="Without a worker, nothing builds">
        If <C>RUN_WORKER</C> is not <C>1</C> and no <C>pnpm worker</C> is running, deployments stay queued, and uptime
        checks and resource history do not run.
      </Callout>
      {why(
        <>
          The queue is a table in the database, and a job is claimed with one conditional update, so two workers can
          share it and neither takes the same job. Builds are kept off the web process on purpose when you can: a
          long build then cannot slow the pages. One process is still enough for one person, which is why setup
          turns the embedded worker on.
        </>
      )}

      <H2 id="selfhost-database" />
      <P>
        The database is one SQLite file at <C>DATABASE_URL</C>. Users, servers, projects, deployments, logs, jobs and
        history are all in it. Back up the file together with <C>APP_SECRET</C>: the file alone cannot open your sealed
        keys, and the secret alone has nothing to open. Keep them in different places if the backup leaves your
        machine. Stop Egg before you copy the file, and copy any <C>-wal</C> or <C>-shm</C> files beside it. Foreign
        keys are on, so deleting a server record deletes its projects.
      </P>

      <H2 id="selfhost-apps" />
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

      <H2 id="selfhost-server" />
      <P>
        To run Egg on a Linux server, use Docker Compose. You need Docker and Docker Compose, a domain that points at
        the server, and ports 80 and 443 open. Caddy sits in front of the app, and gets and renews HTTPS by itself on
        ports 80 and 443, and 443/udp for HTTP/3. The app is not reachable on any other port.
      </P>
      {steps("selfhost-server-steps", "Start it on a server", [
        {
          title: "Get the code and the settings file",
          body: "Clone the repository and copy the example file to .env in the repository root.",
          code: { label: "Terminal", code: "git clone https://github.com/jeremy341/egg.git\ncd egg\ncp deploy/.env.example .env" },
        },
        {
          title: "Set the address and the secret",
          body: (
            <>
              In <C>.env</C>, set <C>APP_URL</C> (starting with https://), <C>APP_HOST</C> (the same name without
              https://) and <C>APP_SECRET</C>. Make the secret with the command below and back it up.
            </>
          ),
          code: { label: "Terminal", code: "openssl rand -base64 32" },
        },
        {
          title: "Make the data folder",
          body: (
            <>
              The Docker containers that run Egg use user 1000, so that user must own the data folder. The path must
              match <C>EGG_DATA_DIR</C>.
            </>
          ),
          code: { label: "Terminal", code: "sudo mkdir -p /srv/egg/data && sudo chown -R 1000:1000 /srv/egg/data" },
        },
        {
          title: "Start it",
          body: (
            <>
              From <C>web/</C>, <C>pnpm run compose:up</C> does the same.
            </>
          ),
          code: { label: "Terminal", code: "docker compose up -d --build" },
        },
      ])}
      <Callout tone="note" title="Nothing is built on this server">
        The <C>worker</C> service in the Compose file runs every deployment. It clones the repository, packs the
        source and sends it to the project’s Nest container, where the install and build run under a cap. So no
        service here needs Docker access or extra privileges, and the worker starts with the rest. Without a running
        worker, deployments stay queued.
      </Callout>
      <P>
        The example file sets <C>TRUST_PROXY=1</C>, because every request comes through Caddy. Do not publish the app
        port yourself. <C>sh deploy/backup.sh</C> (or <C>pnpm run backup</C>) makes a consistent copy while Egg runs,
        gzips it into <C>backups/</C> and keeps the newest 14. <C>sh deploy/upgrade.sh</C> backs up first, pulls,
        rebuilds and restarts. Database changes apply when the app starts.
      </P>
      <P>
        Security on a server: a signed-in JSON request is limited to 256 KB. One address may make 20 sign-in attempts a
        minute and 60 requests a minute with unrecognised tokens, counted only when <C>TRUST_PROXY</C> is on. The
        content policy still allows inline scripts, and the nonce fix is open. See{" "}
        <InternalLink href={docsHref("security")}>Security</InternalLink>.
      </P>

      <H2 id="selfhost-platforms" />
      <Table
        caption="What works where"
        head={["System", "Support"]}
        rows={[
          ["Windows", "Full. pnpm fake-nest needs WSL."],
          ["Linux", "Full."],
          ["macOS", "The same as Linux."],
        ]}
      />
      <P>
        The CI workflow runs the typecheck, lint, tests and the dependency audit on Linux and macOS. The audit fails
        the Linux run on a high finding and only reports it on macOS.
      </P>

      {limits("selfhost-limits", [
        ["Concurrent deployments", "2 by default", "Set WORKER_CONCURRENCY to change it.", "instrumentation.ts (WORKER_CONCURRENCY)"],
        ["Build time", "15 minutes, on the container. It cannot be changed.", "“The build took longer than 15 minutes and was stopped.”", "server/deploy/container-build.ts (BUILD_TIMEOUT_SECONDS)"],
        ["Build memory and CPU", "512 MB (at least 1024 MB for a project with a build step, when the container has room) and 2 cores by default for each server; both are configurable", "The kernel stops the build at its cap. With memory, exit 137 and “The build needed more memory than the cap of <n> MB.”", "server/deploy/container-build.ts (systemdRunArgs), lib/build-memory.ts"],
        ["Uptime check", "Every 300000 ms by default", "Set MONITOR_INTERVAL_MS to 0 to stop checks.", "server/jobs.ts (MONITOR_INTERVAL_MS)"],
        ["Secret length", "32 characters at least", "“APP_SECRET must be at least 32 characters”", "server/config.ts (APP_SECRET)"],
      ])}

      {wrong("selfhost-wrong", [
        ["Invalid environment configuration", "The first request or the worker start checks every setting, and the lines under it name the one that is wrong. Fix it, or run pnpm run setup."],
        ["APP_SECRET must be at least 32 characters", "Use a longer secret. pnpm run setup makes one."],
        [
          "LOCAL_MODE signs anyone in as the owner, so APP_URL must be localhost or 127.0.0.1. Set APP_URL to a local address, or set LOCAL_MODE_ALLOW_REMOTE=1 if you control who can reach the site.",
          "Set APP_URL=http://localhost:3000, or read the override above before you set LOCAL_MODE_ALLOW_REMOTE.",
        ],
        ["The recovery key is incorrect.", "Enter the LOCAL_MODE_SECRET from your private .env.local file."],
        ["The login page has no Sign in on this computer button", "LOCAL_MODE is not 1 or true, or Egg was not restarted after the change. Edit .env.local and restart."],
        ["The GitHub App is not configured.", "Set all six GITHUB_APP settings and GITHUB_WEBHOOK_SECRET."],
        ["webhook not configured", "The webhook route answers 503 until GITHUB_WEBHOOK_SECRET is set."],
        ["Hack Club sign-in is not set up on this installation yet.", "Set HACKCLUB_CLIENT_ID and HACKCLUB_CLIENT_SECRET, or use local mode."],
        ["Egg did not start. Fix the lines marked with a cross, then run this again.", "The doctor found a problem that stops Egg. Read the Fix line under each cross. pnpm run doctor shows the same list."],
        ["Port 3000 is already in use", "Another program uses the port in APP_URL. Stop it, or change the port in APP_URL in .env.local."],
        ["Deployments stay Queued on a server", "The worker service is not running. Run docker compose ps, then docker compose up -d. Read its output with docker compose logs worker."],
        ["Deployments stay Queued", "No worker is running. Set RUN_WORKER=1, or start pnpm worker."],
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
      {example("selfhost-example-local", {
        title: "Run a private copy on your laptop",
        given: "A laptop with Node.js and pnpm, and a Nest container to deploy to.",
        steps: [
          { title: "Set up", body: "Run pnpm install and pnpm run setup in the web folder." },
          { title: "Check local mode", body: "Setup wrote LOCAL_MODE=1 and LOCAL_MODE_SECRET to .env.local. Add a random secret of at least 32 characters to older files." },
          { title: "Start", body: "Run pnpm egg start. It checks the computer, builds the first time and opens the browser." },
          { title: "Sign in", body: "Use LOCAL_MODE_SECRET from .env.local to set your password on first use, then sign in with that password." },
        ],
        result:
          "You land on Projects as the owner. Connect your Nest username, paste the key into the Nest dashboard, press Test connection, and deploy as usual.",
      })}
      {related([
        ["security", "Security"],
        ["limits", "Limits"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),

  /* ---------------------------------------------------------------- */
  troubleshooting: () => (
    <Section
      id="troubleshooting"
      intro="One entry per message Egg shows, with the fix. Find the heading for what you were doing."
    >
      <P>
        Messages are quoted as the product prints them. A part in angle brackets, such as <C>&lt;n&gt;</C>, is filled
        in with a name or a number. Where a message comes with a status code, the code is the first thing in the fix.
      </P>
      {wrong(
        "troubleshooting-connection",
        [
          ["Nest rejected the key. Check that you pasted the public key on the SSH Keys page of the Nest dashboard, and that the username is exactly your Nest username.", "Paste the public key again, exactly as shown. After New key, the old one is dead. Check the username."],
          ["Timed out connecting to Nest. Your container may be stopped or starting; try again in a minute.", "Wait a minute and press Test connection again."],
          ["Could not reach the Nest SSH host (<reason>).", "The reason is the network error. Try again later."],
          ["Confirm host key", "The first Test connection stops here on purpose. Check the fingerprint against the one Nest shows for your server, then press Confirm host key."],
          ["Confirm host key: open the Connect page, check the fingerprint of this server and confirm it first.", "409. A deploy, file change or terminal was tried before the host key was confirmed. Open Connect, press Test connection, then Confirm host key."],
          ["The host key of <host> changed (was <old>, now <new>). Nothing was sent. If you expected this, reconnect the server.", "This stops on purpose. Disconnect and add the server again. The box asks whether to keep or delete the server’s projects. You confirm the new fingerprint on the next Test connection."],
          ["SSH error: <message>", "Anything else. Read the message, then try again."],
          ["That does not look like a Nest username. Use the name you log in with, for example sam-r.", "Use letters, digits, dot, underscore and hyphen, starting with a letter or digit, up to 32 characters."],
          ["<name> is already connected.", "One server per Nest username. Use the one you have."],
          ["<name> is disconnected. Connect it again to manage its projects.", "409. You disconnected it and kept its projects. Connect the same username again."],
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
          ["Could not clone the repository. Check the branch name and that Egg has access to it.", "Check the production branch in Settings and, for a private repository, that the GitHub app is installed on it."],
          ["The root directory \"<dir>\" does not exist in this repository.", "Fix Root directory in Settings, Build and Run."],
          ["The build failed (exit <code>).", "Read the log above it. The usual causes are a missing lockfile or build script, the wrong root directory, or a command that needs a variable you have not set."],
          ["The build timed out.", "The clone took longer than 5 minutes. The limit is fixed. Nothing changes on your container."],
          ["The build took longer than 15 minutes and was stopped. Your app is still running.", "The build on your container ran past 15 minutes. Make the build faster. This limit is fixed. “Your app is still running.” is added only when a release was already serving. Egg deletes the new release folder."],
          ["The build needed more memory than the cap of <n> MB. Your app is still running.", "Exit 137. The build went over its cap and was stopped, and your app was not. Raise Build memory (MB) on the Container page and deploy again, or use less memory in the build. The cap never goes above your container’s memory minus 512 MB."],
          ["The build did not start: your container reports <n> MB of memory, and 512 MB of that is kept for your app, which leaves too little to build in. Use a larger container.", "The cap would be under 256 MB. Egg keeps 512 MB of your container’s memory for your app, so a container with under 768 MB cannot build."],
          ["Another build has been running on this container for more than 30 minutes, so this one did not start. Your app is still running.", "One build runs at a time on a container. Wait for the other build to finish or cancel it, then deploy again."],
          ["Egg could not check your container before building, so nothing was uploaded. Check that the container is running and try again.", "The check before the upload got no answer. Check the Container page and Test connection, then deploy again."],
          ["Free up disk space on your container: <n> MB is free and a build needs at least 2048 MB.", "Delete files you do not need on your container, then deploy again. Nothing was uploaded."],
          ["Builds on your container run under a memory cap with systemd-run, which is not installed here, so the build did not start. Install systemd.", "Your container has no systemd-run, which the cap needs. Install systemd."],
          ["Your container cannot apply a memory cap to a build (it needs systemd with cgroup v2 and the memory controller), so the build did not start rather than run without a limit.", "Egg does not run a build without a limit. Use a container with systemd, cgroup v2 and the memory controller."],
          ["Install coreutils on your container: sudo apt install coreutils (the build needs the timeout command).", "Run the command on your container, then deploy again."],
          ["Install Node.js <version> or newer on your container (nodejs.org), then deploy again.", "No Node.js was found. <version> is 22.13 when the project has no engines range. With a range, the line says: Install Node.js on your container (this project needs <range>), then deploy again."],
          ["Node.js <installed> on your container does not match what this project needs (<wanted>). Install a matching Node.js on your container (nodejs.org), then deploy again.", "<wanted> is the engines range in package.json, or >=22.13 when there is none."],
          ["Install npm on your container: sudo apt install npm (installing Node.js from nodejs.org includes it).", "Run the command, then deploy again."],
          ["This project uses <pnpm or yarn>, which needs corepack. On your container run: npm install -g corepack", "Run the command, then deploy again."],
          ["Install Python 3 on your container: sudo apt install python3", "Run the command, then deploy again."],
          ["Install python3-venv on your container: sudo apt install python3-venv", "Run the command, then deploy again. On Debian and Ubuntu venv is a separate package."],
          ["Build memory must be a whole number of MB from 512 to <max>. Change it on the Container page.", "The saved build memory no longer fits the range, for example after the server reported less memory. Open Container, set Build memory (MB) inside the range and press Save."],
          ["The output folder \"<dir>\" was not created by the build.", "Set Output directory to the folder your build really writes."],
          ["The build output is <n> MB, over the 524.288 MB limit.", "Leave out what the app does not need to run. The limit is 500 MiB (524,288,000 bytes), measured on the packed archive. Nothing was uploaded to your container."],
          ["Set a start command for this project (for example ./my-binary).", "A Custom command project needs a Start command."],
          ["Static sites need Python 3 or Node.js on your Nest container to be served.", "Install one of them on the container."],
          ["A deployment stays on Building or Deploying and nothing moves", "The worker that owned it stopped. Egg does not free the job on its own, because commands it started on your container may still be running, and that project cannot start another deployment. Only the person who runs Egg can fix it: see Recovering a stale deployment in the self-hosting guide."],
          ["No free preview ports on this server.", "All of 20000 to 29999 are in use. Delete old previews."],
          ["Further log output was dropped: this deployment reached its log limit.", "The log holds 20,000 lines. Make the build print less. The build itself carried on."],
        ],
        subsectionTitle("troubleshooting-build")
      )}

      {wrong(
        "troubleshooting-no-answer",
        [
          ["The new release did not become healthy on port <port>. Make sure your app listens on the PORT environment variable and on 0.0.0.0.", "Listen on PORT and on 0.0.0.0, not only localhost. The log shows the last 30 lines of the app’s output. For a production deploy, the previous release is put back, so the app is unavailable for a short time while the new release starts and again while the old one returns."],
          ["Service crashed on start", "The service failed before the wait ended. Read the output printed under it."],
          ["The previous release did not come back either. Check the logs.", "Open Logs and read the runtime lines, then redeploy or use Instant rollback to an earlier release."],
        ],
        subsectionTitle("troubleshooting-no-answer")
      )}
      <P>
        A health path that answers with anything from 200 to 499 counts as healthy, so a 404 passes. Only 500 and above
        fails.
      </P>

      <H2 id="troubleshooting-adopt" />
      {wrong(
        "troubleshooting-adopt-list",
        [
          ["Nothing was changed on your container. <details>", "The conflict check refused. The details say what is in the way. Choose another name or port, or stop that program yourself first."],
          ["A service called egg-<slug>.service already exists and Egg did not create it. It will not be replaced. Choose another project name.", "Rename the project."],
          ["Port <n> is already in use by <process>. Egg will not stop it. Choose another port, or stop that program yourself first.", "Pick another port, or stop that program."],
          ["<path> already exists and was not created by Egg, so it was left alone.", "Pick another name, or move that folder yourself."],
          ["Could not check this container just now: <reason>. The deploy checks again before it changes anything.", "Try again in a moment."],
          ["Too many checks. Wait <n> second(s) and try again.", "429. The check is 20 a minute for your account."],
        ],
        "The conflict check",
        3
      )}

      <H2 id="troubleshooting-project" />
      {wrong(
        "troubleshooting-project-list",
        [
          ["You already have a project called \"<slug>\".", "Pick another name."],
          ["Port <n> is already used by another project on this server.", "Pick another port. In Settings the same refusal reads “Port <n> is already used on this server.”"],
          ["Ports 20000 to 29999 are reserved for previews", "Choose a port from 1024 to 19999 or 30000 to 65535."],
          ["The project name must use lowercase letters, digits and hyphens (up to 40).", "Fix the name. The slug is at most 40 characters."],
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

      <H2 id="troubleshooting-rollback" />
      {wrong(
        "troubleshooting-rollback-list",
        [
          ["That release was removed from your server to save space.", "Only 5 production releases are kept. Deploy the commit again."],
          ["That deployment is already live.", "Pick an earlier one."],
          ["Only production deployments can be rolled back to.", "Choose a production deployment."],
          ["That deployment never finished, so there is nothing to roll back to.", "Choose one that was Ready."],
          ["The older release did not become healthy, so nothing was changed.", "The release that was live is still live. Check the older release’s logs."],
          ["That deployment is already finished.", "Cancel works only while a deployment is Queued, Building or Deploying."],
          ["Only old previews that are not live or removed can be deleted in bulk.", "409. Pick previews that are finished and not the current one."],
        ],
        "Rollback and cancel messages",
        3
      )}

      <H2 id="troubleshooting-env" />
      {wrong(
        "troubleshooting-env-list",
        [
          ["Names use letters, digits and underscores, and do not start with a digit", "Rename the variable."],
          ["That name is set by Egg", "PORT, HOST, PATH, HOME and EGG are reserved."],
          ["A project can have up to 100 variables.", "Delete one you do not need."],
          ["No example env file (such as .env.example) was found in the repository.", "Add .env.example, or type the names by hand."],
        ],
        "Variable messages",
        3
      )}
      <P>
        A saved change reaches your app at the next deployment. Redeploy to apply it. A variable with an empty value
        is left out of the app’s environment rather than set to an empty string.
      </P>

      <H2 id="troubleshooting-domain" />
      {wrong(
        "troubleshooting-domain-list",
        [
          ["No CNAME found yet. Create one pointing to <target>, or add a TXT record with the value domain-verification=<name>. DNS changes can take a few minutes.", "Add the CNAME or the TXT record at your DNS provider, wait, and press Check."],
          ["The CNAME points to <x>. It should point to <target>.", "Change the CNAME value."],
          ["The name does not resolve yet. Add it in the Nest dashboard first.", "Add the domain and port on the Domains page of the Nest dashboard."],
          ["DNS could not be checked right now. Try again in a minute.", "Press Check again."],
          ["That name is reserved. Choose another domain.", "The name is on the reserved list, for example admin, api, dashboard, status or www. Pick another name or a domain of your own."],
          ["Only your Nest name, <name>.hackclub.app, can be used under hackclub.app.", "Under hackclub.app only your own Nest name and names beneath it are allowed."],
          ["Use a public domain name such as app.example.com. IP addresses, localhost and internal names cannot be used.", "Use a real public domain name."],
          ["DNS no longer points here. Check your record.", "A domain that was active no longer passes the check. Restore the CNAME or TXT record and press Check. Egg keeps the domain."],
          ["<domain> is already added.", "A domain can be added once across all accounts."],
          ["Certificate not verified yet", "The app check found no trusted certificate. Wait for Nest to issue one, then press Check again."],
        ],
        "Domain messages",
        3
      )}

      <H2 id="troubleshooting-hook-409" />
      {wrong(
        "troubleshooting-hook-list",
        [
          ["A deployment is already running for this project.", "The hook answers 409 while any deployment of the project is queued, building or deploying. Try again when it finishes."],
          ["Unknown hook", "The URL is wrong or was replaced. Make a new URL."],
          ["Request body must be JSON", "Send valid JSON, or no body. The only field is branch."],
        ],
        "Deploy hook messages",
        3
      )}

      <H2 id="troubleshooting-pr-comment" />
      <P>
        The pull request must come from the same repository, must not be a draft, and its branch must not be your
        production branch. The GitHub app needs Pull requests read and write and the Pull request event. When a
        comment fails the deploy is unaffected and nothing is shown to you. A pull request from a fork is never built.
      </P>

      <H2 id="troubleshooting-alerts" />
      {wrong(
        "troubleshooting-alerts-list",
        [
          ["Add a webhook URL first.", "Save a Discord or Slack webhook URL in Notifications."],
          ["Use the plain https webhook URL from Discord or Slack.", "Remove ports, queries and credentials."],
          ["Only Discord and Slack incoming webhook URLs are supported.", "Use a discord.com, discordapp.com or hooks.slack.com URL."],
          ["Discord answered <status>.", "Slack gives the same message with its own name. The webhook was deleted or the URL is wrong. Make a new one."],
          ["Failed checks must be a whole number from 1 to 10.", "Fix the number in Settings, Alerts."],
          ["The response time limit must be at least 50 ms.", "Use 50 to 60000, or leave it empty to turn the limit off."],
          ["Could not load alert settings", "Press Try again."],
        ],
        "Notification and alert messages",
        3
      )}
      <P>
        If the test arrives but alerts do not, check three things. An app is reported down only after 2 failed checks
        in a row by default. Alerts may be paused for the project. And the channel you want may be switched off.
      </P>
      {wrong(
        "troubleshooting-webhooks",
        [
          ["The URL must start with https://.", "A signed webhook goes to an https address only."],
          ["Use the standard https port (443).", "Remove the port from the address."],
          ["Use a domain name, not an IP address.", "Use a full public domain name."],
          ["Use a full public domain name.", "A name with no dot, such as localhost, is refused."],
          ["Remove the user name and password from the URL.", "Credentials in an address are never accepted."],
          ["Remove the # part from the URL.", "Take off the fragment."],
          ["You can have up to 10 webhooks. Delete one first.", "409. Delete a webhook you no longer use."],
          ["Test message delivered", "The receiver answered with a 2xx status. The delivery is listed under Recent deliveries."],
        ],
        "Webhook messages",
        3
      )}
      <P>
        A delivery that fails shows a short code instead of a message from your receiver, because the response is never
        stored. <C>http_500</C> (or another <C>http_</C> status) means your receiver answered that status. <C>timeout</C>{" "}
        means it did not answer within 5 seconds. <C>redirect</C> means it answered with a redirect, which is not
        followed. <C>blocked_address</C> means the name points at a private or internal address. <C>dns_failed</C>{" "}
        means the name did not resolve. <C>network</C> means the connection failed. <C>interrupted</C> means a
        restart cut the delivery off. A status of 500 and above, 429, 408, a timeout, a network failure and a failed
        lookup are tried again up to 3 times in all, with pauses of 2 and 10 seconds. Any other 4xx status is not.
      </P>

      <H2 id="troubleshooting-container" />
      <P>
        These refusals are about the terminal, files and leftovers. The{" "}
        <InternalLink href={docsHref("container")}>container</InternalLink> page explains the switches.
      </P>
      {wrong("troubleshooting-container-switches", [...SWITCH_OFF, ...TERMINAL_PROBLEMS], "Terminal messages", 3)}
      {wrong("troubleshooting-container-files", FILE_PROBLEMS, "File messages", 3)}

      <H2 id="troubleshooting-token" />
      {wrong("troubleshooting-token-list", TOKEN_PROBLEMS, "API and token messages", 3)}
      {wrong(
        "troubleshooting-mcp",
        [
          ["Parse error", "400. The body was not JSON."],
          ["Not a JSON-RPC 2.0 message.", "400. Send { \"jsonrpc\": \"2.0\", \"id\": 1, \"method\": ..., \"params\": ... }."],
          ["Batches are not supported. Send one message per request.", "400. Send one message at a time."],
          ["Method not found: <method>", "Use initialize, ping, tools/list or tools/call."],
          ["Unknown tool: <name>", "The MCP endpoint does not have that tool. Call tools/list."],
          ["tools/call needs a tool name.", "Send params with a name."],
          ["Tool arguments must be an object.", "Send arguments as { … }."],
          ["<code>: <message>", "A tool that fails comes back as a result with isError set, and the text starts with the error code, for example forbidden: This token does not have the files:write permission."],
        ],
        "Agent endpoint messages",
        3
      )}

      <H2 id="troubleshooting-signin" />
      <P>
        The sign-in messages and their fixes are on the <InternalLink href={docsHref("account")}>account</InternalLink>{" "}
        page.
      </P>

      <H2 id="troubleshooting-watch" title="Monitoring, the status page and analytics" />
      {wrong(
        "troubleshooting-watch-list",
        [
          ["Could not read the service from your container.", "The Service card could not reach the container within 20 seconds. Press Check now, and check the container is running."],
          ["The service is running but nothing answered on its health path.", "The app starts but the health path gives no answer. Fix the path in Settings, Build and Run, or the app."],
          ["The health path answered HTTP <code>.", "A status of 500 or above counts as down. A 404 does not."],
          ["The health path took <ms> ms to answer, over your limit of <n> ms.", "Raise the Slow response limit, or make the page faster."],
          ["No data yet", "A status page says this until the first check has run. Wait for the next 5 minute pass."],
          ["Not responding", "The app has stopped answering, by the same check as the alerts."],
          ["Not enough data", "Percentages and medians need 50 visits behind them, and speed figures need 50 page views. The counts are shown."],
          ["Not enough data yet", "Returning visitors need at least 20 visitors in the group, counted from the day Retention was turned on."],
          ["Unique visitors need retention on", "Turn on Retention under What else to record. Without the random id in the browser, visitors cannot be told apart."],
          ["A funnel needs at least 2 steps", "Add a second step, or leave the funnel empty."],
          ["A funnel has at most 6 steps", "Remove a step."],
          ["Nothing is counted on a page", "The snippet is missing or the page was not redeployed. Nothing is counted for Do Not Track or Global Privacy Control, on localhost, or for known bots."],
        ],
        "What you see",
        3
      )}

      {why(
        <>
          Each entry quotes the message word for word so you can search this page for the text you saw. The status
          code leads the fix because it tells you what kind of problem it is: a 4xx means the request needs to
          change, a 429 means wait for the Retry-After seconds, and a 502 or 503 means Egg could not reach your
          container or has no room right now, so check the container and try again.
        </>
      )}
      {example("troubleshooting-example", {
        title: "Fix a build that stops with exit 137",
        given: (
          <>
            A project named recipe-api whose deployment fails with “The build needed more memory than the cap of 1024
            MB. Your app is still running.”
          </>
        ),
        steps: [
          { title: "Open Container", body: "Pick the server that holds recipe-api, then find the Build memory card.", path: ["Container", "Build memory"] },
          { title: "Raise the number", body: "Read the range in the hint under Build memory (MB). Type 1536 if the hint allows it, then press Save." },
          { title: "Deploy again", body: "Open the project and press Redeploy, or push a commit." },
        ],
        result: (
          <>
            The message “Build memory set to 1536 MB” appears, the next build runs with that limit and finishes, and
            Activity lists “Changed the build memory limit for” the server. The cap is at most your container’s memory
            minus 512 MB, so on a container that reports less than 2048 MB, make the build use less instead.
          </>
        ),
      }, 2)}
      <Callout tone="note" title="Still stuck?">
        Look at <InternalLink href="/projects">your dashboard</InternalLink> or open an issue on{" "}
        <ExternalLink href={REPO_URL}>GitHub</ExternalLink>. Leave real keys, tokens and variable values out of it.
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
        You make tokens on the Developer page. A token is a bearer secret that starts with <C>egg_</C>. The API is
        under <C>/api/v1</C>, the agent endpoint is <C>/api/mcp</C>, and everything here is also in the OpenAPI
        description at <C>/api/v1/openapi.json</C>. A token can do nothing its permissions do not name (the API and
        its code call them scopes), and a few things it can never do at all. Egg runs every call on Egg’s machine.
        The calls marked “Container session” in the table below also open an SSH connection to your container, so
        they use a little of its CPU and are limited to 10 a minute for each token.
      </P>
      <H2 id="api-tokens" />
      {steps("api-tokens-steps", "Make a token", [
        { title: "Open Developer", body: "Press Create token to open the New token dialog.", path: ["Developer", "Access tokens", "Create token"] },
        { title: "Name it", body: "A name is 1 to 60 characters. Pick one you will recognise later. It is what Activity shows for anything the token does." },
        { title: "Tick Permissions", body: "Read only ticks every read permission. Deploy ticks projects:read, deployments:read, deployments:write and logs:read." },
        { title: "Choose Expires after", body: "7, 30, 90 or 365 days. 90 is the default. With a terminal or file permission ticked only 7 days is allowed." },
        { title: "Copy the secret", body: "It is shown once: “Copy it now. It is shown once.” Store it in a secret store, not in code." },
      ])}
      <P>
        The list groups tokens as Active, Expired and Revoked, and flags an active token that ends within 7 days.
        Each shows when it was last used, at most once an hour, or “Never”. Each active token has Edit and Revoke.
        Edit changes the name, the permissions and the expiry, counted from now, and takes effect on the next
        request. Revoke asks you to confirm with “Revoke token”: anything using the token stops working at once
        and any terminal it opened closes. A revoked token is final. Dropping the deploy permission warns that
        deploys will stop working for anything that uses the token.
      </P>
      {why(
        <>
          The secret is shown once because only its SHA-256 is stored, so it cannot be shown again, even to Egg. An
          expired, revoked or unknown token is rejected with the same message so nobody can use the API to find out
          which tokens once existed. Names matter because Activity shows them: a log that says “a token” cannot tell
          you which script did it.
        </>
      )}

      <H2 id="api-scopes" />
      <Table
        caption="Token permissions"
        head={["Permission", "What it allows", "Calls"]}
        rows={[
          [<C key="1">projects:read</C>, "Read projects, their settings and status page.", "list_projects, get_project, get_status_page"],
          [<C key="2">projects:write</C>, "Create, change and delete projects, including build and start commands.", "create_project, update_project, delete_project"],
          [<C key="3">deployments:read</C>, "Read deployments and build output.", "list_deployments, get_deployment, get_deployment_logs"],
          [<C key="4">deployments:write</C>, "Deploy, redeploy, cancel and roll back, and replace or revoke the deploy hook.", "deploy_branch, redeploy, cancel_deployment, rollback_deployment, rotate_deploy_hook, revoke_deploy_hook"],
          [<C key="5">logs:read</C>, "Read runtime logs.", "get_logs"],
          [<C key="6">env:read</C>, "List variable names. Never their values.", "list_env_vars"],
          [<C key="7">env:write</C>, "Set and remove variables.", "set_env_var, delete_env_var"],
          [<C key="8">domains:read</C>, "Read domains.", "list_domains"],
          [<C key="9">domains:write</C>, "Add, check and remove domains.", "add_domain, verify_domain, remove_domain"],
          [<C key="10">notifications:read</C>, "Read notification settings and send a test message.", "get_notifications, test_notification"],
          [<C key="11">alerts:read</C>, "Read alert settings and history.", "get_alerts"],
          [<C key="12">analytics:read</C>, "Read visitor analytics.", "get_analytics"],
          [<C key="13">activity:read</C>, "Read your activity log.", "get_activity"],
          [<C key="14">resources:read</C>, "Read CPU, memory and disk, now and over time.", "get_server_usage, get_resource_history, get_project_resources"],
          [<C key="15">container:read</C>, "List servers and see what is on the container. Read only.", "list_servers, get_container_inventory"],
          [<C key="16">files:read</C>, "List and read files in a project’s folder.", "list_files, read_file, download_file"],
          [<C key="17">files:write</C>, "Create, change, rename and delete files in a project’s shared/ folder.", "write_file, make_folder, rename_file, delete_file"],
          [<C key="18">terminal:use</C>, "Open and use a shell on the container.", "terminal_status, terminal_open, terminal_send, terminal_read, terminal_resize, terminal_close"],
          [<C key="19">webhooks:read</C>, "Read your webhooks and their recent deliveries, never their secrets.", "GET /webhooks routes"],
          [<C key="20">webhooks:write</C>, "Create, change, delete and test webhooks, and replace a webhook secret.", "POST, PATCH, DELETE /webhooks routes"],
        ]}
      />
      <P>
        Projects, deployments, variables, domains, files and webhooks have a write permission, and{" "}
        <C>terminal:use</C> runs commands. Notifications, alerts, analytics, resources, activity, the container and
        logs are read only, and no permission changes notification or alert settings. Those stay in the browser.{" "}
        <C>test_notification</C> needs only <C>notifications:read</C> but posts a real message to your channel, so an
        agent should send it only when you ask.
      </P>

      <H2 id="api-limits" />
      <P>
        Terminal and file changes are off until you switch them on for a server, and switching them on asks you to
        sign in with Hack Club again. A token can use them only while that switch is on. A token that holds{" "}
        <C>terminal:use</C> or <C>files:write</C> expires within 7 days, whatever length you picked, and the form shows
        that as you tick it. If you send no expiry, it gets 7 days. Adding either permission to a longer-lived token
        is refused unless the same edit sets the expiry to 7 days.
      </P>
      <P>
        Some things stay with you in the browser. A token cannot remove leftovers, change the container permissions,
        manage your account or sessions, or create other tokens. Files in <C>current/</C> stay read only, and a
        release’s <C>.env</C> is never returned.
      </P>
      {why(
        <>
          A terminal can run any command and a file change can alter the code your app runs, so a leaked token with
          either is the worst case. Capping its life at 7 days, and tying it to a switch you turned on with a recent
          Hack Club sign-in, keeps that case short. The token does not sign in again: it can use the terminal until
          its 7 days end or you switch the terminal off.
        </>
      )}

      <H2 id="api-mcp" />
      <P>
        The API is under <C>/api/v1</C> and takes the token as a bearer header. The description of every call is at{" "}
        <C>/api/v1/openapi.json</C>. Start with <C>/api/v1/me</C>. It needs no permission, so any valid token can call
        it. It returns the token’s name, permissions and expiry and how many servers and projects there are, and never
        an email address.
      </P>
      <List>
        <li>
          <B>Requests.</B> Send JSON. A body field the call does not know is refused with an “Unknown field” message that lists the allowed ones, so a typo cannot silently do nothing. A value in the path wins over a body field of the same
          name.
        </li>
        <li>
          <B>Answers.</B> A success is <C>200</C>, or <C>201</C> for something new, or <C>202</C> for a deployment
          that is queued and will finish later. An error is always <C>{"{ \"error\": { \"code\", \"message\" } }"}</C>.
          Authenticated answers are never cached.
        </li>
        <li>
          <B>Secrets are write-only.</B> Variable values, notification URLs and token secrets are never returned. A
          deploy hook URL comes back once, from the call that makes it.
        </li>
        <li>
          <B>Cross-origin use.</B> The API allows any origin and never reads cookies, so a page on another site can
          call it only with a token it holds. Do not put a token in a public page.
        </li>
      </List>
      <P>
        AI agents connect to <C>/api/mcp</C> instead. It speaks JSON-RPC 2.0 over POST, with one message per request,
        no sessions and no batches, and it offers the same calls as tools, with the same permissions and limits. It
        answers <C>initialize</C>, <C>ping</C>, <C>tools/list</C> and <C>tools/call</C>. An agent should call the{" "}
        <C>get_me</C> tool first. A tool error comes back as a result with <C>isError</C> set and text that starts with
        the error code. A <C>GET</C> to the address is a 405.
      </P>
      <P>
        Deploys, redeploys, rollbacks, cancels and file or terminal actions made with a token are recorded in{" "}
        <InternalLink href={docsHref("activity")}>Activity</InternalLink> with the token’s name.
      </P>
      <Table
        caption="Every API call"
        head={["Tool", "Method and path", "Permission", "Allowance"]}
        rows={CALLS.map(([tool, method, path, scope, allowance]) => [
          <C key={tool}>{tool}</C>,
          <C key={`${tool}-p`}>{`${method} ${path}`}</C>,
          scope ? <C key={`${tool}-s`}>{scope}</C> : "None",
          allowance,
        ])}
      />
      <P>
        Webhooks are plain routes under <C>/api/v1/webhooks</C> rather than tools: <C>GET</C> and <C>POST</C> on{" "}
        <C>/webhooks</C>, <C>GET</C>, <C>PATCH</C> and <C>DELETE</C> on <C>/webhooks/{"{webhookId}"}</C>, and{" "}
        <C>POST</C> on <C>/webhooks/{"{webhookId}"}/rotate</C> and <C>/webhooks/{"{webhookId}"}/test</C>. Creating
        one takes <C>url</C>, an optional <C>events</C> list of <C>deployment.started</C>,{" "}
        <C>deployment.succeeded</C> and <C>deployment.failed</C>, and an optional <C>projectId</C>. The answer carries
        the signing secret once. The body is 4 KB at most, and the test call uses the container-session allowance.
        They are not in the OpenAPI description or the agent tool list. How a receiver checks the{" "}
        <C>X-Egg-Signature</C> header, what a delivery carries and how failed deliveries are tried again are on
        the <InternalLink href={docsHref("notifications")}>Notifications</InternalLink> page.
      </P>

      <H2 id="api-examples" />
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
        <li>
          <ExternalLink href={repoLink("docs/developers/cli.md")}>Egg command line</ExternalLink> (the script is{" "}
          <ExternalLink href={repoLink("web/scripts/egg-cli.mjs")}>egg-cli.mjs</ExternalLink>). Use Egg from a
          terminal: <C>egg whoami</C>, <C>egg projects list</C>, <C>egg deploy &lt;slug&gt;</C>,{" "}
          <C>egg logs &lt;deployment-id&gt; --follow</C>, <C>egg rollback &lt;deployment-id&gt;</C>,{" "}
          <C>egg env names &lt;slug&gt;</C>, <C>egg domains list</C> and <C>egg status</C>. It reads{" "}
          <C>EGG_TOKEN</C> and <C>EGG_URL</C> from the environment and never prints the token. Exit code 0 is done, 1
          is failed and 2 is wrong use.
        </li>
      </List>
      {steps("api-examples-steps", "Common calls", [
        {
          title: "Check the token",
          body: "Needs no permission. It shows what the token may do and when it ends.",
          code: { label: "Terminal", code: `curl -H "Authorization: Bearer $NEST_TOKEN" https://your-egg/api/v1/me` },
        },
        {
          title: "List projects and find an id",
          body: <>Needs <C>projects:read</C>.</>,
          code: { label: "Terminal", code: `curl -H "Authorization: Bearer $NEST_TOKEN" https://your-egg/api/v1/projects` },
        },
        {
          title: "Deploy a branch",
          body: <>Needs <C>deployments:write</C>. Leave the body out to deploy the production branch. Any other branch becomes a preview. The answer is 202 with the queued deployment. The build then runs on your container, and a production deploy restarts the app on your container.</>,
          code: {
            label: "Terminal",
            code: `curl -X POST -H "Authorization: Bearer $NEST_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"branch":"pricing-page"}' \\\n  https://your-egg/api/v1/projects/PROJECT_ID/deployments`,
          },
        },
        {
          title: "Watch it finish",
          body: <>Needs <C>deployments:read</C>. The newest deployment comes first, and its <C>state</C> moves from queued to building to deploying and then to ready, error or canceled.</>,
          code: { label: "Terminal", code: `curl -H "Authorization: Bearer $NEST_TOKEN" \\\n  "https://your-egg/api/v1/projects/PROJECT_ID/deployments?limit=1"` },
        },
        {
          title: "Read why it failed",
          body: <>Needs <C>deployments:read</C>. Pass the last line’s id as <C>after</C> to continue. It uses the container-session allowance of 10 a minute.</>,
          code: { label: "Terminal", code: `curl -H "Authorization: Bearer $NEST_TOKEN" \\\n  "https://your-egg/api/v1/deployments/DEPLOYMENT_ID/logs?after=0&limit=200"` },
        },
        {
          title: "Set a variable",
          body: <>Needs <C>env:write</C>. <C>target</C> is <C>all</C>, <C>production</C> or <C>preview</C>. The value reaches the app at the next deploy and is never returned.</>,
          code: { label: "Terminal", code: `curl -X PUT -H "Authorization: Bearer $NEST_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"value":"sk_test_123","target":"production"}' \\\n  https://your-egg/api/v1/projects/PROJECT_ID/env/STRIPE_KEY` },
        },
        {
          title: "Roll back",
          body: <>Needs <C>deployments:write</C>. Pass the id of an earlier production deployment whose release is still on your container. Nothing is rebuilt: the service restarts on that older release, so the app is unavailable for a moment.</>,
          code: { label: "Terminal", code: `curl -X POST -H "Authorization: Bearer $NEST_TOKEN" \\\n  https://your-egg/api/v1/deployments/DEPLOYMENT_ID/rollback` },
        },
        {
          title: "Wait out a 429",
          body: "A rate-limited call answers 429 with a Retry-After header. Wait that many seconds, then repeat the call.",
          code: {
            label: "Node.js",
            code: `async function call(path, init) {\n  const res = await fetch("https://your-egg/api/v1" + path, {\n    ...init,\n    headers: { Authorization: "Bearer " + process.env.NEST_TOKEN, ...init?.headers },\n  });\n  if (res.status === 429) {\n    await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after") ?? 5) * 1000));\n    return call(path, init);\n  }\n  const body = await res.json();\n  if (!res.ok) throw new Error(body.error.code + ": " + body.error.message);\n  return body;\n}`,
          },
        },
        {
          title: "Use the typed client",
          body: "Copy the one file into your project. Each method names its permission and throws an error that carries the status, the code and Retry-After.",
          code: {
            label: "TypeScript",
            code: `import { Egg } from "./egg";\n\nconst nest = new Egg({ token: process.env.NEST_TOKEN!, baseUrl: "https://your-egg" });\n\nconst me = await nest.me();\nconsole.log(me.token.scopes);\n\nconst { projects } = await nest.listProjects();\nfor (const p of projects) console.log(p.name, p.state);`,
          },
        },
        {
          title: "Call a tool over MCP",
          body: "One JSON-RPC message per POST.",
          code: {
            label: "Terminal",
            code: `curl -X POST -H "Authorization: Bearer $NEST_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_me","arguments":{}}}' \\\n  https://your-egg/api/mcp`,
          },
        },
      ])}

      <H2 id="api-addresses" />
      <Table
        caption="Addresses"
        head={["For", "Address"]}
        rows={[
          ["API calls", <C key="1">https://your-egg/api/v1</C>],
          ["Client generators and API tools", <C key="2">https://your-egg/api/v1/openapi.json</C>],
          ["AI agents", <C key="3">https://your-egg/api/mcp</C>],
        ]}
      />
      <P>
        Replace <C>your-egg</C> with the address of your Egg. All three take the same token in an{" "}
        <C>Authorization: Bearer</C> header, and none of them reads cookies. The OpenAPI document is public and holds
        no data. A client that connects over MCP uses the same address and header:
      </P>
      {code(
        "MCP client config",
        `{\n  "mcpServers": {\n    "egg": {\n      "type": "http",\n      "url": "https://your-egg/api/mcp",\n      "headers": { "Authorization": "Bearer ${TOKEN_PLACEHOLDER}" }\n    }\n  }\n}`
      )}

      {limits("api-rates", [
        ["Reads", "120 a minute per token", "429 with a Retry-After header.", "server/api-v1-kit.ts (API_LIMITS.read)"],
        ["Changes", "30 a minute", "429.", "server/api-v1-kit.ts (API_LIMITS.write)"],
        ["Calls that open a session to your container (build logs, resource history, project resources, the inventory, opening a terminal, files)", "10 a minute", "429.", "server/api-v1-kit.ts (API_LIMITS.ssh)"],
        ["Terminal input", "300 a minute", "429.", "server/api-v1-kit.ts (API_LIMITS.input)"],
        ["Invalid tokens", "60 a minute per address", "429 “Too many requests for unrecognised access tokens.”", "server/rate-limit.ts (RATE_LIMITS.badToken)"],
        ["Request body", "16 KB (4 MB for a file write, 64 KB for terminal input and for MCP, 4 KB for webhooks)", "413 “The request body is too large.”", "server/api-v1-kit.ts (DEFAULT_MAX_BODY_BYTES), server/api-v1-shell.ts, app/api/mcp/route.ts, server/webhooks-http.ts"],
        ["File write and download", "1 MB and 2 MB", "413 “The API writes files of up to 1 MB. Upload larger files in the dashboard.”", "server/api-v1-shell.ts"],
        ["Active tokens", "25", "400 “You can have up to 25 active tokens. Revoke one first.”", "server/api-tokens.ts (MAX_TOKENS_PER_USER)"],
        ["Token life", "7, 30, 90 or 365 days; 7 with terminal or files:write", "400 naming the 7 day rule.", "server/api-tokens.ts (createTokenInput, SHORT_LIVED_MAX_DAYS)"],
        ["List sizes", "Deployments 1 to 100, runtime log lines 1 to 1000, build log lines 1 to 1000, activity 1 to 100, analytics 1 to 90 days, resource history 1 to 168 hours", "400 for a value outside the range.", "server/api-v1.ts, server/api-v1-more.ts (query fields)"],
      ])}

      {wrong("api-wrong", TOKEN_PROBLEMS.slice(0, 12), undefined, 2)}
      <Table
        caption="Status codes"
        head={["Status", "Meaning"]}
        rows={[
          [<C key="400">400</C>, "The request was invalid. The message says which field."],
          [<C key="401">401</C>, "Missing or invalid token. The response has a WWW-Authenticate: Bearer header."],
          [<C key="403">403</C>, "The token lacks the permission, or the switch for terminal, files or leftovers is off."],
          [<C key="404">404</C>, "No such item, or it belongs to someone else."],
          [<C key="405">405</C>, "The agent endpoint takes POST only."],
          [<C key="409">409</C>, "The item is in a state that does not allow this."],
          [<C key="413">413</C>, "The request body or the file is too large."],
          [<C key="429">429</C>, "Too many requests. Wait the seconds in Retry-After."],
          [<C key="502">502</C>, "Your container could not be reached."],
          [<C key="503">503</C>, "Too many terminals are open on the service right now."],
        ]}
      />

      {wrong(
        "api-cli-wrong",
        [
          ["Set EGG_TOKEN to your personal access token (it starts with egg_).", "Exit 2. Export EGG_TOKEN with a token from the Developer page."],
          ["Set EGG_URL to your Egg address, such as https://deploy.example.com.", "Exit 2. Export EGG_URL with the address of your Egg."],
          ["Unknown command \"<name>\".", "Exit 2. Run egg --help for the list."],
          ["Unknown option <name>.", "Exit 2. The options are --json, --follow, --branch and --help."],
          ["egg <command> needs <argument>.", "Exit 2. Add the project slug or deployment id the command asks for."],
          ["No project with the slug \"<slug>\". Run egg projects list to see yours.", "Exit 1. Check the slug against the list."],
          ["Error: <message>", "Exit 1. The API refused the call. The message is the one from the tables above. With --json the error is printed as an object with status, code and message."],
        ],
        "Command line messages",
        3
      )}
      {example("api-example", {
        title: "List your projects with curl",
        given: "A token with projects:read, kept in an environment variable.",
        steps: [
          {
            title: "Call the projects endpoint",
            code: {
              label: "Terminal",
              code: `export NEST_TOKEN=egg_...\ncurl -H "Authorization: Bearer $NEST_TOKEN" https://your-egg/api/v1/projects`,
            },
          },
        ],
        result: "A JSON list of your projects. A token without the permission gets 403 naming it.",
      })}
      {example("api-example-deploy", {
        title: "Deploy from a script and wait",
        given: "A token with projects:read, deployments:read and deployments:write, and a project whose id you found with the call above.",
        steps: [
          { title: "Start the deploy", body: "POST to the project’s deployments endpoint with no body." },
          { title: "Poll", body: "List deployments with limit=1 every few seconds until state is ready, error or canceled." },
          { title: "On error, read the log", body: "Fetch the deployment’s logs and print the last lines." },
        ],
        result: "The POST answers 202 with the queued deployment. When state reads ready, the release is live. Activity shows “Started a deployment of” with the token’s name.",
      })}
      {related([
        ["security", "Security"],
        ["limits", "Limits"],
        ["container", "Container, terminal and files"],
        ["notifications", "Notifications"],
      ])}
    </Section>
  ),
};
