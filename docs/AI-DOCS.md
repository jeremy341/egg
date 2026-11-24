# Docs for AI agents

Egg publishes its docs twice: as pages for people and as plain text for agents. Both come from the same source, so an agent never reads a different description than a person sees. Every address on this page is public and needs no sign-in.

Replace `your-egg` with the address of your Egg site in the examples below.

## The addresses

| Address | Holds | Type |
| --- | --- | --- |
| `/docs/<slug>.md` | One page, ready to paste into a prompt. | `text/markdown; charset=utf-8` |
| `/llms.txt` | Every page with its address and one sentence on what it covers. | `text/plain; charset=utf-8` |
| `/llms-full.txt` | Every page's Markdown in one file, separated by a rule. | `text/plain; charset=utf-8` |
| `/llms/<group>` | One group from the index, such as `/llms/start` or `/llms/use-it`. | `text/plain; charset=utf-8` |
| `/.well-known/llms.txt` | A mirror of `/llms.txt` for tools that look there first. | `text/plain; charset=utf-8` |

### One page as Markdown

Add `.md` to a page address. A plain GET is enough, with no token and no browser:

```text
https://your-egg/docs/quickstart.md
```

The proxy rewrites `/docs/quickstart.md` to the Markdown route for `quickstart`. The answer starts with `# Quick start` and holds only the page's text: no frame, no sidebar, no buttons and no markup. An unknown page name answers 404. Replace `quickstart` with any page name in the index.

### The short index

```text
https://your-egg/llms.txt
```

The index fits in a small context window. It starts with `# Egg docs`, then groups the pages under headings such as `## Start` and `## Use it`. Each page is one line:

```text
- [Quick start](https://your-egg/docs/quickstart.md): From a new account to a deployed app in four steps...
```

The address in each line is built from the origin the request came to. A self-hosted copy therefore points at itself, not at a public Egg site. Follow only the pages the question needs.

`/llms/<group>` serves just the lines of one group, taking them from the same index, so a title, address or summary can never drift between the two. The group name is lowercased with spaces turned into hyphens: `Start` becomes `start`, `Use it` becomes `use-it`. An unknown group answers 404.

### The whole site

```text
https://your-egg/llms-full.txt
```

This is every page's Markdown in build order, joined by a blank line, a horizontal rule and a blank line. It is generated when the site is built, so it holds no per-request origin. Use it when the agent can read a long document in one go; use `/llms.txt` and the single-page addresses when it cannot.

## The buttons on a docs page

Every docs page has a row above the title. The buttons hand an agent the same material without typing an address.

- **Copy prompt** (labeled `Copy docs prompt` in the docs UI) copies one instruction. On a page it points at that page's `.md` address. On the docs home it points at `/llms.txt`.
- **The arrow** previews the text and opens the same instruction in Claude or ChatGPT.
- **Copy as Markdown** fetches the page's `.md` and copies the text. Use it for an agent that cannot fetch a URL itself.
- **Open .md** shows the same Markdown in a tab, so the address can be handed to an agent directly.

The two prompt texts, with `<origin>` being the address of the site:

```text
Read the Egg docs at <origin>/llms.txt and use them to help me. Fetch the pages you need before you answer, and link the pages you used.
```

```text
Read <origin>/docs/<slug>.md and answer my questions about it.
```

## Claude and ChatGPT deep links

The arrow beside **Copy prompt** turns the prompt into a URL-encoded query. Both links open in a new tab, so the chat starts with the docs already in scope:

```text
https://claude.ai/new?q=<encoded prompt>
https://chatgpt.com/?q=<encoded prompt>
```

The encoding is `encodeURIComponent` of the exact text that **Copy prompt** puts on the clipboard. The links carry no token and no account details; the agent fetches the public docs itself after it starts.

## Ready-to-copy prompts

These are complete instructions, not snippets. Paste one into an agent. Replace `https://your-egg` with your site's address. Where a prompt names a repository doc, let the agent read it from the repository at <https://github.com/jeremy341/egg>. Each prompt tells the agent to fetch the docs rather than to guess from memory.

### Install

```text
Install Egg on this machine. Read docs/selfhost/INSTALL.md in the Egg repository and follow it in order: check the prerequisites, clone the repository, run pnpm install and pnpm run setup in web/, run pnpm run doctor, then start Egg with pnpm egg start. Open http://localhost:3000/login and sign in with the recovery key from .env.local. Stop before connecting a deploy target. If a step fails, paste the exact error and stop.
```

### Set up

```text
Finish setting up Egg after first boot. Read docs/selfhost/FINISHING-SETUP.md in the Egg repository and work through its checklist in order: set the local password, connect a server and confirm its host key, leave the container permission switches off, set up the GitHub App only if you need private repositories, configure backups, add a status page and notifications, then secure the instance. Ask before every write. Cite the in-app /docs page for each step and tell me what is left when you stop.
```

### Deploy

```text
Deploy a change for me. Read https://your-egg/docs/deployments.md and https://your-egg/docs/api.md. Push to the production branch, then watch the deployment with GET /api/v1/deployments/{deploymentId}/rollout?wait=1 until rollout.done is true. Report the final state: ready, error or canceled. Do not call a 202 a successful deploy. Use a fresh Idempotency-Key for every write and never reuse one with a different body.
```

### Try without a domain

```text
Try Egg without owning a domain. Read docs/selfhost/TRY-WITHOUT-DOMAIN.md in the Egg repository and follow it: clone the repository, run pnpm install and pnpm run setup in web/, set APP_URL to http://127.0.0.1.nip.io:3000 with LOCAL_MODE=1 and LOCAL_MODE_ALLOW_REMOTE=1, then start with pnpm egg start --dev. Open that exact address, sign in with the recovery key from .env.local, and run pnpm run doctor. Tell me the address, the warning to expect, and which features a trial host cannot offer. Keep the login page private.
```

## When the agent starts writing

Reading the docs is public. Acting through the API is not: it needs a token on the Developer page, sent as `Authorization: Bearer`. The site's "Docs for agents" page covers `/api/v1/agent-spec.json`, the MCP endpoint, idempotency keys and the rollout wait. Read that page before letting an agent make changes.
