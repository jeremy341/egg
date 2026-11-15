"use client";

import Link from "next/link";
import { BookOpenIcon, GearSixIcon, PlusIcon, SignOutIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useAccount } from "@/components/account-context";
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
import { cn } from "@/lib/utils";

/** Account row at the bottom of the sidebar. */
export function UserMenu({ className }: { className?: string }) {
  const { user } = useAccount();

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
        <DropdownMenuItem render={<Link href="/connect" />}>
          <PlusIcon />
          Connect a server
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
