import { Suspense } from "react";
import Link from "next/link";
import { SettingsForm } from "@/components/settings-form";
import { SettingsSkeleton } from "@/components/skeletons/settings";
import { requireUser } from "@/server/auth/current";
import { listThemes } from "@/server/custom-themes";
import { getPreferences } from "@/server/preferences";
import { CleanupCard } from "@/components/cleanup-card";

export const metadata = { title: "Settings" };

async function SettingsContent() {
  const user = await requireUser();
  const [prefs, themes] = await Promise.all([getPreferences(user.id), listThemes(user.id)]);
  return (
    <div className="motion-enter mx-auto max-w-[720px]">
      <div className="mb-6">
        <h1 className="truncate text-title-1">Settings</h1>
        <p className="mt-1 max-w-[64ch] text-muted-foreground">
          How Egg looks and behaves for you. Your Hack Club details are on the{" "}
          <Link href="/account" className="link">
            account page
          </Link>
          .
        </p>
      </div>
      <SettingsForm initial={prefs} hackClubName={user.name} customThemes={themes} />
      <div className="mt-6"><CleanupCard name={user.name} /></div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <SettingsContent />
    </Suspense>
  );
}
