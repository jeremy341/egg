"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/components/api";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { errorText } from "@/lib/developer";
import { INVITE_REFUSED, tokenFromHash } from "@/lib/team";

export type AcceptResult =
  | { kind: "done"; alreadyMember: boolean }
  | { kind: "signin" }
  | { kind: "refused" }
  | { kind: "missing" }
  | { kind: "failed"; text: string };

/** What one accept attempt means for the page: the server's answer, or its refusal. */
export function acceptOutcome(
  res: { alreadyMember?: boolean } | null,
  error?: unknown
): AcceptResult {
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "unauthorized") return { kind: "signin" };
    if (code === "not_found") return { kind: "refused" };
    return { kind: "failed", text: errorText(error, "Something went wrong. Try again.") };
  }
  return { kind: "done", alreadyMember: res?.alreadyMember === true };
}

/**
 * What an invited person sees. The token is in the URL fragment, so no server or log has it, and it leaves the address
 * bar only once the answer is final: a failed attempt can be retried from the same link, not a fresh one.
 */
export function AcceptInvite() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AcceptResult | null>(null);
  // The invitation once it has been read, kept so the retry button can post it again.
  const [token, setToken] = useState<string | null | undefined>(undefined);

  /** A final answer takes the invitation out of the address bar; a failure leaves it there for the retry. */
  function finish(outcome: AcceptResult) {
    if (outcome.kind !== "failed") window.history.replaceState(null, "", window.location.pathname);
    setResult(outcome);
  }

  async function accept() {
    const value = token ?? tokenFromHash(window.location.hash);
    setToken(value);
    if (!value) return finish({ kind: "missing" });
    setBusy(true);
    try {
      const res = await api<{ projectId: string; alreadyMember: boolean }>(
        "/api/project-invitations/accept",
        { body: { token: value } }
      );
      finish(acceptOutcome(res));
    } catch (e) {
      finish(acceptOutcome(null, e));
    } finally {
      setBusy(false);
    }
  }

  if (result?.kind === "done") {
    return (
      <div className="space-y-4">
        <Alert
          tone="success"
          role="status"
          title={result.alreadyMember ? "You are already on this project" : "You have joined the project"}
        >
          {result.alreadyMember
            ? "Nothing changed. An invitation never changes the access you already have."
            : "It is in your project list now, with the access the owner gave you."}
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
          Ask the project owner to send the whole link again. The invitation leaves the address bar once it has been used
          or refused, so reload the original link if that has already happened.
        </Alert>
      ) : null}
      {result?.kind === "failed" ? (
        <Alert tone="error" role="alert">
          {result.text}
        </Alert>
      ) : null}
      {/* The button under a failure posts again: the token is still in hand and still in the address bar. */}
      <Button onClick={() => void accept()} loading={busy}>
        {result?.kind === "failed" ? "Try again" : "Accept the invitation"}
      </Button>
    </div>
  );
}
