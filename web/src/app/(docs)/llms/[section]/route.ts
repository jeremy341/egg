import { llmsTxt } from "../../docs/_data/markdown";
import { DOCS_NAV } from "../../docs/_data/nav";

const PLAIN = { "Content-Type": "text/plain; charset=utf-8" };

/** URL form of a nav group's name: "Use it" -> "use-it". */
function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * A smaller llms.txt for one section of the docs: its heading, then that
 * section's pages. The page lines are taken from the main /llms.txt helper, so
 * a title, address or summary can never drift between the two indexes.
 */
export async function GET(req: Request, { params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const group = DOCS_NAV.find((g) => slug(g.group) === slug(section));
  if (!group) return new Response("Not found\n", { status: 404, headers: PLAIN });

  const lines = llmsTxt(new URL(req.url).origin).split("\n");
  const start = lines.indexOf(`## ${group.group}`);
  if (start < 0) return new Response("Not found\n", { status: 404, headers: PLAIN });

  const pages: string[] = [];
  for (let i = start + 1; i < lines.length && !lines[i].startsWith("## "); i++) {
    if (lines[i].startsWith("- [")) pages.push(lines[i]);
  }

  return new Response([`# Egg: ${group.group}`, "", ...pages, ""].join("\n"), { headers: PLAIN });
}
