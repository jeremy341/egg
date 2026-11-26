import type { ReactNode } from "react";
import { B, C, Callout, H2, InternalLink, List, P, Section, Table } from "../_components/prose";
import { CodeBlock } from "../_components/code-block";
import { docsHref } from "../_data/nav";

/** The links that end each page. One line, named for what the reader can open next. */
const related = (pages: [string, string][]) => (
  <P>
    <B>Related resources:</B>{" "}
    {pages.map(([id, title], i) => (
      <span key={id}>
        {i > 0 ? ", " : ""}
        <InternalLink href={docsHref(id)}>{title}</InternalLink>
      </span>
    ))}
    .
  </P>
);

const addVariable = [
  "curl -sS -X POST \"$EGG_URL/api/v1/projects/$PROJECT_ID/env\" \\",
  "  -H \"Authorization: Bearer $EGG_TOKEN\" \\",
  "  -H \"Content-Type: application/json\" \\",
  "  -H \"Idempotency-Key: $IDEMPOTENCY_KEY\" \\",
  "  --data '{\"envVars\":[{\"key\":\"PUBLIC_ORIGIN\",\"value\":\"https://app.example.com\",\"target\":\"production\"}]}'",
].join("\n");

const createProject = [
  "curl -sS -X POST \"$EGG_URL/api/v1/projects\" \\",
  "  -H \"Authorization: Bearer $EGG_TOKEN\" \\",
  "  -H \"Content-Type: application/json\" \\",
  "  -d '{",
  "    \"serverId\": \"SERVER_ID\",",
  "    \"name\": \"My app\",",
  "    \"repoUrl\": \"https://github.com/OWNER/REPOSITORY.git\",",
  "    \"runtime\": \"node\",",
  "    \"port\": 3000",
  "  }'",
].join("\n");

const deployProject = [
  "curl -sS -X POST \"$EGG_URL/api/v1/projects/$PROJECT_ID/deployments\" \\",
  "  -H \"Authorization: Bearer $EGG_TOKEN\"",
].join("\n");

const requestStats = [
  "curl -sS \"$EGG_URL/api/v1/projects/$PROJECT_ID/request-stats?days=30\" \\",
  "  -H \"Authorization: Bearer $EGG_TOKEN\"",
].join("\n");

const notificationChannels = [
  "curl -sS \"$EGG_URL/api/v1/notification-channels\" \\",
  "  -H \"Authorization: Bearer $EGG_TOKEN\"",
].join("\n");

export const GUIDE_API_A: Record<string, () => ReactNode> = {
  "api-configuration": () => (
    <Section id="api-configuration" intro="Set project variables and deployment settings with the API.">
      <H2 id="api-configuration-what" title="What it does" />
      <P>
        The API lists variable names, adds or replaces variables and removes selected keys. Values are encrypted at rest.
        Each variable has a secret flag, on by default. Only a variable marked non-secret returns its value, from{" "}
        <C>GET /env/values</C>. Secret values are write-only: no endpoint returns them.
      </P>
      <P>
        Each variable has a target. <C>production</C> covers the production branch, <C>preview</C> covers branch previews
        and <C>all</C> covers both. A changed variable reaches the app on the next deploy.
      </P>
      <P>
        All four operations use <C>/api/v1/projects/{"{projectId}"}/env</C>. The method decides what happens.
      </P>
      <Table
        caption="Environment variable operations"
        head={["Method", "What it does"]}
        rows={[
          [
            <C key="k76">GET</C>,
            "Lists names and targets, one page at a time. Needs env:read. Pass limit, then the nextCursor from a response as cursor.",
          ],
          [
            <C key="k80">POST</C>,
            "Adds or replaces the variables you send. Other names and targets stay as they are. Needs env:write.",
          ],
          [
            <C key="k84">PUT</C>,
            "Replaces every variable and target on the project. Names you leave out are deleted. Needs env:write and confirmName.",
          ],
          [
            <C key="k88">DELETE</C>,
            "Removes the named keys, for every target or for one target. Needs env:write and confirmName.",
          ],
        ]}
      />
      <Table
        caption="Environment variable values and the secret flag"
        head={["Method and path", "Scope", "What it does"]}
        rows={[
          [
            <C key="v1">GET /api/v1/projects/{"{projectId}"}/env/values</C>,
            <C key="v2">env:read</C>,
            "Returns the value of each variable marked non-secret. Secret variables are left out.",
          ],
          [
            <C key="v3">PATCH /api/v1/projects/{"{projectId}"}/env/{"{key}"}/{"{target}"}/secret</C>,
            <C key="v4">env:write</C>,
            "Sets the secret flag for one variable and target. Send secret: false to let get_env_vars return its value. Saving a value never changes the flag.",
          ],
        ]}
      />

      <H2 id="api-configuration-parameters" title="Parameters" />
      <List>
        <li>
          <B>projectId.</B> The project id from <C>GET /api/v1/projects</C>.
        </li>
        <li>
          <B>envVars.</B> An array of objects with <C>key</C>, <C>value</C> and <C>target</C>. A key and target pair may
          appear once in a request.
        </li>
        <li>
          <B>target.</B> <C>all</C>, <C>production</C> or <C>preview</C>.
        </li>
        <li>
          <B>confirmName.</B> The exact project name. Required for <C>PUT</C> and <C>DELETE</C>, because those calls can
          remove variables. The name must match, or the call is refused.
        </li>
        <li>
          <B>keys.</B> For <C>DELETE</C>, one to 100 variable names. Each name may appear once. Add <C>target</C> to remove
          only that target.
        </li>
      </List>
      <P>
        A write response lists the key and target of each entry. It does not include the value. Send an{" "}
        <C>Idempotency-Key</C> header on writes that you might retry. Use a value you have not used before for each change.
        Egg keeps the first answer for 24 hours. A repeat with the same key and the same request returns that answer
        without changing anything twice. The same key with a different request is refused with <C>422</C>.
      </P>

      <H2 id="api-configuration-example" title="Example" />
      <P>
        Merge one production variable. Set <C>EGG_URL</C> to your Egg address, <C>EGG_TOKEN</C> to a token with{" "}
        <C>env:write</C>, <C>PROJECT_ID</C> to the project id and <C>IDEMPOTENCY_KEY</C> to a new value.
      </P>
      <CodeBlock label="Terminal" code={addVariable} />
      <P>
        The response confirms the key and target. The request and response shapes for every endpoint are in the OpenAPI
        document at <C>/api/v1/openapi.json</C>.
      </P>

      <H2 id="api-configuration-deployment-settings" title="Deployment settings" />
      <P>
        These endpoints change how a deployment builds, checks its health and pulls its image. Each call needs{" "}
        <C>projects:write</C>. Use the deployment id from <C>GET /api/v1/projects/{"{projectId}"}/deployments</C>.
      </P>
      <Table
        caption="Deployment settings"
        head={["Method and path", "What it sets"]}
        rows={[
          [
            <C key="k143">PATCH /api/v1/deployments/{"{deploymentId}"}/build-config</C>,
            "Build and source settings. Changes apply on the next deployment. The call does not start one.",
          ],
          [
            <C key="k147">PATCH /api/v1/deployments/{"{deploymentId}"}/health-check</C>,
            "The path that health checks request. Future monitoring runs check the new path.",
          ],
          [
            <C key="k151">PATCH /api/v1/deployments/{"{deploymentId}"}/image</C>,
            "The image reference for an image-mode project. Set it, or clear it.",
          ],
          [
            <C key="k155">PATCH /api/v1/deployments/{"{deploymentId}"}/pull-policy</C>,
            "When Docker pulls the image. Applies only to image-mode projects.",
          ],
          [
            <C key="k159">PATCH /api/v1/deployments/{"{deploymentId}"}/strategy</C>,
            "The deployment strategy. Compose projects with persistent volumes may need a recreate.",
          ],
        ]}
      />
      <P>
        <C>PATCH /api/v1/deployments/{"{deploymentId}"}/volumes</C> returns <C>501</C>. Volume mounts are declared in the
        project&apos;s Compose file, and the API cannot edit them. Change the mounts in that file instead.
      </P>

      <H2 id="api-configuration-keep-values-private" title="Keep values private" />
      <P>
        Do not put tokens or variable values in command history, in scripts you commit or in logs you share. Anyone who
        reads one of them gets the secret. Send <C>PUT</C> only when you mean to replace every variable on the project.
        It deletes each name you leave out, and a <C>POST</C> or <C>DELETE</C> changes only the entries you name.
      </P>
      {related([
        ["api-resources", "Projects through the API"],
        ["api-monitoring", "Monitoring and notifications API"],
        ["env", "Environment variables"],
        ["api-agent-safety", "Agent safety rules"],
      ])}
    </Section>
  ),

  "api-resources": () => (
    <Section id="api-resources" intro="Create a project on a server connected to Egg, then deploy it through the API.">
      <H2 id="api-resources-what-it-does" title="What it does" />
      <P>
        <C>POST /api/v1/projects</C> creates a project record from a public HTTPS Git repository on a server you have
        connected to Egg. It does not build or deploy anything. The build and the app run on that server when you deploy.
      </P>
      <P>
        Deploy the production branch with <C>POST /api/v1/projects/{"{projectId}"}/deployments</C>. Change settings with{" "}
        <C>PATCH /api/v1/projects/{"{projectId}"}</C>. Creating and changing a project need <C>projects:write</C>.
        Deploying needs <C>deployments:write</C>.
      </P>
      <Callout tone="warning" title="Pushes do not deploy an API project">
        A project made through the API has no GitHub App link. A push to its repository does nothing, and private
        repositories are not supported. Deploy with the API, or with a deploy hook.
      </Callout>

      <H2 id="api-resources-parameters" title="Parameters" />
      <Table
        caption="Project creation fields"
        head={["Field", "Required", "What to send"]}
        rows={[
          [
            <C key="k207">serverId</C>,
            "Yes",
            <span key="k209">
              The id of a server connected to Egg. List the ids with <C>GET /api/v1/servers</C>.
            </span>,
          ],
          [<C key="k213">name</C>, "Yes", "A display name, up to 60 characters."],
          [
            <C key="k215">repoUrl</C>,
            "For source projects",
            "A public HTTPS Git repository URL on a supported host, such as https://github.com/owner/name.git.",
          ],
          [
            <C key="k220">runtime</C>,
            "For source projects",
            "One of node, python, static, command, go, rust, ruby, php or java.",
          ],
          [<C key="k224">slug</C>, "No", "Lowercase letters, digits and hyphens, up to 40. Defaults to the name."],
          [<C key="k225">productionBranch</C>, "No", "The branch that deploys to production. Defaults to main."],
          [
            <C key="k227">port</C>,
            "No",
            "The port the app listens on, from 1024 to 65535. Ports 20000 to 29999 are reserved for previews. No other project on the server may use the port.",
          ],
        ]}
      />
      <P>
        The request returns <C>409</C> when the slug or the port is already in use.
      </P>

      <P>
        <B>Deploy from a GitHub URL.</B> <C>POST /api/v1/projects/{"{projectId}"}/deploy-from-github-url</C> updates the project&apos;s repository, then
        deploys it. It needs <C>deployments:write</C> and <C>projects:write</C>. The body takes a github.com URL in the
        https, <C>.git</C> or <C>git@</C> form, with an optional <C>/tree/&lt;branch&gt;</C>. The URL&apos;s branch is
        used when it has one, and the default branch otherwise. Credentials in the URL are never shown.
      </P>

      <H2 id="api-resources-example" title="Example" />
      <P>
        Set <C>EGG_URL</C> to your Egg address and <C>EGG_TOKEN</C> to a token with <C>projects:write</C>. Then run the two
        requests in order.
      </P>
      <List ordered>
        <li>
          <B>Create the project.</B> Replace <C>SERVER_ID</C> and the repository URL. The response contains the project
          record. Copy its id.
        </li>
        <li>
          <B>Deploy the production branch.</B> Replace <C>PROJECT_ID</C> with the id from step 1. The request needs{" "}
          <C>deployments:write</C>.
        </li>
      </List>
      <CodeBlock label="Terminal" code={createProject} />
      <CodeBlock label="Terminal" code={deployProject} />
      {related([
        ["api-configuration", "Configuration through the API"],
        ["api-monitoring", "Monitoring and notifications API"],
        ["api", "Access tokens and the API"],
      ])}
    </Section>
  ),

  "api-monitoring": () => (
    <Section
      id="api-monitoring"
      intro="Read deployment health, logs, resource signals and visitor analytics. Manage signed notification channels and their delivery history."
    >
      <H2 id="api-monitoring-what-it-does" title="What it does" />
      <P>
        Monitoring endpoints return what Egg records for a project: deployment checks, build output, the service journal,
        resource samples and counted page views.
      </P>
      <P>
        Page views are not every HTTP request. Egg does not collect a web server access log, so{" "}
        <C>/api/v1/projects/{"{projectId}"}/request-stats</C> counts recorded page views only.{" "}
        <C>/api/v1/projects/{"{projectId}"}/attack-signals</C> lists repeated client-side error groups. Treat them as leads
        to check, not proof of an attack.
      </P>
      <P>
        A notification channel sends signed deployment events to a public HTTPS address you choose. Each channel has an
        event filter. The signing secret comes back once, from the call that creates the channel. No later read returns
        it, so keep a copy. Each delivery records its event, status (<C>pending</C>, <C>success</C> or <C>failed</C>),
        attempts and last error code. It does not store the response body.
      </P>

      <H2 id="api-monitoring-parameters" title="Endpoints and scopes" />
      <Table
        caption="Monitoring endpoints, their scopes and what they return"
        head={["Endpoint", "Scope", "What it returns"]}
        rows={[
          [
            <C key="k291">GET /api/v1/projects/{"{projectId}"}/logs/search</C>,
            <C key="k292">logs:read</C>,
            "Service journal lines, filtered by text, level (info, warn or error) and a time range of 1h, 24h or 7d, with a page limit.",
          ],
          [
            <C key="k296">GET /api/v1/deployments/{"{deploymentId}"}/build-logs</C>,
            <C key="k297">deployments:read</C>,
            "Build output for one deployment, one page at a time.",
          ],
          [
            <C key="k301">GET /api/v1/projects/{"{projectId}"}/request-stats</C>,
            <C key="k302">analytics:read</C>,
            "Recorded page views, visitors, top pages and referrers for 1 to 90 days. Defaults to 30.",
          ],
          [
            <C key="k306">GET /api/v1/projects/{"{projectId}"}/anomalies</C>,
            <C key="k307">analytics:read</C>,
            "Client-error and resource anomalies for 1 to 90 days.",
          ],
          [
            <C key="k311">GET /api/v1/projects/{"{projectId}"}/attack-signals</C>,
            <C key="k312">analytics:read</C>,
            "Repeated client-side error groups to investigate.",
          ],
          [
            <C key="k316">GET /api/v1/notification-channels</C>,
            <C key="k317">webhooks:read</C>,
            "Each channel with its receiver host and event filter. Signing secrets are never returned.",
          ],
          [
            <C key="k321">GET /api/v1/notification-channels/{"{channelId}"}/deliveries</C>,
            <C key="k322">webhooks:read</C>,
            "Recent sends for one channel, 1 to 100 at a time. Defaults to 20.",
          ],
          [
            <C key="k326">GET /api/v1/projects/{"{projectId}"}/crash-reports</C>,
            <C key="k327">logs:read</C>,
            "Crash reports for the project. Each keeps up to 200 journal lines from the release that was live, with known secrets masked.",
          ],
          [
            <C key="k328">GET /api/v1/crash-reports/{"{crashId}"}</C>,
            <C key="k329">logs:read</C>,
            "One crash report, with the same journal lines.",
          ],
          [
            <C key="k330">GET /api/v1/deployments/{"{deploymentId}"}/metrics</C>,
            <C key="k331">deployments:read</C>,
            "Bucketed CPU and memory averages and restart counts for the deployment’s project. Samples are per project, not per release.",
          ],
          [
            <C key="k332">GET /api/v1/projects/{"{projectId}"}/resources/quota</C>,
            <C key="k333">resources:read</C>,
            "Limits and current usage. A value Egg has not measured is null, never zero.",
          ],
          [
            <C key="k334">GET /api/v1/projects/{"{projectId}"}/changes</C>,
            <C key="k335">activity:read</C>,
            "The project’s change feed, newest first: deploys, rollbacks, redeploys, domain and build-config changes. Environment variables appear by name only.",
          ],
        ]}
      />
      <P>
        Each request needs the scope in its row. Use <C>channelId</C> from the channel list, and <C>deliveryId</C> from the
        deliveries list. Creating a channel needs <C>webhooks:write</C>. The full list of parameters is in the OpenAPI
        document at <C>/api/v1/openapi.json</C>.
      </P>

      <H2 id="api-monitoring-example" title="Example" />
      <P>
        Set <C>EGG_URL</C> to your Egg address, <C>EGG_TOKEN</C> to a token with <C>analytics:read</C> and{" "}
        <C>PROJECT_ID</C> to the project id. List the last 30 days of recorded page views:
      </P>
      <CodeBlock label="Terminal" code={requestStats} />
      <P>
        List notification channels with <C>webhooks:read</C>. The response shows each receiver and its event filter, and
        no signing secrets:
      </P>
      <CodeBlock label="Terminal" code={notificationChannels} />
      {related([
        ["monitoring", "Monitoring and uptime"],
        ["notifications", "Notifications"],
        ["logs", "Logs"],
        ["api-query", "Reading deployment state"],
        ["api-agent-safety", "Agent safety rules"],
      ])}
    </Section>
  ),
};
