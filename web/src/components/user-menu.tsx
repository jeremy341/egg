"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpenIcon, CompassIcon, GearSixIcon, PlusIcon, ShieldWarningIcon, SignOutIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useAccount } from "@/components/account-context";
import { api } from "@/components/api";
import { requestReplay } from "@/components/onboarding/replay";
import { CharacterAvatar } from "@/components/ui/character-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { replayTarget } from "@/lib/onboarding-flow";
import { cn } from "@/lib/utils";

/** Account row at the bottom of the sidebar. */
export function UserMenu({ className }: { className?: string }) {
  const { user, servers, projects } = useAccount();
  const router = useRouter();

  /** Clear the tour marks, then open the page where the tour picks up from where the account stands. */
  async function showTour() {
    const target = replayTarget({ serverStatuses: servers.map((s) => s.status), projectCount: projects.length });
    try {
      await api("/api/onboarding", { method: "DELETE" });
    } catch {
      // The marks stay as they were; the tour still opens, because a replay ignores them.
    }
    requestReplay(target);
    router.push(target.path);
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className={cn(
          "touch-target flex h-9 w-full items-center gap-2 rounded-md px-2 text-left font-medium tracking-[-0.02em] transition-colors duration-(--dur-fast) hover:bg-[var(--ds-gray-alpha-100)] aria-expanded:bg-[var(--ds-gray-alpha-100)] focus-visible:outline-offset-[-2px]",
          className
        )}
      >
        <CharacterAvatar id={user.avatar} size={20} />
        <span className="min-w-0 flex-1 truncate">{user.shownName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60" align="start" side="top">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Signed in as {user.shownName}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings" />}>
          <GearSixIcon />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/account" />}>
          <UserCircleIcon />
          Account
        </DropdownMenuItem>
        {user.isAdmin ? (
          <DropdownMenuItem render={<Link href="/admin/grafts" />}>
            <ShieldWarningIcon />
            Instance administration
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem render={<Link href="/connect" />}>
          <PlusIcon />
          Connect a server
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/security/report" />}>
          <ShieldWarningIcon />
          Report a vulnerability
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void showTour()}>
          <CompassIcon />
          Show the setup tour
        </DropdownMenuItem>
        <DropdownMenuItem
          render={
            <a href="https://guides.hackclub.app" target="_blank" rel="noreferrer" />
          }
        >
          <BookOpenIcon />
          Nest guides
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between px-1.5 py-1">
          <span className="text-sm">Theme</span>
          <ThemeToggle />
        </div>
        <DropdownMenuSeparator />
        {/* A form POST, so logging out cannot be triggered by a link. */}
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-offset-[-2px] max-sm:min-h-10"
          >
            <SignOutIcon className="size-4" />
            Log out
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
