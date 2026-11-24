import { cn } from "@/lib/utils";
import parity from "@/server/parity/orchard-parity.json";
import { FeatureMatrix } from "../_components/feature-matrix";
import { ARTICLE, PageHeader } from "../_components/prose";

export const metadata = {
  title: "Feature comparison",
  description: "Compare Egg's public API with Orchard MCP tools, including partial coverage and tools that do not apply.",
};

export default function FeaturesPage() {
  return (
    <article id="docs-article" data-docs-page="features" data-docs-body tabIndex={-1} className={cn(ARTICLE, "outline-none")}>
      <PageHeader
        tag="Documentation"
        title="Feature comparison"
        titleId="features-h"
        lead="A tool-by-tool comparison of Orchard MCP and Egg. Endpoint links go to Egg's API reference; notes explain partial coverage and exceptions."
      />
      <FeatureMatrix manifest={parity} />
    </article>
  );
}
