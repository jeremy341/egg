import { Suspense } from "react";
import { notFound } from "next/navigation";
import { LoadingRegion, Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { CONTENT } from "../_content";
import { OnThisPage } from "../_components/on-this-page";
import { PrevNext } from "../_components/prev-next";
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
    <LoadingRegion label="Loading…" className="max-w-[720px]">
      <SkeletonText size="title-1" width="w-56" />
      <SkeletonText size="body" width="w-full" lines={2} className="mt-3" />
      <SkeletonText size="title-3" width="w-48" className="mt-10" />
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
    <div className="grid gap-x-12 min-[1400px]:grid-cols-[minmax(0,720px)_168px]">
      <article id="docs-article" tabIndex={-1} className="min-w-0 scroll-mt-32 outline-none">
        {content()}
        <PrevNext sectionId={slug} />
      </article>
      <OnThisPage key={slug} pageId={slug} items={section.subsections} />
    </div>
  );
}
