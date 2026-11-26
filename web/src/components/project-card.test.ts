import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectCard } from "@/components/project-card";
import type { ProjectView } from "@/server/queries";

const worker: ProjectView = {
  id: "worker-1", branch: "main", runtime: "node", deploymentMode: "native",
  dockerfilePath: null, composeFilePath: null, composeService: null, containerPort: null, startCommand: null,
  healthPath: "/", autoDeploy: false, buildLocation: "container", hookActive: false,
  hookCreatedAt: null, notify: null, serverId: "server-1", nestUsername: "sam",
  lastShaFull: null, latestDeploymentId: null, monitorSince: null, analyticsKey: null,
  statusUrl: null, homepageFeed: false, homepageFeedPossible: false,
  slug: "queue-worker", name: "Queue worker", workloadKind: "worker", listenPort: null,
  port: 0, domains: [], repoUrl: "https://gitlab.com/sam/queue-worker", repo: "sam/queue-worker",
  monitor: "down", state: "ready", lastAge: null, lastCommit: null, lastSha: null,
};

describe("worker project cards", () => {
  it("describes a process instead of advertising an invalid public port", () => {
    const html = renderToStaticMarkup(createElement(ProjectCard, { project: worker }));
    expect(html).toContain("Background worker");
    expect(html).toContain("Not running");
    expect(html).not.toContain("port 0");
    expect(html).not.toContain("Not answering");
  });
});
