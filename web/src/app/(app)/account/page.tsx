import Link from "next/link";
import { cookies } from "next/headers";
import { AccountView } from "@/components/account-view";
import { ContainerPermissionsSection } from "@/components/container-permissions";
import { Card } from "@/components/settings-ui";
import { PageHeader } from "@/components/page-header";
import { CharacterAvatar } from "@/components/ui/character-avatar";
import { WebhooksCard } from "@/components/webhooks-card";
import { timeAgo } from "@/lib/status";
import { browserLabel, listInstallations, listSessions } from "@/server/account";
import { requireUser } from "@/server/auth/current";
import { SESSION_COOKIE } from "@/server/auth/session";
import { permissionsOf } from "@/server/permissions";
import { listServers } from "@/server/servers";
import { normalizePermissions } from "@/lib/container-permissions";
import { characterFor, shownName } from "@/lib/preferences";
import { getPreferences } from "@/server/preferences";
import { localModeEnabled } from "@/server/config";
import { LocalPasswordCard } from "@/components/local-password-card";
import { CleanupCard } from "@/components/cleanup-card";
import { PasswordSignInCard } from "@/components/password-signin-card";
import { hasOtherSignIn, passwordCredential, signInEnvironment } from "@/server/auth/password-signin";

export const metadata = { title: "Account" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)] sm:gap-4">
      <dt className="text-label text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export default async function AccountPage() {
  const user = await requireUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const [sessions, installations, servers, prefs, passwordSignIn] = await Promise.all([
    listSessions(user.id, token),
    listInstallations(user.id),
    listServers(user.id),
    getPreferences(user.id),
    passwordCredential(user.id),
  ]);

  return (
    <div className="motion-enter mx-auto max-w-[720px]">
      <PageHeader
        leading={<CharacterAvatar id={prefs.avatar} size={40} />}
        title="Account"
        description="Who you are signed in as, and where."
      />

      <div className="space-y-6">
        <Card
          id="profile-heading"
          title="Profile"
          description="Your Hack Club details come from your Hack Club account. Change them there."
        >
          <dl className="hairline-y overflow-hidden rounded-md shadow-border-base">
            <Row label="Shown as">
              {shownName(prefs, user.name)}
              <span className="ml-2 text-label text-muted-foreground">{characterFor(prefs.avatar).label}</span>
              <Link href="/settings#profile-heading" className="touch-target link ml-3 text-label font-medium max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
                Change in Settings
              </Link>
            </Row>
            <Row label="Hack Club name">{user.name}</Row>
            <Row label="Email">{user.email ?? "Not shared"}</Row>
          </dl>
        </Card>

        <Card
          id="github-heading"
          title="GitHub"
          description="Accounts where the Egg app is installed. Change which repositories it can read on GitHub."
        >
          {installations.length === 0 ? (
            <p className="text-muted-foreground">Not connected yet. Import a project to install the app.</p>
          ) : (
            <ul className="hairline-y overflow-hidden rounded-md shadow-border-base">
              {installations.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="min-w-0 truncate font-medium">
                    {i.accountLogin}
                    <span className="ml-2 text-label font-normal text-muted-foreground">{i.accountType}</span>
                  </span>
                  <a
                    href={`https://github.com/settings/installations/${i.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link inline-flex shrink-0 items-center text-label font-medium max-sm:min-h-10"
                  >
                    Manage on GitHub<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <ContainerPermissionsSection
          servers={servers.map((s) => ({
            id: s.id,
            label: s.host === "hackclub.app" ? `${s.nestUsername}.hackclub.app` : s.host,
            nestUsername: s.nestUsername,
            // Anything missing falls back to the defaults, so the terminal is never shown as on by mistake.
            permissions: normalizePermissions(permissionsOf(s)),
          }))}
        />

        <WebhooksCard />

        {localModeEnabled() && user.hackClubId === "local:owner" ? <LocalPasswordCard /> : null}
        {user.hackClubId.startsWith("local:") ? null : (
          <PasswordSignInCard
            enabled={!!passwordSignIn}
            email={user.email}
            canTurnOff={hasOtherSignIn(user, signInEnvironment())}
          />
        )}
        <CleanupCard name={user.name} />

        <AccountView
          name={user.name}
          sessions={sessions.map((s) => ({
            id: s.id,
            label: browserLabel(s.userAgent),
            started: timeAgo(s.createdAt),
            current: s.current,
          }))}
        />
      </div>
    </div>
  );
}
