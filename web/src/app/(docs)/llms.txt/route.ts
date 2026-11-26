import { llmsTxt } from "../docs/_data/markdown";

/** The docs index for language models: each page's address and summary. */
export function GET(req: Request) {
  return new Response(llmsTxt(new URL(req.url).origin), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
