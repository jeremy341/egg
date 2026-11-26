import { Suspense } from "react";
import { KeysManager } from "@/components/keys-manager";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/auth/current";

export const metadata = { title: "Keys" };

export default function KeysPage() {
  return (
    <Suspense fallback={<KeysSkeleton />}>
      <KeysContent />
    </Suspense>
  );
}

/** The page's own data is loaded in the browser by KeysManager; this only checks the sign-in. */
async function KeysContent() {
  await requireUser();
  return (
    <div className="motion-enter mx-auto max-w-[720px]">
      <KeysManager />
    </div>
  );
}

/** The header and the three cards, while the page's server part renders. */
function KeysSkeleton() {
  return (
    <LoadingRegion label="Loading keys…">
      <div aria-hidden="true" className="mx-auto max-w-[720px] space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </LoadingRegion>
  );
}
