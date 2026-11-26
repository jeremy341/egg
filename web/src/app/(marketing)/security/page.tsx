import type { Metadata } from "next";
import { HOME_FACTS, TOKEN_SCOPES, numberWord } from "@/components/marketing/home-facts";
import { REPO_URL } from "@/lib/site";
import { Code, Points, Section, Sub, Term, Terms, TextLink } from "./_components/parts";

export const metadata: Metadata = {
  title: "Security",
  description:
    "What Egg can and cannot touch on your Nest container, how it protects your keys and account, what it logs, how to report a vulnerability and how to remove it.",
};

const { reauthMinutes, terminalIdleMinutes, terminalMaxMinutes, shortLivedDays } = HOME_FACTS;

/** The private advisory form on the repository, and the maintainer's GitHub profile, both built from REPO_URL. */
const ADVISORY_URL = `${REPO_URL}/security/advisories/new`;
const MAINTAINER_URL = REPO_URL.split("/").slice(0, 4).join("/");

const SECTIONS = [
  { id: "touch", title: "What Egg can touch" },
  { id: "switches", title: "The three switches" },
  { id: "secrets", title: "Keys and secrets" },
  { id: "accounts", title: "Accounts and sign-in" },
  { id: "tokens", title: "Access tokens" },
  { id: "outbound", title: "Webhooks and outbound requests" },
  { id: "logs", title: "What is logged and what is not" },
  { id: "report", title: "Report a vulnerability" },
  { id: "remove", title: "Remove Egg" },
] as const;

const title = (id: (typeof SECTIONS)[number]["id"]) => SECTIONS.find((s) => s.id === id)!.title;

export default function SecurityPage() {
  return (
    <>
      <header className="board-col pt-[60px] lg:pt-[120px]">
        <h1 className="max-w-[18ch] font-pixel text-[clamp(2.25rem,5vw,4rem)] leading-[1.05] font-medium text-balance text-foreground">
          How Egg protects your container
        </h1>
        <p className="mt-5 max-w-[60ch] text-[1.0625rem] leading-[1.75rem] text-reading">
          Egg is an add-on that connects to a Hack Club Nest container you already own. It is an independent project,
          not part of Nest. This page says what Egg reaches, what it keeps, what it writes down and how to get rid of
          it. In short: it only manages what it created, the risky features start switched off, and every secret is
          encrypted or hashed.
        </p>
      </header>

      <div className="board-col mt-10 grid items-start gap-6 pb-[90px] lg:mt-[60px] lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8 lg:pb-[150px]">
        <nav aria-label="On this page" className="border border-border bg-background p-5 lg:sticky lg:top-24">
          <p className="m-0 text-[0.875rem] leading-6 font-semibold text-foreground">On this page</p>
          <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-x-6 p-0 sm:grid-cols-2 lg:grid-cols-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="block py-1.5 text-[0.9375rem] leading-6 text-muted-foreground underline decoration-transparent underline-offset-4 outline-offset-2 transition-[color,text-decoration-color] duration-(--dur-fast) hover:text-foreground hover:decoration-current focus-visible:outline-2 focus-visible:outline-[var(--ds-focus-color)]"
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="border border-border bg-background">
          <Section id="touch" title={title("touch")}>
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
                <Code>~/.nest-deploy/&lt;project&gt;/</Code> holds the releases, an upload area, a <Code>shared/</Code>{" "}
                folder that deploys never touch, and a marker file named <Code>.nest-deploy-managed</Code>.
              </Term>
              <Term name="One service for each project">
                A systemd service named <Code>nd-&lt;project&gt;</Code>. A branch preview gets its own service, named{" "}
                <Code>nd-&lt;project&gt;-pv-</Code> and eight more characters. Each one carries a{" "}
                <Code># nest-deploy:managed</Code> comment.
              </Term>
              <Term name="The current link">
                <Code>~/.nest-deploy/&lt;project&gt;/current</Code> is a link to the live release. A deploy points it at
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
              overwritten, stopped or removed, even if its name starts with <Code>nd-</Code>. Before a first deploy
              Egg checks the container for apps that are already running and for ports and service names that are
              already taken. Services and folders from older versions of Egg, from before the markers, are recognised
              by their description or by holding only Egg&apos;s own folders.
            </p>
          </Section>

          <Section id="switches" title={title("switches")}>
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
                Stops and removes services whose names start with <Code>nd-</Code>, and folders inside{" "}
                <Code>~/.nest-deploy</Code> that no project uses any more. It only removes what carries Egg&apos;s
                marker, and it asks you to confirm each removal.
              </Term>
            </Terms>
            <p className="m-0">
              To turn on the terminal or file changes, Egg sends you back to Hack Club to sign in again. The sign-in has
              to be from the last {numberWord(reauthMinutes)} minutes. Turning a switch off never asks. Browsing and
              reading files in a project&apos;s folder works with every switch off, and it is read only.
            </p>
            <p className="m-0">
              Servers connected before these defaults existed kept the value they already had. Open Account and check
              each server.
            </p>
          </Section>

          <Section id="secrets" title={title("secrets")}>
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
                The first time Egg connects, it remembers the SSH host key of Nest. If that key later changes, Egg stops
                before sending anything and tells you.
              </Term>
              <Term name="Environment variables">
                Encrypted the same way as the SSH key, and write-only: the dashboard and the API list their names and
                never their values. At deploy time Egg decrypts them, gives them to the build and writes them to a{" "}
                <Code>.env</Code> file on your container with mode 600, so only your own user can read it. On the
                container that file is plain text, protected by its permissions.
              </Term>
              <Term name="Tokens and hooks">
                Access tokens and deploy hooks are stored as a SHA-256 hash and shown once, when you create them. Egg
                cannot show them again. Webhook secrets are stored encrypted and shown once.
              </Term>
            </Terms>
          </Section>

          <Section id="accounts" title={title("accounts")}>
            <p className="m-0">
              You sign in with Hack Club. Egg asks for your name, email and Hack Club ID, and keeps those (plus a Slack
              ID when Hack Club sends one). It never sees your Hack Club password.
            </p>
            <Points>
              <li>
                A session is a random value in a cookie that scripts on the page cannot read. Egg stores only a hash of
                it. A session lasts 30 days, and each new sign-in replaces the old one.
              </li>
              <li>
                Account lists every browser you are signed in on. You can sign one out, or sign out every browser except
                the one you are using. Doing either closes any open terminal on your account.
              </li>
              <li>
                Deleting your account asks you to type your name. It removes everything under the account, including
                the activity log. Apps already running on your container are left running.
              </li>
            </Points>
            <Sub>When you disconnect a server</Sub>
            <p className="m-0">
              Egg deletes its record of that server: the encrypted SSH key, and with it every project on that server,
              their environment variables, deployments and build logs, domains, usage and page-view numbers, and alert
              history. It does not connect to the container while doing this, so nothing on the container is changed and
              your apps keep running. Your tokens and your activity log are not tied to a server, so they stay.
            </p>
          </Section>

          <Section id="tokens" title={title("tokens")}>
            <p className="m-0">
              An access token lets a script or an AI agent use the API and the MCP endpoint. Each token has a name, a
              list of permissions called scopes (there are {TOKEN_SCOPES.length}) and an expiry of 7, 30, 90 or 365
              days. Revoking a token or letting it expire takes effect on the very next request.
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
            </Points>
            <Sub>What a token cannot do</Sub>
            <p className="m-0">
              Remove leftovers, change the container permissions, or manage your account, your sessions or your tokens.
              A token cannot create another token. Those stay with a signed-in browser on purpose.
            </p>
          </Section>

          <Section id="outbound" title={title("outbound")}>
            <p className="m-0">
              Egg can send a message to an address you choose when a deployment starts, succeeds or fails. Every request
              is signed so your receiver can tell it came from Egg and was not changed on the way.
            </p>
            <Points>
              <li>
                The <Code>X-NestDeploy-Signature</Code> header carries a timestamp and an HMAC-SHA256 of the timestamp
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

          <Section id="logs" title={title("logs")}>
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
              looks like a secret before it shows anything. Build output is stored with your environment variable
              values masked, but values shorter than 4 characters are not masked, so do not use a very short value as a
              secret.
            </p>
            <p className="m-0">
              If the log cannot be written, the action still goes through. The log is a record, not a gate.
            </p>
          </Section>

          <Section id="report" title={title("report")}>
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

          <Section id="remove" title={title("remove")}>
            <p className="m-0">
              Removing Egg takes two steps. Do the second even if you skip the first, because it is the one that cuts
              off access.
            </p>
            <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 marker:text-muted-foreground">
              <li>
                In Egg, disconnect the server. Egg deletes its record of the server and its encrypted key, and cannot
                connect to the container again.
              </li>
              <li>
                In the Nest dashboard, delete the key on the SSH Keys page. Egg shows the key&apos;s fingerprint, and
                the key&apos;s comment is <Code>nest-deploy:</Code> followed by your Nest username. Once it is deleted,
                nothing can use it, even a copy.
              </li>
            </ol>
            <Sub>What stays on the container</Sub>
            <p className="m-0">
              Your apps keep running. The <Code>~/.nest-deploy</Code> folder, with its releases, <Code>shared/</Code>{" "}
              files and <Code>.env</Code> files, and the <Code>nd-</Code> services also stay, because Egg does not
              reconnect to clean up. To clear them, stop and delete the <Code>nd-</Code> services and delete{" "}
              <Code>~/.nest-deploy</Code> yourself. Do that after you have copied anything in <Code>shared/</Code> that
              you want to keep.
            </p>
          </Section>
        </article>
      </div>
    </>
  );
}
