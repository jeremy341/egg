import { describe, expect, it } from "vitest";
import { dockerActivationScript, dockerCreateCommand } from "@/server/deploy/remote";

const create = () =>
  dockerCreateCommand({
    container: "egg-demo",
    image: "egg-demo:abc12345",
    envFile: "/data/env/abc12345.env",
    hostPort: 3000,
    containerPort: 3000,
  });

describe("dockerActivationScript", () => {
  it("stages the candidate under its own name before removing the live container", () => {
    const script = dockerActivationScript({
      unit: "egg-demo.service",
      container: "egg-demo",
      candidate: "egg-demo-next",
      create: create(),
    });
    // dockerCreateCommand() shell-quotes every argv token, so the staged name is a quoted pair.
    expect(script).toContain(`'--name' 'egg-demo-next'`);
    expect(script).not.toContain(`'--name' 'egg-demo'` + String.fromCharCode(32));
  });

  it("fails closed when the create command does not stage a container name", () => {
    expect(() =>
      dockerActivationScript({
        unit: "egg-demo.service",
        container: "egg-demo",
        candidate: "egg-demo-next",
        create: "docker create --name=egg-demo egg-demo:abc12345",
      })
    ).toThrow(/does not stage a container name/);
  });
});
