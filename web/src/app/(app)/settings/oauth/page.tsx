import { OAuthConnections } from "@/components/oauth-connections";
import { requireUser } from "@/server/auth/current";

export const metadata = { title: "OAuth applications" };

/**
 * The signed-in user's own OAuth clients only. There is no administrator view:
 * requireUser keeps the page behind a browser session, and the client list is
 * fetched from /api/oauth/clients, which scopes every read to that same user.
 */
export default async function OAuthSettingsPage() {
  await requireUser();
  return (
    <div className="motion-enter mx-auto max-w-[720px]">
      <OAuthConnections />
    </div>
  );
}
