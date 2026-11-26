import type { Metadata } from "next";
import { HOME_FACTS, TOKEN_SCOPES, numberWord } from "@/components/marketing/home-facts";
import { REPO_URL } from "@/lib/site";
import { SECURITY_FACTS } from "./_components/facts";
import { Toc } from "./_components/toc";
import { Code, LimitTable, Points, Section, Sub, Term, Terms, TextLink } from "./_components/parts";

export const metadata: Metadata = {
  title: "Security",
  description:
    "What Egg can and cannot touch on your Nest container, how it protects your keys, your account and your browser, the limits it enforces, what it logs, how to report a vulnerability and how to remove it.",
};

const { reauthMinutes, terminalIdleMinutes, terminalMaxMinutes, shortLivedDays, buildMemoryGb } = HOME_FACTS;
const F = SECURITY_FACTS;

/** The private advisory form on the repository, and the maintainer's GitHub profile, both built from REPO_URL. */
const ADVISORY_URL = `${REPO_URL}/security/advisories/new`;
const MAINTAINER_URL = REPO_URL.split("/").slice(0, 4).join("/");

const SECTIONS = [
  { id: "touch", title: "What Egg can touch" },
  { id: "switches", title: "The three switches" },
  { id: "secrets", title: "Keys and secrets" },
  { id: "accounts", title: "Accounts and sign-in" },
  { id: "browser", title: "Your browser and this site" },
  { id: "limits", title: "Rate and size limits" },
  { id: "tokens", title: "Access tokens" },
  { id: "webhooks", title: "Webhooks" },
  { id: "domains", title: "Domains" },
  { id: "builds", title: "Builds" },
  { id: "analytics", title: "Visitor analytics" },
  { id: "logs", title: "What is logged and what is not" },
  { id: "remove", title: "Disconnect a server, remove Egg" },
  { id: "gaps", title: "What is not covered" },
  { id: "report", title: "Report a vulnerability" },
] as const;

const title = (id: (typeof SECTIONS)[number]["id"]) => SECTIONS.find((s) => s.id === id)!.title;
const num = (id: (typeof SECTIONS)[number]["id"]) => SECTIONS.findIndex((s) => s.id === id) + 1;

export default function SecurityPage() {
  return (
    <>
      <header className="board-col pt-[60px] lg:pt-[120px]">
        <h1 className="max-w-[18ch] font-pixel text-[clamp(2.25rem,5vw,4rem)] leading-[1.05] font-medium text-balance text-foreground">
          How Egg protects your container
        </h1>
        <p className="mt-5 max-w-[60ch] text-[1.0625rem] leading-[1.75rem] text-reading">
          Egg is an add-on that connects to a Hack Club Nest container you already own. It is an independent project,
          not part of Nest. This page says what Egg reaches, what it keeps, what it writes down, what it refuses and how
          to get rid of it. In short: it only manages what it created, the risky features start switched off, every
          secret is encrypted or hashed, and requests that are unsigned, too frequent or too large are turned away.
        </p>
      </header>

      <div className="board-col mt-10 grid items-start gap-6 pb-[90px] lg:mt-[60px] lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8 lg:pb-[150px]">
        <Toc sections={SECTIONS} />

        <article className="border-x border-b border-border bg-background">
          <Section id="touch" title={title("touch")} number={num("touch")}>
            <p className="m-0">
              Egg reaches your container over SSH, as your Nest user, with a key you add yourself. On the container it
              works in four places and nowhere else.
            </p>
            <Terms>
              <Term name="The SSH key">
                One key for each Nest server you connect. You paste its public half into the SSH Keys page of the Nest
                dashboard, and you can delete it there at any time.
              </Term>
              <Term name="A folder for each project">
                <Code>~/.egg/&lt;project&gt;/</Code> holds the releases, an upload area, a <Code>shared/</Code>{" "}
                folder that deploys never touch, and a marker file named <Code>.egg-managed</Code>.
              </Term>
              <Term name="One service for each project">
                A systemd service named <Code>egg-&lt;project&gt;</Code>. A branch preview gets its own service, named{" "}
                <Code>egg-&lt;project&gt;-pv-</Code> and eight more characters. Each one carries a{" "}
                <Code># egg:managed</Code> comment.
              </Term>
              <Term name="The current link">
                <Code>~/.egg/&lt;project&gt;/current</Code> is a link to the live release. A deploy points it at
                the new release and a rollback points it back.
              </Term>
            </Terms>
            <p className="m-0">
              Egg also reads the container so it can show it to you: which services and folders exist, which ports are
              in use, and how much memory, CPU and disk are used.
            </p>
            <Sub>What it never touches</Sub>
            <p className="m-0">
              Anything that does not carry one of those markers. A service or folder you made yourself is not
              overwritten, stopped or removed, even if its name starts with <Code>egg-</Code>. Before a first deploy
              Egg checks the container for apps that are already running and for ports and service names that are
              already taken.
            </p>
          </Section>

          <Section id="switches" title={title("switches")} number={num("switches")}>
            <p className="m-0">
              A new container starts with all three switches off. When one is off, Egg refuses the request on the
              server, so it is not only hidden from the page. You change them in Account, under Container permissions.
            </p>
            <Terms>
              <Term name="Terminal (off by default)">
                A shell on your container in the browser, running as root. Anything you type runs for real, so it can
                stop or change any app on the container, including apps Egg did not deploy. Anyone who can sign in to
                your Egg account can use it while it is on. It closes after {numberWord(terminalIdleMinutes)} minutes
                without input, or after {terminalMaxMinutes} minutes in all. Turning the switch off closes any open
                terminal on that server at once.
              </Term>
              <Term name="File changes (off by default)">
                Create, edit, rename, delete and upload files in each project&apos;s <Code>shared/</Code> folder and
                nowhere else. The live release in <Code>current/</Code> is always read only. Treat this like terminal
                access: a changed file can change the code your app runs the next time it restarts.
              </Term>
              <Term name="Removing leftovers (off by default)">
                Stops and removes services whose names start with <Code>egg-</Code>, and folders inside{" "}
                <Code>~/.egg</Code> that no project uses any more. It only removes what carries Egg&apos;s
                marker, and it asks you to confirm each removal.
              </Term>
            </Terms>
            <p className="m-0">
              To turn on the terminal or file changes, Egg sends you back to Hack Club to sign in again. The sign-in has
              to be from the last {numberWord(reauthMinutes)} minutes. Turning a switch off never asks. Browsing and
              reading files in a project&apos;s folder works with every switch off, and it is read only. The one thing
              the Files page will not show is a release&apos;s <Code>.env</Code> file, explained next.
            </p>
          </Section>

          <Section id="secrets" title={title("secrets")} number={num("secrets")}>
            <Terms>
              <Term name="The SSH key">
                Egg makes an ed25519 key for each Nest server you connect, and never reuses it for another server or
                another person. The private half is encrypted before it is stored, with AES-256-GCM. The encryption key
                comes from a secret kept in the server&apos;s environment, not in the database, and each stored value is
                tied to its own record so it cannot be moved to another one. Your browser only ever receives the public
                half and its fingerprint. You can replace the key at any time; the old one stops working once you delete
                it in the Nest dashboard.
              </Term>
              <Term name="The Nest host key">
                The first time you connect a server, Egg reaches it, reads the fingerprint of its SSH host key and
                stops. It shows you that fingerprint and waits. Nothing else is sent to the server, and no deploy, file
                change or terminal can run, until you check it against the one Nest shows for your server and confirm
                it. Until then every other request for that server is refused with <Code>host_key_unconfirmed</Code>.
                After you confirm, Egg keeps the key. Every connection after that is checked against it. If the key has
                changed, Egg stops before it sends a key, a variable or a file, and tells you. If you expected the
                change, disconnect the server and connect it again.
              </Term>
              <Term name="Environment variables">
                Encrypted the same way as the SSH key, and write-only: the dashboard and the API list their names and
                never their values. At deploy time Egg decrypts them, gives them to the build and writes them to a{" "}
                <Code>.env</Code> file on your container with mode 600, so only your own user can read it. On the
                container that file is plain text, protected by its permissions.
              </Term>
              <Term name="The .env file on the Files page">
                The Files page and the API refuse to show a release&apos;s <Code>.env</Code>, in <Code>current/</Code> or
                in any release folder. The refusal does not rely on the name alone: the scripts that read and write
                files follow links first and then refuse that file, so a link placed in <Code>shared/</Code> that points
                at it gets nothing. Someone with a terminal on the container can still read it, which is part of why the
                terminal is off by default.
              </Term>
              <Term name="Tokens and hooks">
                Access tokens and deploy hooks are stored as a SHA-256 hash and shown once, when you create them. Egg
                cannot show them again. Webhook secrets are stored encrypted and shown once.
              </Term>
            </Terms>
          </Section>

          <Section id="accounts" title={title("accounts")} number={num("accounts")}>
            <p className="m-0">
              You sign in with Hack Club. Egg asks for your name, email and Hack Club ID, and keeps those (plus a Slack
              ID when Hack Club sends one). It never sees your Hack Club password.
            </p>
            <Points>
              <li>
                A session is a random value in a cookie that scripts on the page cannot read, that is sent only over
                https in production, and that browsers hold back from most requests another site starts. Egg stores only
                a hash of it. A session lasts 30 days, and each new sign-in ends the session it replaces.
              </li>
              <li>
                Account lists every browser you are signed in on. You can sign one out, or sign out every browser except
                the one you are using. Doing either closes any open terminal on your account.
              </li>
              <li>
                When Egg asks you to sign in again to confirm a sensitive change, it has to be the same Hack Club
                account. A different account is turned away and your session is left as it was.
              </li>
              <li>
                Deleting your account asks you to type your name. It removes everything under the account, including
                the activity log. Apps already running on your container are left running.
              </li>
            </Points>
          </Section>

          <Section id="browser" title={title("browser")} number={num("browser")}>
            <Terms>
              <Term name="The return path after sign-in">
                After you sign in, Egg sends you back to the page you came from, but only if that is a page on Egg. A
                path that a browser could read as another site is replaced with your Account page. That includes paths
                that start with a double slash, or that hide a backslash, a tab or a line break, which browsers quietly
                turn into a different address. A crafted link cannot use the sign-in to land you on a look-alike page.
              </Term>
              <Term name="Changes from other sites">
                Egg refuses a request that changes something when your browser says it came from another site. It checks
                the <Code>Origin</Code> header and, when that is missing, the browser&apos;s own{" "}
                <Code>Sec-Fetch-Site</Code> header. Tools such as curl and webhook senders send neither, and are not
                affected.
              </Term>
              <Term name="Security headers">
                Every page and every API route is sent with these.
                <Points>
                  <li>
                    No other site can put Egg in a frame (<Code>frame-ancestors &apos;none&apos;</Code> and{" "}
                    <Code>X-Frame-Options: DENY</Code>), which stops click-jacking.
                  </li>
                  <li>
                    A content policy limits where scripts, styles, fonts and connections may load from to Egg itself,
                    allows no plug-ins, and lets forms submit only to Egg. Images may come from any https address.
                  </li>
                  <li>
                    Browsers may not guess a file&apos;s type (<Code>nosniff</Code>), and other sites are told only that
                    you came from Egg, not which page.
                  </li>
                  <li>The camera, microphone, location and payment features are switched off for the page.</li>
                  <li>In production, browsers use https only for two years (HSTS).</li>
                </Points>
              </Term>
            </Terms>
          </Section>

          <Section id="limits" title={title("limits")} number={num("limits")}>
            <p className="m-0">
              Egg counts requests and turns away the ones over these limits with a message that says how long to wait.
              Sign-in and access tokens are counted by network address, because the caller has no account yet. The rest
              are counted for each account. When sign-in is over its limit, the sign-in page says so and asks you to
              wait a minute.
            </p>
            <LimitTable
              caption="Rate limits"
              head={["What", "Limit"]}
              rows={[
                [
                  "Sign-in requests (start, return from Hack Club, confirm)",
                  `${F.signInPerMinute} a minute for each address`,
                ],
                ["Access tokens that are not valid", `${F.badTokenPerMinute} a minute for each address`],
                ["Terminal input", `${F.terminalInputPerMinute} a minute`],
                ["File changes", `${F.fileChangesPerMinute} a minute`],
                ["Listing, reading and downloading files", `${F.fileReadsPerMinute} a minute`],
                ["Removing leftovers", `${F.leftoverRemovalsPerMinute} a minute`],
                ["Terminals open at once", `${F.terminalsPerAccount} for each account`],
              ]}
            />
            <p className="m-0">
              The token limit is checked before a token is looked up, so guessing tokens cannot be used to wear down the
              database. Only tokens that turn out to be wrong count towards it.
            </p>
            <Sub>Where the address comes from</Sub>
            <p className="m-0">
              The setting <Code>TRUST_PROXY</Code> is off by default. While it is off, Egg ignores the{" "}
              <Code>X-Forwarded-For</Code> and <Code>X-Real-IP</Code> headers, because anyone can send them, and the
              limits by address do not apply, since a request then has no address Egg can trust. Whoever runs Egg sets
              it to <Code>1</Code> only when every request comes through a reverse proxy they run. Egg then takes the
              last entry of <Code>X-Forwarded-For</Code>, the one that proxy added itself, and not the first, which the
              sender could have written.
            </p>
            <Sub>Size limits</Sub>
            <p className="m-0">
              Egg reads a request body only up to a limit, and counts the bytes as they arrive. A sender that lies about
              the size, or sends no size at all, is cut off at the limit. A request over its limit gets a 413 answer.
            </p>
            <LimitTable
              caption="Size limits"
              head={["Request", "Largest body"]}
              rows={[
                ["Deploy hook", `${F.deployHookBodyKb} KB`],
                ["Most requests made with an access token", `${F.apiBodyKb} KB`],
                ["JSON requests from a signed-in browser", `${F.dashboardBodyKb} KB`],
                ["MCP endpoint", `${F.mcpBodyKb} KB`],
                ["GitHub delivery", `${F.githubBodyMb} MB`],
                ["File upload", `${F.uploadMb} MB`],
              ]}
            />
            <p className="m-0">
              File uploads keep their own, larger limit, because they carry file contents. A few routes have smaller
              limits of their own, such as terminal input.
            </p>
          </Section>

          <Section id="tokens" title={title("tokens")} number={num("tokens")}>
            <p className="m-0">
              An access token lets a script or an AI agent use the API and the MCP endpoint. Each token has a name, a
              list of permissions called scopes (there are {TOKEN_SCOPES.length}) and an expiry of 7, 30, 90 or 365
              days. Revoking a token or letting it expire takes effect on the very next request, and revoking one also
              closes any terminal that token opened.
            </p>
            <Points>
              <li>
                A token with the terminal scope (<Code>terminal:use</Code>) or the file write scope (
                <Code>files:write</Code>) expires in {shortLivedDays} days at most. Egg enforces this when you create
                the token and when you edit it.
              </li>
              <li>
                Those scopes only work while the matching switch is on for that server. Turn it off and the token stops
                working there, whatever it holds.
              </li>
              <li>
                Environment variables can be listed by name with <Code>env:read</Code>, never by value.
              </li>
              <li>
                A token is only read from the <Code>Authorization</Code> header. The API and the MCP endpoint ignore
                cookies, so a signed-in browser cannot act through them. A wrong, expired or revoked token gets the same
                answer.
              </li>
              <li>
                A token reaches only your own projects, servers and domains. Another person&apos;s id is answered as not
                found.
              </li>
            </Points>
            <Sub>What a token cannot do</Sub>
            <p className="m-0">
              Remove leftovers, change the container permissions, or manage your account, your sessions or your tokens.
              A token cannot create another token. Those stay with a signed-in browser on purpose.
            </p>
          </Section>

          <Section id="webhooks" title={title("webhooks")} number={num("webhooks")}>
            <Sub>From GitHub to Egg</Sub>
            <p className="m-0">
              The GitHub endpoint is public, so the only thing that lets a request in is a valid signature.
            </p>
            <Points>
              <li>
                Egg checks the HMAC-SHA256 signature over the exact bytes it received, with a comparison that takes the
                same time whether it matches or not. A missing or wrong signature is refused and nothing runs.
              </li>
              <li>
                Egg remembers each delivery id for {numberWord(F.deliveryHours)} hour. A signed delivery that arrives
                again in that time, whether a replay or a retry that already worked, is answered without being run a
                second time. If handling a delivery fails, the id is forgotten so GitHub&apos;s retry goes through.
              </li>
              <li>
                The database itself refuses a second active deploy of the same commit on the same branch from GitHub, a
                second active deploy started by a deploy hook for the same project, and a second live job for one
                deployment. Two deliveries that arrive at the same moment, or on two server processes, cannot both
                start one. The second one is dropped, and a deploy hook answers 409.
              </li>
              <li>
                The body is read up to {F.githubBodyMb} MB and no further. A branch name or commit hash from a push is
                checked before it reaches git, so a branch name that starts with a dash is refused instead of being read
                as a git option.
              </li>
            </Points>
            <Sub>Deploy hooks</Sub>
            <p className="m-0">
              A deploy hook is a secret URL. The secret is 192 bits long, and Egg keeps only its hash, so there is
              nothing in the database to copy. The request body is limited to {F.deployHookBodyKb} KB and may only name
              a branch.
            </p>
            <Sub>From Egg to you</Sub>
            <p className="m-0">
              Egg can send a message to an address you choose when a deployment starts, succeeds or fails. Every request
              is signed so your receiver can tell it came from Egg and was not changed on the way.
            </p>
            <Points>
              <li>
                The <Code>X-Egg-Signature</Code> header carries a timestamp and an HMAC-SHA256 of the timestamp
                and the body, made with that webhook&apos;s secret. Your receiver should also refuse a timestamp more
                than five minutes old.
              </li>
              <li>
                The address must be https on the standard port, with a domain name rather than an IP address, and no
                user name or password in it.
              </li>
              <li>
                When Egg sends, it looks the name up and refuses if any answer is a private, loopback, link-local or
                cloud metadata address. It then connects to the address it checked, so the name cannot be switched
                afterwards.
              </li>
              <li>
                Redirects are never followed. A request that takes longer than 5 seconds is dropped. Egg reads at most
                4 KB of the answer and throws it away. Only a short error code is kept.
              </li>
            </Points>
            <p className="m-0">
              The check that asks whether your domain&apos;s app answers uses the same address rules and does not follow
              redirects either. Alerts only go to Discord and Slack addresses. Those are stored encrypted, and
              redirects are not followed.
            </p>
          </Section>

          <Section id="domains" title={title("domains")} number={num("domains")}>
            <p className="m-0">
              Nest routes the traffic for a domain, not Egg. What Egg decides is which domains it will record for your
              project and show as Active.
            </p>
            <Points>
              <li>
                A name on Nest&apos;s list of reserved names, such as <Code>admin</Code> or <Code>api</Code>, is refused,
                with a few more Egg adds for itself. That holds as a name on its own and as the name under{" "}
                <Code>hackclub.app</Code>, <Code>hackclub.com</Code> and <Code>hackclub.dev</Code>.
              </li>
              <li>
                Under <Code>hackclub.app</Code> you can only use your own Nest name,{" "}
                <Code>&lt;your-name&gt;.hackclub.app</Code>, and names under it.
              </li>
              <li>
                A custom domain has to be a public domain name. An IP address, <Code>localhost</Code> and internal names
                such as <Code>.local</Code> are refused.
              </li>
              <li>
                A custom domain stays Pending until Egg finds the DNS record Nest checks for: a TXT record{" "}
                <Code>domain-verification=&lt;your-name&gt;</Code>, or a CNAME to{" "}
                <Code>&lt;your-name&gt;.hackclub.app</Code>. Your own Nest name, and a subdomain of a domain you have
                already verified on the same server, are Active at once. If the record of a verified domain goes
                missing, it is marked Invalid and is not deleted.
              </li>
            </Points>
          </Section>

          <Section id="builds" title={title("builds")} number={num("builds")}>
            <p className="m-0">
              Your code is built in a Docker container on Egg&apos;s server, never on your Nest container.
            </p>
            <Points>
              <li>
                The build gets {buildMemoryGb} GB of memory, {F.buildCpus} CPUs and at most {F.buildProcesses}{" "}
                processes. It has every Linux capability removed, cannot gain new privileges and publishes no ports. It
                can reach the internet, because installing packages needs that.
              </li>
              <li>
                Your environment variables reach the build, but a variable with a name such as <Code>DOCKER_HOST</Code>{" "}
                or <Code>LD_PRELOAD</Code> cannot change how Egg runs Docker.
              </li>
              <li>
                A root folder or output folder in your repository that is a link leading outside the repository is
                refused, so a build cannot be made to upload other files from Egg&apos;s server.
              </li>
              <li>
                When you import a project from GitHub, Egg checks that the GitHub connection belongs to your account
                before it uses it, so nobody can use another person&apos;s connection to clone their private
                repositories.
              </li>
            </Points>
          </Section>

          <Section id="analytics" title={title("analytics")} number={num("analytics")}>
            <p className="m-0">
              Page analytics are off until you turn them on for a project. They count the visitors of your site, not of
              Egg. The script you add to your site is built to collect as little as it can.
            </p>
            <Points>
              <li>It sets no cookie.</li>
              <li>
                A referrer is stored as its host only, such as <Code>news.example.com</Code>, never the address or the
                query string. The campaign values <Code>utm_source</Code>, <Code>utm_medium</Code> and{" "}
                <Code>utm_campaign</Code> are cut to {F.utmChars} characters, and other parameters are not read.
              </li>
              <li>
                An IP address is never stored. Egg uses it for a short rate limit held in memory. It also goes, with
                the browser string, the project and the date, into a one-way hash that counts a day&apos;s visitors.
                That hash changes every day, so it cannot follow anyone from one day to the next.
              </li>
              <li>
                When the browser sends Do Not Track or Global Privacy Control, the script sends nothing and adds no
                listener. The collector also drops a request that carries either signal.
              </li>
              <li>
                Returning visitors are counted only when you turn retention on for the project. The script then keeps a
                random id in the browser&apos;s local storage, not in a cookie, and removes it when retention is
                turned off. Egg stores only an HMAC of that id with the project, made with a key that changes every{" "}
                {F.retentionRotationDays} days. The id itself is never stored. A visitor who returns after the key
                changes counts as new.
              </li>
              <li>
                Page views and events are deleted after {F.analyticsKeepDays} days. Live view heartbeats are deleted
                after an hour.
              </li>
            </Points>
          </Section>

          <Section id="logs" title={title("logs")} number={num("logs")}>
            <p className="m-0">
              Egg keeps an audit log of what happens on your account. Your Activity page shows your own entries, newest
              first.
            </p>
            <Sub>What is logged</Sub>
            <Points>
              <li>Project, domain, deploy hook and webhook changes, deploys, redeploys, rollbacks and cancels.</li>
              <li>Environment variables set or removed, by name and target only.</li>
              <li>SSH key replacements, tokens created, edited and revoked, and sign-outs.</li>
              <li>Hack Club sign-ins you made to confirm a sensitive change.</li>
              <li>Changes to the three switches, by switch name.</li>
              <li>
                A terminal opening and closing, and how long it was open. Files saved, created, renamed or deleted,
                with their paths. Leftovers removed, by name.
              </li>
            </Points>
            <p className="m-0">An action made with an access token is recorded as made by that token.</p>
            <Sub>What is not logged</Sub>
            <p className="m-0">
              Environment variable values, the SSH private key, token and webhook secrets, session values, file
              contents, and what you type in a terminal. The Activity page also drops any field whose name or value
              looks like a secret before it shows anything.
            </p>
            <Sub>Build output</Sub>
            <p className="m-0">
              Build output, and the error message shown for a failed deploy, are stored with your environment variable
              values masked. A value that runs over several lines, such as a private key, is masked line by line for
              every line of 8 characters or more. The base64 and URL-encoded forms of a value are masked too. A value of
              2 or 3 characters is masked only where it stands alone, not inside a longer word or number. A value of
              one character is never masked, on purpose, so that a setting such as <Code>CI=1</Code> stays readable
              in the log. Masking only finds the forms listed here, so a build that prints a secret in some other form
              will show it. At most {F.buildLogLines.toLocaleString("en-US")} lines are kept for one deployment, then one line says
              the rest was cut.
            </p>
            <p className="m-0">
              If the log cannot be written, the action still goes through. The log is a record, not a gate.
            </p>
          </Section>

          <Section id="remove" title={title("remove")} number={num("remove")}>
            <Sub>When you disconnect a server</Sub>
            <p className="m-0">
              Egg first closes any terminal open on that server, so a root shell cannot outlive its key. Then it deletes
              its copy of the encrypted SSH key and the pinned host key, so Egg cannot connect to the container again. It
              does not connect to the container while doing this, so nothing on the container is changed and your apps
              keep running. Your tokens and your activity log are not tied to a server, so they stay.
            </p>
            <p className="m-0">
              Whether the projects on that server go too is your choice. The confirmation has a box, unchecked, that
              reads &quot;Also delete the projects on this server&quot; with the number of them. Left unchecked, the
              projects stay, with their environment variables, deployments, build logs and domains. Their apps keep
              running, but Egg stops managing them until you connect the same Nest account again. If you check the box,
              the projects are deleted with their environment variables, deployments and build logs, domains, usage and
              page-view numbers, and alert history.
            </p>
            <Sub>Remove Egg completely</Sub>
            <p className="m-0">
              Removing Egg takes two steps. Do the second even if you skip the first, because it is the one that cuts
              off access.
            </p>
            <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 marker:text-muted-foreground">
              <li>In Egg, disconnect the server. Egg cannot connect to the container again. Check the box to also delete its projects, or leave it to keep them.</li>
              <li>
                In the Nest dashboard, delete the key on the SSH Keys page. Egg shows the key&apos;s fingerprint, and
                the key&apos;s comment is <Code>egg:</Code> followed by your Nest username. Once it is deleted,
                nothing can use it, even a copy.
              </li>
            </ol>
            <Sub>What stays on the container</Sub>
            <p className="m-0">
              Your apps keep running. The <Code>~/.egg</Code> folder, with its releases, <Code>shared/</Code>{" "}
              files and <Code>.env</Code> files, and the <Code>egg-</Code> services also stay, because Egg does not
              reconnect to clean up. To clear them, stop and delete the <Code>egg-</Code> services and delete{" "}
              <Code>~/.egg</Code> yourself. Do that after you have copied anything in <Code>shared/</Code> that
              you want to keep.
            </p>
          </Section>

          <Section id="gaps" title={title("gaps")} number={num("gaps")}>
            <p className="m-0">
              The behaviour on this page was checked against the code, and each fix came with a test. These are the
              gaps that are known.
            </p>
            <Points>
              <li>
                Egg can only be as sure of a new server as you are. It shows you the fingerprint, but it has no earlier
                key to compare it with. If you confirm without checking it against the one Nest shows, something sitting
                between Egg and Nest on that first connection would not be noticed. Every connection after that is
                checked.
              </li>
              <li>
                The content policy still allows inline scripts, so a script injected into a page would not be blocked
                by it. A per-request nonce, which would close this, is not in place. It breaks the app under the
                current setup: the pages are built ahead of time with <Code>cacheComponents</Code>, so their start-up
                scripts exist before any request and cannot carry a nonce. Two ways to fix it are known: turn{" "}
                <Code>cacheComponents</Code> off, or move to Next&apos;s experimental subresource-integrity mode. Neither
                has been chosen. The rules against framing, plug-ins and form hijacking are not affected.
              </li>
              <li>
                Rate limits, the page-view and event limits of the analytics collector, and the delivery list are kept in
                memory by each server process, so a restart clears them and each process counts on its own. Limits by
                address work only when <Code>TRUST_PROXY</Code> is on. With it off, the collector counts every visitor
                as one address.
              </li>
              <li>
                The public endpoint that receives analytics page views reads the whole request body before it keeps the
                first 5,000 characters. It has no size cap of its own yet.
              </li>
              <li>
                The live view of a build log checks your sign-in when it opens and then keeps running for a few hours,
                so it can outlast a sign-out.
              </li>
              <li>The build container can reach the internet, as noted under Builds.</li>
              <li>
                A person running Egg themselves can set <Code>BUILD_RUNNER=local</Code>, which builds with no
                isolation at all. It is meant for development only, and only for code you trust.
              </li>
              <li>
                Dependencies are checked by running <Code>pnpm audit:prod</Code>, which fails on a high or critical
                finding. There is no CI workflow yet, so nothing runs it automatically.
              </li>
            </Points>
          </Section>

          <Section id="report" title={title("report")} number={num("report")}>
            <p className="m-0">
              If you find a way to get past anything on this page, please tell the maintainer privately before telling
              anyone else.
            </p>
            <Points>
              <li>
                Open a{" "}
                <TextLink href={ADVISORY_URL} external>
                  private security advisory
                </TextLink>{" "}
                on the repository. Only the maintainer can see it.
              </li>
              <li>
                If you cannot use GitHub advisories, contact the maintainer through their{" "}
                <TextLink href={MAINTAINER_URL} external>
                  GitHub profile
                </TextLink>
                .
              </li>
            </Points>
            <p className="m-0">
              Please do not open a public issue for a vulnerability. Say what you found, the steps to repeat it and
              which page or endpoint it is on. Leave real keys, tokens and passwords out of the report.
            </p>
          </Section>
        </article>
      </div>
    </>
  );
}
