import { AccountProvider } from "@/components/account-context";
import { OnboardingHost } from "@/components/onboarding/host";
import { PreferencesSync } from "@/components/preferences-sync";
import { shownName } from "@/lib/preferences";
import { requireUser } from "@/server/auth/current";
import { config } from "@/server/config";
import { listThemes } from "@/server/custom-themes";
import { getMarks, onboardingFacts } from "@/server/onboarding";
import { getPreferences } from "@/server/preferences";
import { projectViews, serverViews } from "@/server/queries";
import { isInstanceAdmin } from "@/server/admin-identity";
import { maintenanceState } from "@/server/maintenance";

/** Loads the signed-in user, their servers and projects for the shell. */
export async function AccountLoader({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [servers, projects, prefs, themes, maintenance, marks, tourFacts, isAdmin] = await Promise.all([
    serverViews(user.id),
    projectViews(user.id),
    getPreferences(user.id),
    listThemes(user.id),
    maintenanceState(),
    // The guided tour: what has been marked, and the few facts it is worked out from.
    getMarks(user.id),
    onboardingFacts(user.id),
    isInstanceAdmin(user.id),
  ]);

  return (
    <AccountProvider
      value={{
        user: { name: user.name, shownName: shownName(prefs, user.name), avatar: prefs.avatar, isAdmin },
        maintenance,
        servers: servers.map((s) => ({
          id: s.id,
          nestUsername: s.nestUsername,
          host: s.host,
          status: s.status,
        })),
        projects: projects.map((p) => ({ slug: p.slug, name: p.name, role: p.role ?? "owner" })),
      }}
    >
      {/* Marks the signed-in app: the colour theme chosen in Settings applies where this is on the page (globals.css). */}
      <span hidden data-signed-in="" />
      <PreferencesSync
        saved={prefs}
        customThemes={themes.filter((t) => [prefs.lightPreset, prefs.darkPreset, prefs.preset].includes(t.preset))}
      />
      <OnboardingHost facts={tourFacts} marks={marks} localMode={config().LOCAL_MODE} />
      {children}
    </AccountProvider>
  );
}
