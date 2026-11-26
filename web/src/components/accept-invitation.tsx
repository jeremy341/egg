"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/components/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** Accept an invitation from its link. The server checks the signed-in account's verified email. */
export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const joined = await api<{ orgId: string }>("/api/invitations/accept", { body: { token } });
      router.push(`/organizations/${joined.orgId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "This invitation could not be accepted.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p>Accept to join this organization. Your account email must match the address the invitation was sent to, and it must be verified.</p>
      {error ? <Alert tone="error" role="alert">{error}</Alert> : null}
      <Button onClick={accept} disabled={busy}>Accept invitation</Button>
    </div>
  );
}
