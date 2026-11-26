import { INDEX } from "./generated-markdown";

/**
 * The docs index for language models. Generated at build time by
 * scripts/generate-docs-markdown.ts so this module never imports
 * react-dom/server (which Next forbids in route handlers).
 */
export function llmsTxt(origin: string): string {
  return INDEX.replaceAll("__EGG_ORIGIN__", origin.replace(/\/$/, ""));
}
