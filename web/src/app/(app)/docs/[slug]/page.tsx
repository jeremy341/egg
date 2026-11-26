import { Suspense } from "react";
import { notFound } from "next/navigation";
import { LoadingRegion, Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { CONTENT } from "../_content";
import { OnThisPage } from "../_components/on-this-page";
import { PrevNext } from "../_components/prev-next";
import { ARTICLE } from "../_components/prose";
import { cn } from "@/lib/utils";
import { DOCS_SECTIONS, getSection } from "../_data/nav";
import { SUMMARIES } from "../_data/summaries";

type Props = { params: Promise<{ slug: string }> };

/** Every page is known ahead of time, so they can all be built up front. */
export function generateStaticParams() {
  return DOCS_SECTIONS.map((s) => ({ slug: s.id }));
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const section = getSection(slug);
  return section ? { title: section.title, description: SUMMARIES[slug] } : {};
}

/** A page's shape while it loads: the title, the intro, then paragraphs and a block. */
function DocsPageSkeleton() {
  return (
    <LoadingRegion label="Loading…" className={ARTICLE}>
      <SkeletonText size="body" width="w-32" />
      <SkeletonText size="title-1" width="w-56" className="mt-4" />
      <SkeletonText size="body" width="w-full" lines={2} className="mt-3" />
      <SkeletonText size="title-3" width="w-48" className="mt-12" />
      <SkeletonText size="body" width="w-full" lines={4} className="mt-4" />
      <Skeleton className="mt-6 h-40 w-full" />
    </LoadingRegion>
  );
}

export default function DocsPage({ params }: Props) {
  return (
    <Suspense fallback={<DocsPageSkeleton />}>
      <DocsPageContent params={params} />
    </Suspense>
  );
}

async function DocsPageContent({ params }: Props) {
  const { slug } = await params;
  const section = getSection(slug);
  const content = CONTENT[slug];
  if (!section || !content) notFound();

  return (
    <div data-docs-page={slug} className="min-[1280px]:grid min-[1280px]:grid-cols-[minmax(0,680px)_minmax(0,1fr)_216px] min-[1536px]:grid-cols-[minmax(0,780px)_minmax(0,1fr)_216px] min-[1280px]:gap-12">
      {/* The article and the rail sit on the page with space between them; the rail has no box. */}
      <article id="docs-article" data-docs-body tabIndex={-1} className={cn(ARTICLE, "scroll-mt-32 outline-none")}>
        {content()}
        <PrevNext sectionId={slug} />
      </article>
      <div className="min-w-0 min-[1280px]:col-start-3">
        <OnThisPage key={slug} pageId={slug} items={section.subsections} />
      </div>
    </div>
  );
}
