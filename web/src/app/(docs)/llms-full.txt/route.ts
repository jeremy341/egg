import { llmsFullTxt } from "../docs/_data/markdown";

/** Every docs page as Markdown in one file, for models that read the whole site at once. */
export function GET() {
  return new Response(llmsFullTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
