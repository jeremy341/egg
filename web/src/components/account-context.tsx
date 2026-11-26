"use client";

import { createContext, useContext } from "react";
import type { MaintenanceState } from "@/server/maintenance";

export type AccountServer = {
  id: string;
  nestUsername: string;
  host: string;
  status: "pending" | "connected" | "error" | "disconnected";
};

export type Account = {
  /** `name` is the Hack Club name. `shownName` is the display name if one is set, else `name`. */
  user: { name: string; shownName: string; avatar: string; isAdmin?: boolean };
  maintenance?: MaintenanceState;
  servers: AccountServer[];
  projects: { slug: string; name: string }[];
};

const AccountContext = createContext<Account | null>(null);

export function AccountProvider({
  value,
  children,
}: {
  value: Account;
  children: React.ReactNode;
}) {
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): Account {
  const v = useContext(AccountContext);
  if (!v) throw new Error("useAccount must be used inside the app shell");
  return v;
}

export function initials(name: string) {
  return name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "ND";
}

/** The account when inside the app shell, or null on public pages. */
export function useOptionalAccount(): Account | null {
  return useContext(AccountContext);
}
