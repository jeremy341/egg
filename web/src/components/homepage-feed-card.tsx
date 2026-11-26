"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/api";
import { Card } from "@/components/settings-ui";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { ProjectView } from "@/server/queries";

/**
 * Opt in to listing this project's deployments on the public Egg homepage. Off by default and
 * separate from the status page. The server enforces the rules (owner only, public GitHub
 * repository); the text here says what becomes public, matched to server/public-feed.ts.
 */
export function HomepageFeedCard({ project }: { project: ProjectView }) {
  const router = useRouter();
  const [on, setOn] = useState(project.homepageFeed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${project.id}/homepage-feed`, { method: on ? "DELETE" : "POST", body: on ? undefined : {} });
      setOn(!on);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change this setting");
    } finally {
      setBusy(false);
    }
  }

  const blocked = !on && !project.homepageFeedPossible;

  return (
    <Card
      id="homepage-feed-heading"
      title="Show on Egg Homepage"
      description="Lists this project's latest deployments on the public Egg homepage, so visitors can see real pushes. Off unless you turn it on. It is separate from the public status page."
    >
      <p className={on ? undefined : "text-muted-foreground"}>
        {on ? "Shown on the Egg homepage." : "Not shown."}
      </p>
      <p className="mt-3 font-medium">What becomes public</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-label text-muted-foreground">
        <li>
          For each deployment: the first line of the commit message, the short commit, the branch, the state, Production or
          Preview, the time, the owner's name as you set it in Settings (Someone if you have turned that off), and the repository name ({project.repo ?? "owner/name"}). Each row links to the commit on GitHub.
        </li>
        <li>
          Never build logs, your server, ports, or environment variables. Never your Hack Club name or email.
        </li>
        <li>
          Public GitHub repositories only. Egg asks GitHub whether the repository is public when you turn this on and again each
          time the list is built, which is at most once a minute. If the repository becomes private, it leaves the homepage within
          a minute.
        </li>
        <li>
          Commit messages in a public repository are already public. This puts them in front of more people, and failed
          deployments are listed too.
        </li>
      </ul>
      {blocked ? (
        <Alert tone="info" className="mt-3">
          Only projects imported through the GitHub App can be shown, because Egg has to confirm with GitHub that the
          repository is public.
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="error" role="alert" className="mt-3">
          {error}
        </Alert>
      ) : null}
      <div className="mt-4">
        <Button
          type="button"
          variant={on ? "outline" : "default"}
          disabled={blocked}
          onClick={() => void toggle()}
          loading={busy}
        >
          {busy ? (on ? "Stopping…" : "Checking…") : on ? "Stop showing" : "Show on homepage"}
        </Button>
      </div>
    </Card>
  );
}
