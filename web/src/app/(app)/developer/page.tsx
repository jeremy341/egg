import { Suspense } from "react";
import { DeveloperHub } from "@/components/developer-docs";
import { DeveloperTokens } from "@/components/developer-tokens";
import { DeveloperSkeleton } from "@/components/skeletons/developer";
import { requireUser } from "@/server/auth/current";
import { SCOPES, SCOPE_LABEL } from "@/server/api-tokens";
import { config } from "@/server/config";

export const metadata = { title: "Developer" };

export default function DeveloperPage() {
  return (
    <Suspense fallback={<DeveloperSkeleton />}>
      <DeveloperContent />
    </Suspense>
  );
}

/**
 * The page header lives inside DeveloperTokens so "Create token" can open the
 * dialog that the token list owns. The addresses card is the right column.
 */
async function DeveloperContent() {
  await requireUser();
  const origin = new URL(config().APP_URL).origin;
  return (
    <div className="motion-enter">
      <DeveloperTokens
        scopes={SCOPES.map((id) => ({ id, label: SCOPE_LABEL[id] }))}
        aside={
          <aside aria-labelledby="hub-heading" className="min-w-0 lg:sticky lg:top-20">
            <DeveloperHub origin={origin} />
          </aside>
        }
      />
    </div>
  );
}
