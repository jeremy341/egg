import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContainerDeploymentFields, containerDeploymentBody, containerConfigurationError, defaultContainerForm } from "@/components/container-deployment-fields";

describe("container deployment setup", () => {
  it("asks a Compose web service for a file, service and internal port", () => {
    const html = renderToStaticMarkup(createElement(ContainerDeploymentFields, { prefix: "docker", mode: "compose", workloadKind: "web", value: defaultContainerForm, onChange() {} }));
    expect(html).toContain('id="docker-compose-file"');
    expect(html).toContain('id="docker-compose-service"');
    expect(html).toContain('id="docker-container-port"');
  });
  it("sends the internal container port for every container workload and excludes settings for native mode", () => {
    expect(containerDeploymentBody("dockerfile", "worker", defaultContainerForm)).toEqual({ dockerfilePath: "Dockerfile", containerPort: 3000 });
    expect(containerDeploymentBody("dockerfile", "web", defaultContainerForm)).toEqual({ dockerfilePath: "Dockerfile", containerPort: 3000 });
    expect(containerDeploymentBody("native", "web", defaultContainerForm)).toEqual({});
  });
  it("blocks missing Compose service and unsafe paths before submission", () => {
    expect(containerConfigurationError("compose", "web", { ...defaultContainerForm, composeService: "" })).toContain("service");
    expect(containerConfigurationError("dockerfile", "web", { ...defaultContainerForm, dockerfilePath: "../Dockerfile" })).toContain("relative");
    expect(containerConfigurationError("native", "worker", { ...defaultContainerForm, containerPort: "" })).toBeNull();
    expect(containerConfigurationError("dockerfile", "worker", { ...defaultContainerForm, containerPort: "" })).toContain("port the app listens on inside the container");
  });
});
