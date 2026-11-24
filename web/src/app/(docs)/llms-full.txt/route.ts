import { FULL } from "../docs/_data/generated-markdown";

/** Every docs page as Markdown in one file, for models that read the whole site at once. */
export function GET() {
  return new Response(FULL, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
