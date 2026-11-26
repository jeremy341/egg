import type { ReactNode } from "react";
import { B, C, H2, H3, List, P, Section, Table } from "../_components/prose";
import { CodeBlock } from "../_components/code-block";

const addVariable = [
  "curl -sS -X POST \"$NEST_URL/api/v1/projects/$PROJECT_ID/env\" \\",
  "  -H \"Authorization: Bearer $NEST_TOKEN\" \\",
  "  -H \"Content-Type: application/json\" \\",
  "  -H \"Idempotency-Key: 7f1c2e6a-4b5d-4c8e-9a1f-3d2b0e5c7a90\" \\",
  "  --data '{\"envVars\":[{\"key\":\"PUBLIC_ORIGIN\",\"value\":\"https://app.example.com\",\"target\":\"production\"}]}'",
].join("\n");

const createProject = [
  "curl -X POST \\",
  "  -H \"Authorization: Bearer $NEST_TOKEN\" \\",
  "  -H \"Content-Type: application/json\" \\",
  "  -d '{",
  "    \"serverId\": \"SERVER_ID\",",
  "    \"name\": \"My app\",",
  "    \"repoUrl\": \"https://github.com/OWNER/REPOSITORY.git\",",
  "    \"runtime\": \"node\",",
  "    \"port\": 3000",
  "  }' \\",
  "  https://your-egg/api/v1/projects",
].join("\n");

const requestStats = [
  "curl -X GET \"$EGG_URL/api/v1/projects/$PROJECT_ID/request-stats?days=30\" \\",
  "  -H \"Authorization: Bearer $EGG_TOKEN\"",
].join("\n");

const notificationChannels = [
  "curl -X GET \"$EGG_URL/api/v1/notification-channels\" \\",
  "  -H \"Authorization: Bearer $EGG_TOKEN\"",
].join("\n");

export const GUIDE_API_A: Record<string, () => ReactNode> = {
  "api-configuration": () => (
    <Section id="api-configuration" intro="Set project variables and deployment settings with the API.">
      <H2 id="api-configuration-what" title="What it does" />
      <P>
        The API can list variable names, add or replace variables, and remove selected keys. Values are encrypted at
        rest. The API never returns them.
      </P>
      <P>
        A project&apos;s variable target can be <C>all</C>, <C>production</C> or <C>preview</C>. Add a variable to each
        project that needs it.
      </P>
      <Table
        caption="Environment variable operations"
        head={["Method", "Path", "Use it for"]}
        rows={[
          [
            <C key="get">GET</C>,
            <C key="list">/api/v1/projects/{"{projectId}"}/env</C>,
            "List names and targets.",
          ],
          [
            <C key="post">POST</C>,
            <C key="add">/api/v1/projects/{"{projectId}"}/env</C>,
            "Merge supplied variables; leave other keys alone.",
          ],
          [
            <C key="put">PUT</C>,
            <C key="replace">/api/v1/projects/{"{projectId}"}/env</C>,
            "Replace the full set. Omitted keys are deleted.",
          ],
          [
            <C key="delete">DELETE</C>,
            <C key="remove">/api/v1/projects/{"{projectId}"}/env</C>,
            "Remove named keys, optionally for one target.",
          ],
        ]}
      />

      <H2 id="api-configuration-parameters" title="Parameters" />
      <List>
        <li>
          <B>projectId.</B> The project id from <C>GET /api/v1/projects</C>.
        </li>
        <li>
          <B>envVars.</B> An array of <C>key</C>, <C>value</C> and <C>target</C>. Each key and target pair may appear
          once.
        </li>
        <li>
          <B>target.</B> Use <C>all</C>, <C>production</C> or <C>preview</C>.
        </li>
        <li>
          <B>confirmName.</B> The exact project name. Send it when replacing or deleting variables.
        </li>
        <li>
          <B>keys.</B> One or more variable names to remove. Add <C>target</C> to limit removal to one target.
        </li>
      </List>
      <P>
        Write requests need <C>env:write</C>. For safe retries, you can send a unique <C>Idempotency-Key</C> value;
        the header is optional. Replacing or deleting variables also needs the exact project name in <C>confirmName</C>.
        Listing needs <C>env:read</C>. A list response contains names and targets only.
      </P>

      <H2 id="api-configuration-example" title="Example" />
      <P>Merge one production variable. Replace the placeholders before you run the command.</P>
      <CodeBlock label="Terminal" code={addVariable} />
      <P>
        The response confirms the key and target. It does not include the value. Read the full request and response
        shapes in the OpenAPI reference.
      </P>

      <H2 id="api-configuration-deployment-settings" title="Deployment settings" />
      <P>Use these endpoints to change project settings through a deployment id.</P>
      <Table
        caption="Deployment settings"
        head={["Method and path", "Setting"]}
        rows={[
          [
            <C key="build">PATCH /api/v1/deployments/{"{deploymentId}"}/build-config</C>,
            "Build and source settings.",
          ],
          [
            <C key="health">PATCH /api/v1/deployments/{"{deploymentId}"}/health-check</C>,
            "Health check path.",
          ],
          [
            <C key="image">PATCH /api/v1/deployments/{"{deploymentId}"}/image</C>,
            "Image reference for image-mode projects.",
          ],
          [
            <C key="pull">PATCH /api/v1/deployments/{"{deploymentId}"}/pull-policy</C>,
            "Image pull policy.",
          ],
          [
            <C key="strategy">PATCH /api/v1/deployments/{"{deploymentId}"}/strategy</C>,
            "Deployment strategy.",
          ],
        ]}
      />
      <P>
        <C>PATCH /api/v1/deployments/{"{deploymentId}"}/volumes</C> returns <C>501</C>. Volume mounts come from the
        project&apos;s Compose file. Change them there, then deploy again.
      </P>
      <H3 id="api-configuration-keep-values-private" title="Keep values private" />
      <P>
        Treat variable values as private. Keep tokens out of command history and logs. Use <C>set_env_vars</C> only when
        you mean to replace every target on the project.
      </P>
    </Section>
  ),

  "api-resources": () => (
    <Section
      id="api-resources"
      intro="Create a project on one of your Nest containers, then deploy it through the deployment API."
    >
      <H2 id="api-resources-what-it-does" title="What it does" />
      <P>
        <C>POST /api/v1/projects</C> creates a project record from a public HTTPS repository. It does not start a
        deployment. The build and app run on the Nest container you choose.
      </P>
      <P>
        Use <C>POST /api/v1/projects/{"{projectId}"}/deployments</C> after creation to deploy the production branch.
        Use <C>PATCH /api/v1/projects/{"{projectId}"}</C> to change project settings. Creation and changes require a
        token with <C>projects:write</C>. Deploying requires <C>deployments:write</C>.
      </P>

      <H2 id="api-resources-parameters" title="Parameters" />
      <Table
        caption="Project creation fields"
        head={["Field", "Required", "What to send"]}
        rows={[
          [<C key="serverId">serverId</C>, "Yes", "The id of a Nest container already connected to Egg."],
          [<C key="name">name</C>, "Yes", "A name for the project."],
          [<C key="repoUrl">repoUrl</C>, "Yes", "A public HTTPS Git repository URL."],
          [<C key="runtime">runtime</C>, "For source projects", "The runtime to use, such as node."],
          [<C key="port">port</C>, "No", "The port the app listens on. Choose a port not used by another project."],
        ]}
      />

      <H2 id="api-resources-example" title="Example" />
      <P>
        Set <C>NEST_TOKEN</C> to an access token with <C>projects:write</C>. Replace the container id and repository
        URL, then copy and run the request.
      </P>
      <CodeBlock label="Terminal" code={createProject} />
    </Section>
  ),

  "api-monitoring": () => (
    <Section
      id="api-monitoring"
      intro="Read deployment health, logs, resource signals and visitor analytics. Manage signed notification channels and their delivery history."
    >
      <H2 id="api-monitoring-what-it-does" title="What it does" />
      <P>
        Monitoring calls return the signals Egg collects for your project: deployment checks, build output, the service
        journal, resource samples and recorded page views. <C>get_request_stats</C> counts recorded page views, not
        every HTTP request. <C>get_attack_signals</C> reports repeated client-side error groups; it cannot confirm an
        attack.
      </P>
      <P>
        Notification channels send signed deployment events to an HTTPS address. Each channel has an event filter. Its
        signing secret is returned when you create it and is never shown again. Delivery history contains status and
        error codes, not response bodies.
      </P>

      <H2 id="api-monitoring-parameters" title="Parameters" />
      <P>
        Use <C>projectId</C> for project analytics, logs, observability links and build history. Use{" "}
        <C>deploymentId</C> for build output, diagnosis, verdicts and Compose volumes. Log searches accept a time range,
        a level and a page limit. Analytics windows accept 1 to 90 days. Notification calls use <C>channelId</C>,{" "}
        <C>ruleId</C> and <C>deliveryId</C> from earlier results.
      </P>
      <P>
        Each request needs the scope listed on its endpoint: <C>logs:read</C>, <C>deployments:read</C>,{" "}
        <C>analytics:read</C>, <C>resources:read</C>, <C>projects:read</C>, <C>webhooks:read</C> or{" "}
        <C>webhooks:write</C>. Read the full parameter schemas in the OpenAPI reference.
      </P>

      <H2 id="api-monitoring-example" title="Example" />
      <P>List the last 30 days of counted page views for one project:</P>
      <CodeBlock label="Terminal" code={requestStats} />
      <P>List notification channels without returning their signing secrets:</P>
      <CodeBlock label="Terminal" code={notificationChannels} />
      <P>
        <B>Related:</B> use <C>get_anomalies</C> to review client errors and resource pressure, and{" "}
        <C>list_notification_deliveries</C> to inspect recent sends for one channel.
      </P>
    </Section>
  ),
};
