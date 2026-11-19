import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StatusPageCard } from "@/components/project-automation";
import { ServiceCard } from "@/components/service-status";
import type { ProjectView } from "@/server/queries";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

describe("worker monitoring UI", () => {
  it("describes process status on the public status page control", () => {
    const html = renderToStaticMarkup(createElement(StatusPageCard, {
      project: { id: "worker", workloadKind: "worker", statusUrl: null } as ProjectView,
    }));
    expect(html).toContain("whether this worker is running");
    expect(html).not.toContain("whether this app is answering");
  });

  it("does not promise an HTTP health reading while loading worker status", () => {
    const html = renderToStaticMarkup(createElement(ServiceCard, { projectId: "worker", workloadKind: "worker" }));
    expect(html).not.toContain("Health check");
    expect(html).toContain("Worker process");
  });
});
