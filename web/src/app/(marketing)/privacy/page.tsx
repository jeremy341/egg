import type { Metadata } from "next";
import { Code, DOCUMENT_LAYOUT, Lead, Notice, PageTitle, Points, SHEET, Section, Term, Terms, TextLink } from "../security/_components/parts";
import { Toc } from "../security/_components/toc";

export const metadata: Metadata = {
  title: "Privacy and data use",
  description:
    "A plain-language account of the data Egg handles, where it goes, how long it stays, and the limits of the protections in the code.",
};

const SECTIONS = [
  { id: "scope", title: "Who this page is for" },
  { id: "data", title: "What Egg stores" },
  { id: "reports", title: "Vulnerability reports" },
  { id: "recipients", title: "Where data goes" },
  { id: "visitors", title: "Analytics on deployed sites" },
  { id: "browser", title: "Cookies and browser storage" },
  { id: "retention", title: "Retention and deletion" },
  { id: "security", title: "Security and its limits" },
  { id: "choices", title: "Your choices" },
] as const;

const title = (id: (typeof SECTIONS)[number]["id"]) => SECTIONS.find((s) => s.id === id)!.title;

export default function PrivacyPage() {
  return (
    <>
      <header className="board-col pt-[60px] lg:pt-[120px]">
        <p className="mb-4 font-mono text-[0.8125rem] uppercase tracking-[0.12em] text-muted-foreground">
          Data, plainly · Updated 12 November 2026
        </p>
        <PageTitle>Privacy and data use</PageTitle>
        <Lead>
          This page describes what this version of Egg does with information, based on the code in this repository. Egg
          is a dashboard that connects to Hack Club Nest servers. It is an independent project, not an official Hack
          Club or Nest service.
        </Lead>
        <Notice title="Read this with the hosting context in mind.">
          This is a technical summary, not legal advice, a contract, or a promise that a particular deployment meets
          privacy laws or security standards. The operator, hosting provider, reverse proxy, backups, and local
          configuration can affect what is collected and who can access it. If you use someone else’s Egg instance, ask
          that operator for their applicable privacy notice. If you run Egg yourself, you are responsible for your
          instance and for any notice shown to people whose data it handles.
        </Notice>
      </header>

      <div className={DOCUMENT_LAYOUT}>
        <Toc sections={SECTIONS} />
        <article className={SHEET}>
          <Section id="scope" title={title("scope")}>
            <p className="m-0">
              Egg has two distinct data paths. The dashboard stores account and deployment-management data. Separately,
              an optional script can send a small set of analytics from sites that an owner deploys. Turning on Egg
              analytics does not mean Egg collects every request to those sites; the browser script reports selected
              events to the configured Egg instance.
            </p>
            <p className="m-0">
              The code can describe its own database behavior, but it cannot tell you who administers a hosted copy,
              how their infrastructure logs traffic, which backups they keep, or how they respond to legal requests.
              Self-hosted installations store their database and deployment work on the operator’s systems.
            </p>
          </Section>

          <Section id="data" title={title("data")}>
            <Terms>
              <Term name="Account and sign-in">
                With Hack Club sign-in, Egg stores the Hack Club account identifier, name, email address, and Slack
                identifier if supplied by Hack Club. Egg does not receive your Hack Club password. Local sign-in for a
                self-hosted instance creates a local owner record without an email. Sign-in sessions store a hash of
                the session token, its dates, and a browser user-agent string; the raw session token stays in an
                HTTP-only cookie. API access tokens are stored as hashes with their names, scopes, expiry, and
                last-used time.
              </Term>
              <Term name="Connected Nest servers">
                Egg stores the Nest username, host and port, its generated public SSH key, a sealed private key, host
                key fingerprint, connection status, and capability checks. The private key is encrypted in the
                database using <Code>APP_SECRET</Code>. At deploy time, Egg uses SSH to send build output, start and
                service configuration, and the project’s environment variables to your Nest container.
              </Term>
              <Term name="Projects and deployments">
                Project records include names and slugs, repository address and name, branch, runtime, build and start
                commands, paths, ports, domains, alert settings, and integration identifiers. Deployment history
                includes branch, commit identifier, commit message and author when available, trigger type, timestamps,
                status, and error details. Environment-variable names and targets are stored with sealed values. Build
                output and remote runtime logs may contain user code or application output; known configured secrets
                are masked from build logs, but text generated by arbitrary builds cannot be reliably recognized as
                sensitive.
              </Term>
              <Term name="Account activity and preferences">
                Egg records account actions such as sign-ins, settings changes, deployments, token changes, and server
                operations. Activity metadata is filtered to remove secret-like fields, but it still describes actions
                and affected resources. Preferences include display name, theme, accent, density, reduced motion, and
                default branch.
              </Term>
              <Term name="Monitoring and status pages">
                If monitoring is running, Egg stores service state, outage and recovery events, alert history, and
                sampled CPU, memory, and disk figures. A public status page can disclose a project’s current state,
                recent outages, and 30-day uptime to anyone with its unguessable status-page address.
              </Term>
              <Term name="Homepage listing (opt-in)">
                Off for every project. If a project’s owner turns it on, and only for a repository that GitHub confirms is
                public, the Egg homepage shows that project’s latest deployments to anyone: the first line of the commit
                message, the short commit, the branch, the state, Production or Preview, the time and the repository name,
                each linking to the commit on GitHub. It never shows build logs, servers, ports, environment variables or
                account names. The list is rebuilt at most once a minute and asks GitHub again each time, so a repository
                that turns private, or an owner who turns the setting off, leaves the homepage within a minute.
              </Term>
              <Term name="Integrations">
                Egg stores GitHub App installation IDs and account names/types. It does not store the temporary GitHub
                user OAuth token used while linking an installation; short-lived installation tokens are held in
                process memory. Optional notification URLs for Discord or Slack, and custom webhook destinations and
                secrets, are sealed in the database. Custom webhook delivery history stores event, status, attempt
                count, and a short error code, not the destination secret.
              </Term>
            </Terms>
          </Section>

          <Section id="reports" title={title("reports")}>
            <p className="m-0">
              If the operator enables the private inbox, the security page accepts a title, affected location,
              impact, reproduction steps in Markdown, and up to three PNG/JPEG evidence images. A reporter can
              optionally supply a name and reply address. In anonymous mode, those identity fields are discarded;
              Egg does not attach the signed-in account or store an IP address with the report. Anonymous reports
              have no reply channel. Report text, screenshots, filenames, and image metadata can still identify you,
              so remove credentials and unrelated personal data before sending.
            </p>
            <p className="m-0">
              The text, supplied identity, and evidence are encrypted in the database using <Code>APP_SECRET</Code>.
              Only the exact account configured as this instance’s security administrator can read or manage the
              inbox through Egg. Status, receipt date, identifier, and stored size are ordinary database metadata.
              Reports stay until that administrator deletes them; deletion removes the live report and evidence,
              while database backups can retain older copies under the operator’s separate policy. The inbox stops
              accepting submissions at its count or storage limit. Administrator access and status/deletion actions
              write account activity records containing the report identifier, never its text or evidence; these
              audit records can remain after the report itself is deleted.
            </p>
            <p className="m-0">
              Submissions are limited in two layers. The first is process-local and kept in memory: when a trusted
              client address is available, it uses a one-way hash of it; otherwise callers share a bucket. A restart
              clears it, and multiple processes count separately. The second is kept in the database so it survives
              restarts: Egg counts how many reports arrived in the last hour and day, and, when a trusted client
              address is available, stores a keyed digest of that address for up to one day to cap how many reports
              one network can send. The digest is an HMAC under a key derived from <Code>APP_SECRET</Code>, not the
              address, and it is kept in a row of its own, not with the report. Digests older than a day are deleted
              on the next submission and by a periodic clean-up. The web server, reverse proxy, host, or network
              provider may independently log addresses and other request metadata. Anonymous submission therefore
              does not promise absolute anonymity. The confirmation explains that abuse may lead to future IP-based
              tracking or blocking, including permanent bans, with an updated notice before new collection begins;
              this form does not implement permanent bans, and the one-day digest above is the only trace of an
              address it keeps.
            </p>
          </Section>

          <Section id="recipients" title={title("recipients")}>
            <Terms>
              <Term name="Hack Club Auth">
                When you use Hack Club sign-in, the browser is sent to Hack Club Auth. Egg exchanges the returned
                authorization code and reads the profile fields listed above. A self-hosted local-mode instance can
                use local sign-in instead.
              </Term>
              <Term name="GitHub">
                If you connect GitHub, Egg requests repository and installation information from GitHub. For a build,
                the worker clones the chosen repository and runs its configured build steps. Repository source is
                temporarily present in the worker’s build workspace; the code removes that workspace after ordinary
                success or failure, though a process or machine crash can leave temporary files behind. Builds may
                download dependencies from registries contacted by the package manager. Repository contents and build
                output are not sent to GitHub by Egg beyond the GitHub API and Git operations needed for the feature.
              </Term>
              <Term name="Hack Club Nest and your server">
                Egg opens SSH connections to the Nest server you configured. It sends selected source build artifacts,
                environment variables, and service commands to that server. These are stored and used there under your
                Nest account. Egg does not remove live applications or their files when you delete your Egg account;
                remove them from Nest separately if you no longer want them there.
              </Term>
              <Term name="Discord, Slack, and custom webhooks">
                If configured, Discord or Slack receives project names, deployment branch and short commit details,
                deployment outcome, timing, and links, or a status/recovery message. A custom webhook receives a
                signed, allowlisted event containing project and deployment identifiers, branch, commit identifier,
                state, and time. It does not include environment-variable values, logs, commit messages, or error text.
                The recipient service has its own privacy practices and retention.
              </Term>
              <Term name="Your infrastructure provider">
                The machine, database, reverse proxy, container runtime, and backup storage are selected by the
                operator. They may have their own system and network logs. The Egg code does not control or fully
                enumerate those logs. In the provided self-hosted Compose setup, Caddy proxies requests to the app;
                a different installation may use different infrastructure.
              </Term>
            </Terms>
          </Section>

          <Section id="visitors" title={title("visitors")}>
            <p className="m-0">
              Analytics is optional. It starts off when analytics is enabled for a new project, and its additional
              features are separate switches. The script respects Do Not Track and Global Privacy Control, skips
              localhost, and does not set an analytics cookie.
            </p>
            <Terms>
              <Term name="Page views and route names">
                By default the script reports <Code>/</Code> as the route. A site can set a route template in{" "}
                <Code>data-egg-path</Code> on its <Code>&lt;html&gt;</Code> element, for example <Code>/users/:id</Code>.
                The script sends that value, not the browser’s raw path. The site owner controls this attribute, so a
                badly configured site can still put a personal value or secret into it. Old snippets without the
                template marker are stored as <Code>/</Code> by the current collector.
              </Term>
              <Term name="Visitor counting and technical request data">
                The analytics request necessarily reaches the Egg server with network and browser request headers.
                The collector uses the IP address for short in-memory rate limits and combines it with the user-agent,
                project and date to make a daily visitor hash. The IP and user-agent are not written into analytics
                rows. Only when Record visitor countries is on is the IP address also used for one country lookup,
                described below. The daily hash is not designed to follow someone across days, but it is still a pseudonymous
                identifier for that day. Reverse proxies or hosting providers may keep separate connection logs.
              </Term>
              <Term name="Visitor countries">
                Record visitor countries is off by default and is a separate switch for each project. When it is on,
                the collector looks the visitor’s IP address up in a country database bundled with Egg during the same
                request, so the address is not sent to another service. Only the two-letter country code, such as{" "}
                <Code>FR</Code>, is stored with the page view. Egg does not store or log the IP address for this, and
                keeps no city, region or position. An address that is local or private, or not in the database, has
                no country, and nothing is stored for it. The dashboard shows counts under 10 as “fewer than 10” and
                rounds larger ones. This product includes GeoLite2 data created by MaxMind, available from
                https://www.maxmind.com.
              </Term>
              <Term name="Optional analytics switches">
                Referrers store only the referring host. Campaigns is a separate switch, off by default. It stores{" "}
                <Code>utm_source</Code>, <Code>utm_medium</Code> and <Code>utm_campaign</Code> only when the value
                exactly matches one the site owner has listed for that project (up to 20 values for each, 40
                characters at most); any other value is dropped before it is stored. Clicks and funnels use names placed in{" "}
                <Code>data-egg-track</Code>; custom events may include a <Code>data-egg-value</Code>. The script does
                not read form values, visible button text, or accessible labels. Site owners should use stable,
                non-personal labels and values because any label they explicitly put in these attributes can be
                recorded. Time on page is stored in a broad time bucket. Speed metrics store rounded browser timing
                figures and the declared route template. Exception messages are not collected by the current snippet
                or collector.
              </Term>
              <Term name="Turning a switch off">
                Turning Referrers, Campaigns, Retention or Record visitor countries off deletes what that switch
                stored for the project: the referring hosts, the campaign values, the retention codes or the country
                codes. The other switches stop recording when turned off, and what they already stored stays until it
                ages out under the retention period below.
              </Term>
              <Term name="Retention and live view">
                With Retention enabled, the script creates a random ID in that visitor’s <Code>localStorage</Code> and
                sends it to the collector. Egg stores a keyed HMAC derived from it, not the ID; the HMAC key rotates
                every 90 days. Turning Retention off removes the browser ID on the next visit to a page with the
                snippet and clears stored retention codes for that project. Live-view heartbeats use the same opt-in
                retention ID and expire after an hour.
              </Term>
            </Terms>
          </Section>

          <Section id="browser" title={title("browser")}>
            <p className="m-0">
              The dashboard uses an essential <Code>egg_session</Code> cookie for sign-in. It is HTTP-only, SameSite
              Lax, and marked Secure in production. A temporary HTTP-only OAuth state cookie is used during Hack Club
              sign-in and is limited to ten minutes. The dashboard also uses an <Code>egg_prefs</Code> cookie and
              browser local storage for appearance settings. The analytics snippet does not set cookies; local storage
              is used only for the optional returning-visitor feature described above.
            </p>
          </Section>

          <Section id="retention" title={title("retention")}>
            <Terms>
              <Term name="Analytics and live data">
                Page views, analytics events, speed measurements and error records are kept for 30, 60 or 90 days,
                as the site owner chooses for each project; a project keeps 90 days until it is changed. Live
                heartbeats expire after one hour. The app attempts analytics cleanup at startup and every 15 minutes
                while it is running. Deletion is therefore not immediate at the exact end of the period, and cleanup
                cannot run while the app is
                stopped. Backups can retain older database copies according to the operator’s backup policy. Older
                exception records captured by a prior version may remain until their normal expiry or backup expiry.
              </Term>
              <Term name="Other stored records">
                Sessions last 30 days and expired session rows are removed opportunistically at sign-in. Access-token
                records remain until removed with the token or account, including metadata for expired or revoked
                tokens. Build logs, deployment history, activity/audit entries, project configuration, and GitHub
                replay-prevention digests (one-way hashes of signed GitHub event bodies) do not have a general
                time-based cleanup in the code. Sampled resource history is intended to be kept for seven days, and
                resolved alert history for 90 days, when the monitor cleanup pass runs; open alerts can remain.
                Custom webhook delivery records are intended to expire after 30 days, but cleanup is attempted only
                about hourly when there is webhook dispatch traffic to matching receivers.
              </Term>
              <Term name="Deleting things">
                You can revoke sessions and tokens, delete projects and servers, disconnect integrations, and delete
                your account from its settings. Account deletion removes the account’s database records and activity
                history. It does not delete services, releases, environment files, shared files, or other data already
                sent to Nest, and it does not erase copies held in backups or third-party systems. Remove those
                separately with the relevant service or operator.
              </Term>
            </Terms>
          </Section>

          <Section id="security" title={title("security")}>
            <p className="m-0">
              Some high-risk values are encrypted before database storage: SSH private keys, project environment
              values, Discord/Slack notification URLs, and custom webhook secrets. Encryption uses AES-256-GCM with a
              key derived from <Code>APP_SECRET</Code>, which is configured outside the database. Session IDs,
              personal API token secrets, deploy-hook tokens, and custom webhook delivery secrets are stored as
              hashes or shown once, as appropriate. These controls reduce exposure from a database-only leak; they do
              not protect against a compromised app host, a compromised <Code>APP_SECRET</Code>, malicious software
              running with app permissions, or an authorized user with access to the values.
            </p>
            <p className="m-0">
              Builds execute project-controlled commands. They run on your own Nest container, under a memory and CPU
              cap, and never on the machine that runs Egg. SSH keys can perform the enabled Nest actions. Security settings and network boundaries
              need to be configured for each deployment; source code alone cannot guarantee a secure installation.
            </p>
            <p className="m-0">
              See the <TextLink href="/security">security page</TextLink> for a code-based description of protections
              and known gaps. That page is also a technical summary, not a certification or guarantee.
            </p>
          </Section>

          <Section id="choices" title={title("choices")}>
            <Points>
              <li>Use account settings to revoke sessions and API tokens, disconnect GitHub, remove webhooks, or delete your account.</li>
              <li>Turn analytics switches off per project. Turning Referrers, Campaigns, Retention or Record visitor countries off deletes what it stored for the project; visitors’ browser IDs are removed when the snippet next runs on their site.</li>
              <li>For a self-hosted instance, contact the operator about database access, backup expiry, infrastructure logs, and deletion requests.</li>
              <li>If you use a hosted copy operated by someone else, contact that operator for data requests. Do not send passwords, keys, tokens, or personal information in a public issue.</li>
              <li>For questions about the code, use the <TextLink href="https://github.com/jeremy341/egg" external>source repository</TextLink>. Code questions are not a substitute for the instance operator’s privacy contact.</li>
            </Points>
            <p className="m-0">
              This page is based on the repository code as of 12 November 2026. Features, operators, and deployment
              configurations can change; check the notice for the specific Egg instance you use.
            </p>
          </Section>
        </article>
      </div>
    </>
  );
}
