import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HostingOptions, workloadForRuntime } from "@/components/hosting-options";

describe("hosting setup", () => {
  it("keeps an existing project's workload fixed and explains conversion", () => {
    const html = renderToStaticMarkup(createElement(HostingOptions, {
      prefix: "saved", workloadKind: "worker", deploymentMode: "native", workloadLocked: true,
      onWorkloadChange() {}, onModeChange() {}, capabilities: null,
    }));
    expect(html).toMatch(/<select[^>]*id="saved-workload"[^>]*disabled=""/);
    expect(html).toContain("Create a separate project to change between a web service and a worker.");
  });

  it("chooses a web workload for detected static sites while preserving workers for native runtimes", () => {
    expect(workloadForRuntime("static", "worker")).toBe("web");
    expect(workloadForRuntime("python", "worker")).toBe("worker");
  });
  it("explains a worker's readiness without asking it to serve HTTP", () => {
    const html = renderToStaticMarkup(createElement(HostingOptions, {
      prefix: "test", workloadKind: "worker", deploymentMode: "native",
      onWorkloadChange() {}, onModeChange() {}, capabilities: null,
    }));
    expect(html).toContain("Bot or background worker");
    expect(html).toContain("For bots and background apps, such as a Discord bot");
    expect(html).toContain("No HTTP health check");
    expect(html).toContain("optional listen port");
    expect(html).toContain("systemd");
    expect(html).toContain("Scheduled jobs");
  });

  it("keeps Docker choices disabled and shows the target's actual reason", () => {
    const html = renderToStaticMarkup(createElement(HostingOptions, {
      prefix: "test", workloadKind: "web", deploymentMode: "native",
      onWorkloadChange() {}, onModeChange() {},
      capabilities: { deploymentModes: { native: true, dockerfile: false, compose: false, image: false },
        docker: { available: false, composeAvailable: false, reason: "Docker is not available in this Nest container." }, runtimes: ["node"] },
    }));
    expect(html).toContain("Docker is not available in this Nest container.");
    expect(html).toMatch(/<option value="dockerfile" disabled=""/);
    expect(html).toMatch(/<option value="compose" disabled=""/);
  });
});
