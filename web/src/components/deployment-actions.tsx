"use client";

import { Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowCounterClockwiseIcon,
  ArrowsClockwiseIcon,
  DotsThreeIcon,
  ProhibitIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { api } from "@/components/api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { isActive } from "@/lib/status";

export type ActionableDeployment = {
  id: string;
  projectSlug: string;
  env: "production" | "preview";
  rawState: string;
  isCurrent: boolean;
  cleanedUp: boolean;
};

type Action = "redeploy" | "rollback" | "cancel";

const ACTION_TEXT: Record<Action, string> = {
  redeploy: "Redeploy",
  rollback: "Instant rollback",
  cancel: "Cancel",
};
const ACTION_ICON: Record<Action, Icon> = {
  redeploy: ArrowsClockwiseIcon,
  rollback: ArrowCounterClockwiseIcon,
  cancel: ProhibitIcon,
};

/** The write actions the menu offers, in order. A viewer gets none: the server refuses each one. */
export function writeActions(
  canAct: boolean,
  d: Pick<ActionableDeployment, "env" | "rawState" | "isCurrent" | "cleanedUp">
): Action[] {
  if (!canAct) return [];
  const actions: Action[] = ["redeploy"];
  if (d.env === "production" && d.rawState === "ready" && !d.isCurrent && !d.cleanedUp) {
    actions.push("rollback");
  }
  if (isActive(d.rawState)) actions.push("cancel");
  return actions;
}

/** Redeploy, roll back, cancel. Each calls the API and refreshes the page. A viewer, who can only read, gets the log link. */
export function DeploymentActions({
  deployment,
  canAct = true,
}: {
  deployment: ActionableDeployment;
  canAct?: boolean;
}) {
  const router = useRouter();
  const d = deployment;

  async function run(action: Action) {
    try {
      const res = await api<{ deployment: { id: string } | null }>(
        `/api/deployments/${d.id}/${action}`,
        { method: "POST" }
      );
      if (res.deployment && action !== "cancel") {
        router.push(`/projects/${d.projectSlug}/deployments/${res.deployment.id}`);
      } else {
        router.refresh();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for deployment ${d.id.slice(0, 7)}`}
            />
          }
        >
          <DotsThreeIcon aria-hidden="true" weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            render={<Link href={`/projects/${d.projectSlug}/deployments/${d.id}`} />}
          >
            <TerminalWindowIcon />
            View logs
          </DropdownMenuItem>
          {writeActions(canAct, d).map((action, i) => {
            const ActionIcon = ACTION_ICON[action];
            return (
              <Fragment key={action}>
                {i > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem onClick={() => void run(action)}>
                  <ActionIcon />
                  {ACTION_TEXT[action]}
                </DropdownMenuItem>
              </Fragment>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
