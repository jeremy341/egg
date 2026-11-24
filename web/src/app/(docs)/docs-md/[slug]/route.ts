import { PAGES } from "../../docs/_data/generated-markdown";

/** A docs page as Markdown. The proxy rewrites /docs/<slug>.md to here. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const md = PAGES[slug];
  if (md === undefined) {
    return new Response("Not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
