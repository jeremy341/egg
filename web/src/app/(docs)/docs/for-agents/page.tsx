import { cn } from "@/lib/utils";
import { AgentPanel } from "../_components/agent-panel";
import { CodeBlock } from "../_components/code-block";
import { ARTICLE, B, C, Callout, H2, H3, InternalLink, List, P, PageHeader, Table } from "../_components/prose";
import { docsHref } from "../_data/nav";

export const metadata = {
  title: "Docs for agents",
  description:
    "Let an AI agent read Egg's docs as Markdown, and call Egg's API with an agent spec, idempotency keys and a rollout wait.",
};

/**
 * Two whole prompts, built as one line each so CodeBlock copies them verbatim.
 * They name the docs an agent should fetch instead of letting it guess from
 * memory. Both point at guides in the Egg repository, which an agent can read
 * without a running Egg site.
 */
const NO_DOMAIN_PROMPT = [
  "Try Egg without owning a domain. Read docs/selfhost/TRY-WITHOUT-DOMAIN.md in the Egg repository",
  "(https://github.com/jeremy341/egg) and follow it: clone the repository, run pnpm install and pnpm run setup in web/,",
  "set APP_URL to http://127.0.0.1.nip.io:3000 with LOCAL_MODE=1 and LOCAL_MODE_ALLOW_REMOTE=1, then start with",
  "pnpm egg start --dev. Open that exact address, sign in with the recovery key from .env.local, and run pnpm run",
  "doctor. Tell me the address, the warning to expect, and which features a trial host cannot offer. Keep the login",
  "page private.",
].join(" ");

const SETUP_PROMPT = [
  "Finish setting up Egg after first boot. Read docs/selfhost/FINISHING-SETUP.md in the Egg repository",
  "(https://github.com/jeremy341/egg) and work through its checklist in order: set the local password, connect a",
  "server and confirm its host key, leave the container permission switches off, set up the GitHub App only if you",
  "need private repositories, configure backups, add a status page and notifications, then secure the instance. Ask",
  "before every write. Cite the in-app /docs page for each step and tell me what is left when you stop.",
].join(" ");

/**
 * A public page for people who wire an agent to these docs or to Egg itself.
 * It says where the Markdown lives, what the buttons copy, and the three rules
 * an agent follows when it acts through the API.
 */
export default function DocsForAgents() {
  return (
    <article
      id="docs-article"
      data-docs-page="for-agents"
      data-docs-body
      tabIndex={-1}
      className={cn(ARTICLE, "outline-none")}
    >
      <PageHeader
        tag="Documentation"
        title="Docs for agents"
        titleId="for-agents-h"
        lead="An agent can read these docs without a browser. It can also act on Egg with a token. This page covers both paths."
      />
      <AgentPanel slug="api" />

      <H2 id="for-agents-markdown" title="Read a page as Markdown" />
      <P>
        Each page in the docs index has a Markdown address. Add <C>.md</C> to the page address. The text is the same as
        the page, without the frame or the buttons. A plain GET is enough. None of these addresses needs a sign-in.
      </P>
      <Table
        caption="Markdown addresses"
        head={["For", "Address", "What it holds"]}
        rows={[
          [
            "One page",
            <C key="1">https://your-egg/docs/api.md</C>,
            <>
              One page, ready to paste. Replace <C>api</C> with the page name.
            </>,
          ],
          [
            "A short index",
            <C key="2">https://your-egg/llms.txt</C>,
            "Every page with its address and one sentence on what it covers.",
          ],
          [
            "The whole site",
            <C key="3">https://your-egg/llms-full.txt</C>,
            "Every page's Markdown in one file, separated by a rule.",
          ],
        ]}
      />
      <P>
        Start with <C>/llms.txt</C>. It fits in a small context window. Follow its links to the pages the question needs.
        Use <C>/llms-full.txt</C> when the agent can read a long document in one go.
      </P>

      <H2 id="for-agents-buttons" title="The buttons above a page" />
      <P>
        The docs pages have a button row above the title. It hands an agent the same material without typing an address.
      </P>
      <Table
        caption="The agent buttons"
        head={["Control", "What it does"]}
        rows={[
          [
            <C key="1">Copy prompt</C>,
            <>
              Copies a one-line instruction. On a page it points at that page&apos;s <C>.md</C> address. On the docs home
              it points at <C>/llms.txt</C>.
            </>,
          ],
          [
            "Open in Claude / Open in ChatGPT",
            "The arrow beside Copy prompt. It opens the same instruction in a new tab, so the chat starts with the docs in scope.",
          ],
          [
            <C key="2">Copy as Markdown</C>,
            <>
              Fetches the page&apos;s <C>.md</C> and copies the text. Use it for an agent that cannot fetch a URL itself.
            </>,
          ],
          [
            <C key="3">Open .md</C>,
            "Shows the same Markdown in a tab, so the address can be handed to an agent directly.",
          ],
        ]}
      />

      <H2 id="for-agents-prompts" title="Prompts to copy" />
      <P>
        The addresses above are enough to write an instruction yourself. Two whole prompts are written out below, so an
        agent can start from a plain sentence. Each one names a guide in the Egg repository, which the agent reads
        before it acts, rather than guessing from memory.
      </P>
      <P>
        Put either prompt into the <C>Copy prompt</C> box of your agent, or paste it into a chat. Both ask the agent to
        report what it did and to stop when a step needs your permission.
      </P>

      <H3 id="for-agents-prompt-nodomain" title="Try without a domain" />
      <P>
        A wildcard DNS name such as <C>127.0.0.1.nip.io</C> looks like a domain but needs no DNS record of your own.
        This prompt gets a local trial running and names the features a trial host cannot offer.
      </P>
      <CodeBlock label="Prompt" code={NO_DOMAIN_PROMPT} />

      <H3 id="for-agents-prompt-setup" title="Finish setup" />
      <P>
        A fresh Egg has no password, no deploy target and no integrations. This prompt walks the first-boot checklist
        in order and asks before each write, so the agent does not act on your instance without permission.
      </P>
      <CodeBlock label="Prompt" code={SETUP_PROMPT} />
      <Callout tone="note" title="The prompts are plain text">
        Nothing in them needs a browser. The named guides are Markdown files in the repository, so an agent reads the
        same text a person reads in the file.
      </Callout>

      <H2 id="for-agents-api" title="Call Egg's API" />
      <P>
        An agent uses the same access token as a script. Make one on the Developer page and keep it in a secret store.
        Send it in an <C>Authorization: Bearer</C> header. Browser cookies are never accepted here.
      </P>
      <List>
        <li>
          <B>Read and write with /api/v1.</B> Send JSON. A path value wins over a body field of the same name. An unknown
          field is refused.
        </li>
        <li>
          <B>Use /api/mcp for tools.</B> It takes one JSON-RPC 2.0 message per POST. Call <C>get_me</C> first to see what
          the token can do.
        </li>
        <li>
          <B>Respect 429.</B> Wait the seconds in <C>Retry-After</C>, then send the same request again.
        </li>
      </List>

      <H3 id="for-agents-spec" title="Start with the agent spec" />
      <P>
        Fetch <C>/api/v1/agent-spec.json</C> before you plan a call. It lists every operation with its id, method, path,
        summary and parameters. It is public and holds no data. It is built from the full OpenAPI document, so the two
        cannot disagree on names.
      </P>
      <Table
        caption="API descriptions"
        head={["Address", "Use it for"]}
        rows={[
          [
            <C key="1">/api/v1/agent-spec.json</C>,
            "A short list of operations for an agent with a small context window.",
          ],
          [<C key="2">/api/v1/openapi.json</C>, "The full reference: schemas, request bodies and error tables."],
        ]}
      />

      <H3 id="for-agents-keys" title="Give every write a key" />
      <P>
        Send <C>Idempotency-Key</C> on every write. Use a new key for each action you want to happen once. A UUID is fine.
        The key belongs to the token, so two tokens never share one.
      </P>
      <Table
        caption="Idempotency-Key replies"
        head={["Request", "Reply"]}
        rows={[
          ["First write with a key", "Runs once. The answer is kept for 24 hours."],
          ["Same key, same request", "The kept answer is returned with Idempotent-Replayed: true."],
          ["Same key, different request", "422. The write does not run."],
          ["Same key while the first is still running", "409 with Retry-After: 1. Wait, then try again."],
          ["A server error (5xx)", "Not kept. Retry with the same key."],
          ["An answer that holds a secret", "Not kept. A repeat is 409. Read the result back instead."],
        ]}
      />
      <Callout tone="note" title="Keys are held in memory">
        A restart of Egg forgets them. Treat the key as protection against a lost connection, not as a long-term record.
      </Callout>

      <H3 id="for-agents-rollout" title="Wait for the rollout" />
      <P>
        A deploy or rollback answers <C>202</C> with a queued deployment. That is not the same as a live app. Watch the
        rollout instead of guessing.
      </P>
      <P>
        Call <C>GET /api/v1/deployments/{"{deploymentId}"}/rollout?wait=1</C>. It needs <C>deployments:read</C>. With{" "}
        <C>wait=1</C> the call reads the state every 2 seconds for up to 60 seconds. It returns early at <C>ready</C>,{" "}
        <C>error</C> or <C>canceled</C>. Leave <C>wait</C> out for the state right now.
      </P>
      <Table
        caption="The rollout answer"
        head={["Field", "Meaning"]}
        rows={[
          [<C key="1">deployment</C>, "The deployment and its current state."],
          [<C key="2">done</C>, "True at ready, error or canceled."],
          [<C key="3">waitedMs</C>, "How long this call waited. 0 without wait=1."],
        ]}
      />
      <P>
        If <C>done</C> is false, call again. A rollback is live when its deployment shows <C>isCurrent: true</C>.
      </P>

      <P>
        <B>Related resources:</B>{" "}
        <InternalLink href={docsHref("api")}>Access tokens and the API</InternalLink>,{" "}
        <InternalLink href={docsHref("getting-started")}>Getting started</InternalLink>,{" "}
        <InternalLink href={docsHref("quickstart")}>Quick start</InternalLink>,{" "}
        <InternalLink href={docsHref("limits")}>Limits</InternalLink>.
      </P>
    </article>
  );
}
