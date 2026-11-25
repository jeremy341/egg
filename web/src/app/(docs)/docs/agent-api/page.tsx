import { cn } from "@/lib/utils";
import { ARTICLE, C, H2_CLASS, PageHeader, P } from "../_components/prose";

export const metadata = {
  title: "Agent API",
  description: "Search Egg API operations, read their inputs and call scheduled-job or project actions safely.",
};

const searchExample = `curl -X POST https://your-egg/api/mcp/compact \\
  -H "Authorization: Bearer $NEST_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_api","arguments":{"query":"scheduled jobs","limit":5}}}'`;

const listJobsExample = `curl -H "Authorization: Bearer $NEST_TOKEN" \\
  https://your-egg/api/v1/projects/PROJECT_ID/jobs`;

const deleteProjectExample = `{"operationId":"delete_project","confirm":"delete_project","arguments":{"projectId":"PROJECT_ID","confirmName":"Recipe bot"}}`;

function Example({ children }: { children: string }) {
  return (
    <pre className="mt-5 max-w-full overflow-x-auto rounded-lg border bg-[var(--ds-gray-100)] p-4 font-mono text-[13px] leading-6 text-foreground">
      <code>{children}</code>
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-14">
      <h2 id={`${id}-heading`} className={cn(H2_CLASS, "mb-5")}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function AgentApiPage() {
  return (
    <article id="docs-article" data-docs-page="agent-api" data-docs-body tabIndex={-1} className={cn(ARTICLE, "outline-none")}>
      <PageHeader
        tag="Reference"
        title="Agent API"
        titleId="agent-api-h"
        lead="Find an operation, read its inputs, then call it with the same permissions as your access token."
      />

      <Section id="what-it-does" title="What it does">
        <P>
          The compact MCP endpoint at <C>/api/mcp/compact</C> offers three tools. <C>search_api</C> finds operations
          the token can use. <C>describe_operation</C> returns the route, scope and input schema. <C>call_api</C> runs
          one operation.
        </P>
        <P>
          The full MCP endpoint at <C>/api/mcp</C> exposes each operation as its own tool. Both endpoints use the
          token scopes and toolset filters. Send one JSON-RPC request at a time.
        </P>
        <Example>{searchExample}</Example>
      </Section>

      <Section id="parameters" title="Parameters">
        <ul className="mt-5 space-y-3 text-[17px] leading-7 text-reading">
          <li>
            <C>search_api</C>: send <C>query</C>. Add <C>limit</C> from 1 to 50; the default is 10. Results include
            only operations available to this token and toolset.
          </li>
          <li>
            <C>describe_operation</C>: send an <C>operationId</C> returned by search. It includes the fields required
            for a call.
          </li>
          <li>
            <C>call_api</C>: send <C>operationId</C> and an <C>arguments</C> object. For a destructive operation,
            repeat the operation ID in <C>confirm</C>. Some routes also require the exact resource name or ID in
            their arguments.
          </li>
        </ul>
        <P>
          Scheduled jobs are available under <C>/api/v1/projects/PROJECT_ID/jobs</C>. The list and create routes are
          shown here:
        </P>
        <Example>{listJobsExample}</Example>
        <P>
          The job tools are <C>list_jobs</C>, <C>create_job</C>, <C>get_job</C>, <C>update_job</C>, <C>delete_job</C>,
          <C>list_job_runs</C>, <C>get_job_run</C>, <C>get_job_run_logs</C>, <C>run_job</C>, <C>cancel_job_run</C> and
          <C>replace_job_steps</C>.
        </P>
        <P>
          Egg stores one command per job and keeps its latest status, not a run history. Replace one step at a time.
          Cancel pauses future runs; it does not stop a command that has already started.
        </P>
      </Section>

      <Section id="destructive-actions" title="Destructive actions">
        <P>
          Ask the user before deleting or changing a live resource. First call <C>call_api</C> with the exact operation
          ID in <C>confirm</C>. Then provide the route&apos;s confirmation field. For example, project deletion needs the
          exact project name:
        </P>
        <Example>{deleteProjectExample}</Example>
        <P>
          Deleting a notification channel uses <C>confirmChannelId</C> with the exact channel ID. Egg audits successful
          deletes with the token that made the request.
        </P>
        <P>
          Egg has no database, environment, or template-instance resources. Database delete, restore and upgrade
          operations, environment deletion, and template-instance deletion are not available.
        </P>
      </Section>
    </article>
  );
}
