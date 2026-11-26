import { cn } from "@/lib/utils";
import { CodeBlock } from "../_components/code-block";
import { ARTICLE, C, H2, P, PageHeader, Table } from "../_components/prose";

export const metadata = {
  title: "Query API",
  description: "Read resource recommendations and Compose volume names with Egg's API.",
};

const RESOURCE_EXAMPLE = `curl --fail-with-body \\
  -H "Authorization: Bearer $EGG_TOKEN" \\
  "https://egg.example/api/v1/deployments/$DEPLOYMENT_ID/resource-analysis"`;

const VOLUME_EXAMPLE = `curl --fail-with-body \\
  -H "Authorization: Bearer $EGG_TOKEN" \\
  "https://egg.example/api/v1/deployments/$DEPLOYMENT_ID/deployment-volumes"`;

export default function QueryApiPage() {
  return (
    <article id="docs-article" data-docs-page="query" data-docs-body tabIndex={-1} className={cn(ARTICLE, "outline-none")}>
      <PageHeader
        tag="API"
        title="Query deployments"
        titleId="query-h"
        lead="Read resource recommendations and the named Compose volumes owned by a deployment."
      />

      <H2 id="query-what" title="What it does" />
      <P>
        <C>analyze_deployment_resources</C> uses monitor samples for the deployment&apos;s project. The samples describe
        the server, so they are not isolated to one deployment. The recommendation does not change a resource limit.
      </P>
      <P>
        <C>get_deployment_volumes</C> lists named Docker volumes owned by a Compose deployment. A native deployment has
        no Docker volumes. Egg never returns environment variable values; use <C>list_env_vars</C> to read names and targets.
      </P>

      <H2 id="query-parameters" title="Parameters" />
      <Table
        caption="Query parameters"
        head={["Endpoint", "Path parameter", "Access"]}
        rows={[
          [<C key="resource">analyze_deployment_resources</C>, <C key="resource-id">deploymentId</C>, <C key="resource-scope">resources:read</C>],
          [<C key="volumes">get_deployment_volumes</C>, <C key="volume-id">deploymentId</C>, <C key="volume-scope">deployments:read</C>],
        ]}
      />

      <H2 id="query-examples" title="Examples" />
      <P>Set both shell variables, then copy the command that matches your question.</P>
      <CodeBlock label="Resource recommendation" code={RESOURCE_EXAMPLE} />
      <CodeBlock label="Compose volumes" code={VOLUME_EXAMPLE} />
    </article>
  );
}
