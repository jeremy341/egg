import { AccountProvider } from "@/components/account-context";
import { PreferencesSync } from "@/components/preferences-sync";
import { shownName } from "@/lib/preferences";
import { requireUser } from "@/server/auth/current";
import { getPreferences } from "@/server/preferences";
import { projectViews, serverViews } from "@/server/queries";

/** Loads the signed-in user, their servers and projects for the shell. */
export async function AccountLoader({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [servers, projects, prefs] = await Promise.all([
    serverViews(user.id),
    projectViews(user.id),
    getPreferences(user.id),
  ]);

  return (
    <AccountProvider
      value={{
        user: { name: user.name, shownName: shownName(prefs, user.name), avatar: prefs.avatar },
        servers: servers.map((s) => ({
          id: s.id,
          nestUsername: s.nestUsername,
          host: s.host,
          status: s.status,
        })),
        projects: projects.map((p) => ({ slug: p.slug, name: p.name })),
      }}
    >
      <PreferencesSync saved={prefs} />
      {children}
    </AccountProvider>
  );
}
