import { cn } from "@/lib/utils";
import { CodeBlock } from "../_components/code-block";
import { ARTICLE, C, Callout, H2, P, PageHeader, Table } from "../_components/prose";

export const metadata = {
  title: "Project resources",
  description: "Create a project through Egg's API and deploy it to a Nest container.",
};

const CREATE_PROJECT = [
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

export default function ResourcesPage() {
  return (
    <article
      id="docs-article"
      data-docs-page="resources"
      data-docs-body
      tabIndex={-1}
      className={cn(ARTICLE, "outline-none")}
    >
      <PageHeader
        tag="API reference"
        title="Project resources"
        titleId="resources-h"
        lead="Create a project on one of your Nest containers, then deploy it through the deployment API."
      />

      <H2 id="resources-what-it-does" title="What it does" />
      <P>
        <C>POST /api/v1/projects</C> creates a project record from a public HTTPS repository. It does not start a
        deployment. The build and app run on the Nest container you choose.
      </P>
      <P>
        Use <C>POST /api/v1/projects/PROJECT_ID/deployments</C> after creation to deploy the production branch. Use{" "}
        <C>PATCH /api/v1/projects/PROJECT_ID</C> to change project settings. Creation and changes require a token with{" "}
        <C>projects:write</C>. Deploying requires <C>deployments:write</C>.
      </P>

      <H2 id="resources-parameters" title="Parameters" />
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

      <H2 id="resources-example" title="Example" />
      <P>
        Set <C>NEST_TOKEN</C> to an access token with <C>projects:write</C>. Replace the container id and repository
        URL, then copy and run the request.
      </P>
      <CodeBlock label="Terminal" code={CREATE_PROJECT} />

      <H2 id="resources-boundary" title="What Egg does not manage" />
      <Callout tone="note" title="Databases and templates">
        Egg does not provision or manage databases. It also has no cluster template registry. Create a project from a
        repository you control instead.
      </Callout>
    </article>
  );
}
