import { CodeBlock } from "../_components/code-block";
import { ARTICLE, B, C, H2, H3, List, P, PageHeader, Table } from "../_components/prose";

export const metadata = {
  title: "Configuration and environments",
  description: "Configure project environment variables and deployment settings with Egg's API.",
};

const addVariable = `curl -sS -X POST "$NEST_URL/api/v1/projects/$PROJECT_ID/env" \
  -H "Authorization: Bearer $NEST_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 7f1c2e6a-4b5d-4c8e-9a1f-3d2b0e5c7a90" \
  --data '{"envVars":[{"key":"PUBLIC_ORIGIN","value":"https://app.example.com","target":"production"}]}'`;

export default function ConfigurationDocs() {
  return (
    <article
      id="docs-article"
      data-docs-page="configuration"
      data-docs-body
      tabIndex={-1}
      className={ARTICLE}
    >
      <PageHeader
        tag="API"
        title="Configuration and environments"
        titleId="configuration-h"
        lead="Set project variables and deployment settings with the API. Nest uses fixed deployment targets, not named environment namespaces."
      />

      <H2 id="configuration-what" title="What it does" />
      <P>
        The API can list variable names, add or replace variables, and remove selected keys. Values are encrypted at
        rest. The API never returns them.
      </P>
      <P>
        A project has three variable targets: <C>all</C>, <C>production</C> and <C>preview</C>. There are no named
        environments or shared-variable references. Add a variable to each project that needs it.
      </P>
      <Table
        caption="Environment variable operations"
        head={["Method", "Path", "Use it for"]}
        rows={[
          [<C key="get">GET</C>, <C key="list">/api/v1/projects/{"{projectId}"}/env</C>, "List names and targets."],
          [<C key="post">POST</C>, <C key="add">/api/v1/projects/{"{projectId}"}/env</C>, "Merge supplied variables; leave other keys alone."],
          [<C key="put">PUT</C>, <C key="replace">/api/v1/projects/{"{projectId}"}/env</C>, "Replace the full set. Omitted keys are deleted."],
          [<C key="delete">DELETE</C>, <C key="remove">/api/v1/projects/{"{projectId}"}/env</C>, "Remove named keys, optionally for one target."],
        ]}
      />

      <H2 id="configuration-parameters" title="Parameters" />
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
        Write requests need <C>env:write</C> and a fresh UUID in <C>Idempotency-Key</C>. Listing needs <C>env:read</C>.
        A list response contains names and targets only.
      </P>

      <H2 id="configuration-example" title="Example" />
      <P>Merge one production variable. Replace the placeholders before you run the command.</P>
      <CodeBlock label="Terminal" code={addVariable} />
      <P>
        The response confirms the key and target. It does not include the value. Read the full request and response
        shapes in <C>/api/v1/openapi.json</C>.
      </P>

      <H2 id="configuration-deployments" title="Deployment settings" />
      <P>Use these existing endpoints to change project settings through a deployment id.</P>
      <Table
        caption="Deployment settings"
        head={["Method and path", "Setting"]}
        rows={[
          [<C key="build">PATCH /api/v1/deployments/{"{deploymentId}"}/build-config</C>, "Build and source settings."],
          [<C key="health">PATCH /api/v1/deployments/{"{deploymentId}"}/health-check</C>, "Health check path."],
          [<C key="image">PATCH /api/v1/deployments/{"{deploymentId}"}/image</C>, "Image reference for image-mode projects."],
          [<C key="pull">PATCH /api/v1/deployments/{"{deploymentId}"}/pull-policy</C>, "Image pull policy."],
          [<C key="strategy">PATCH /api/v1/deployments/{"{deploymentId}"}/strategy</C>, "Deployment strategy."],
        ]}
      />
      <P>
        <C>PATCH /api/v1/deployments/{"{deploymentId}"}/volumes</C> returns <C>501</C>. Volume mounts come from the
        project's Compose file. Change them there, then deploy again.
      </P>
      <H3 id="configuration-safety" title="Keep values private" />
      <P>
        Treat variable values as private. Keep tokens out of command history and logs. Use <C>set_env_vars</C> only when
        you mean to replace every target on the project.
      </P>
    </article>
  );
}
