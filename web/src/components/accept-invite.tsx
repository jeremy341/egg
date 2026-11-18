"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/components/api";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { errorText } from "@/lib/developer";
import { INVITE_REFUSED, tokenFromHash } from "@/lib/team";

type Result = { kind: "done" } | { kind: "signin" } | { kind: "refused" } | { kind: "missing" } | { kind: "failed"; text: string };

/**
 * What an invited person sees. The token is in the URL fragment, so no server or log has it. It is read when the button is
 * pressed and then removed from the address bar, so it does not stay in the history or in a screenshot.
 */
export function AcceptInvite() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function accept() {
    const token = tokenFromHash(window.location.hash);
    // Gone from the address bar whatever happens next.
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) return setResult({ kind: "missing" });
    setBusy(true);
    try {
      await api("/api/project-invitations/accept", { body: { token } });
      setResult({ kind: "done" });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "unauthorized") setResult({ kind: "signin" });
      else if (code === "not_found") setResult({ kind: "refused" });
      else setResult({ kind: "failed", text: errorText(e, "Something went wrong. Try again.") });
    } finally {
      setBusy(false);
    }
  }

  if (result?.kind === "done") {
    return (
      <div className="space-y-4">
        <Alert tone="success" role="status" title="You have joined the project">
          It is in your project list now, with the access the owner gave you.
        </Alert>
        <Link href="/projects" className={buttonVariants()}>
          Open your projects
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {result?.kind === "signin" ? (
        <Alert
          tone="warning"
          role="alert"
          title="Sign in first"
          action={
            <Link href="/login" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Sign in
            </Link>
          }
        >
          Sign in with the account the owner invited, then open the invitation link again. Signing in does not carry the
          link over, so use the same link from the owner.
        </Alert>
      ) : null}
      {result?.kind === "refused" ? (
        <Alert tone="error" role="alert" title="This invitation did not work">
          {INVITE_REFUSED}
        </Alert>
      ) : null}
      {result?.kind === "missing" ? (
        <Alert tone="error" role="alert" title="This link has no invitation in it">
          Ask the project owner to send the whole link again. Pressing the button once removes the invitation from the
          address bar, so reload the original link if you pressed it already.
        </Alert>
      ) : null}
      {result?.kind === "failed" ? (
        <Alert tone="error" role="alert">
          {result.text}
        </Alert>
      ) : null}
      <Button onClick={() => void accept()} loading={busy}>
        Accept the invitation
      </Button>
    </div>
  );
}
