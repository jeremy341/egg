import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeploymentTimeline } from "@/components/deployment-timeline";
import { buildTimeline, type TimelineDeployment, type TimelineLog } from "@/lib/deploy-timeline";

const T0 = Date.parse("2026-11-13T10:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000);
const base: TimelineDeployment = {
  state: "queued", source: "manual", env: "production", port: 5173, error: null,
  createdAt: at(0), startedAt: null, activationStartedAt: null, finishedAt: null,
};
const log = (s: number, message: string): TimelineLog => ({ at: at(s), level: "info", message });

const render = (dep: TimelineDeployment, logs: TimelineLog[] = []) =>
  renderToStaticMarkup(createElement(DeploymentTimeline, { timeline: buildTimeline(dep, [], logs), repo: "sam/recipe-api", sha: "837638e1234567" }));

describe("DeploymentTimeline", () => {
  it("is an ordered list with the current step marked and a polite live region", () => {
    const html = render({ ...base, state: "building", startedAt: at(1) }, [log(1, "Deploying x (production) to y")]);
    expect(html).toContain("<ol");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain("Preparing. Step 2 of 6.");
    expect(html).toContain("Cloning your repository");
  });

  it("does not rely on colour: every stage carries its state as text", () => {
    const html = render({ ...base, state: "building", startedAt: at(1) });
    expect(html).toContain(", in progress");
    expect(html).toContain(", done");
    expect(html).toContain(", waiting");
    expect(html).toContain(">In progress<");
  });

  it("leads a failure with the message and keeps what Egg recorded", () => {
    const html = render({
      ...base, state: "error", startedAt: at(1), finishedAt: at(4),
      error: "Could not clone the repository. Check the branch name and that Egg has access to it.",
    });
    expect(html).toContain("This deployment failed");
    expect(html).toContain("Egg could not clone your repository.");
    expect(html).toContain("What Egg recorded:");
    expect(html).toContain(", failed");
    expect(html).toContain(">Failed<");
  });

  it("links the commit when it is known", () => {
    expect(render(base)).toContain("837638e");
  });

  it("shows no alert for a deployment that went well", () => {
    const html = render({ ...base, state: "ready", startedAt: at(1), finishedAt: at(70) });
    expect(html).not.toContain("This deployment failed");
    expect(html).toContain("The deployment is live.");
  });

  it("shows the live note for a live worker but not for a failed deployment", () => {
    const live = render(
      { ...base, workloadKind: "worker", listenPort: null, port: 0, state: "ready", startedAt: at(1), finishedAt: at(20) },
      [log(18, "Worker is active")]
    );
    expect(live).toContain("the process stays active");

    const failed = render({
      ...base,
      state: "error",
      startedAt: at(1),
      finishedAt: at(4),
      error: "Could not clone the repository. Check the branch name and that Egg has access to it.",
    });
    expect(failed).not.toContain("the process stays active");
  });
});
