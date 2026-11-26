"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/components/api";
import type { MaintenanceState } from "@/server/maintenance";
import { useAccount } from "@/components/account-context";
import { Alert } from "@/components/ui/alert";

export function MaintenanceNotice() {
  const { user, maintenance } = useAccount();
  const admin = !!user.isAdmin;
  const [state, setState] = useState<MaintenanceState>(maintenance ?? { enabled: false, active: false, message: "", startsAt: null, endsAt: null, updatedAt: null });
  useEffect(() => {
    let live = true;
    const refresh = () => { void api<{ maintenance: MaintenanceState }>("/api/maintenance").then((data) => { if (live) setState(data.maintenance); }).catch(() => {}); };
    const timer = setInterval(refresh, 30_000);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => { live = false; clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, []);
  if (!state.active) return null;
  // The same warning frame as every other notice in the app, so it follows the theme.
  return <aside aria-label="Maintenance notice" className="mb-6">
    <Alert tone="warning" role="status" title={<>Maintenance · {admin ? "administrator access remains available" : "Egg is temporarily read-only"}</>}>
    <p className="break-words">{state.message || "We are maintaining this Egg instance. You can continue viewing your projects."}</p>
    <p>GitHub events are paused. Failed deliveries need redelivery after the window; pushes can also be deployed manually.</p>
    <p className="text-muted-foreground">{state.endsAt ? `Scheduled to end ${new Date(state.endsAt).toLocaleString()}. ` : ""}{admin ? <Link href="/admin" className="link underline">Manage this window</Link> : "New changes and deployments are paused. Canceling a deployment, signing out, and cleanup recovery remain available."}</p>
    </Alert>
  </aside>;
}
