import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_DEPLOYMENT_STREAMS_PER_USER,
  deploymentStreamsInUse,
  resetDeploymentStreams,
  takeDeploymentStream,
} from "@/server/deployment-streams";

describe("deployment stream slots", () => {
  beforeEach(() => resetDeploymentStreams());

  it("caps the number of streams one user may hold", () => {
    const held = Array.from({ length: MAX_DEPLOYMENT_STREAMS_PER_USER }, () => takeDeploymentStream("u1"));
    expect(deploymentStreamsInUse()).toEqual({ u1: MAX_DEPLOYMENT_STREAMS_PER_USER });
    expect(() => takeDeploymentStream("u1")).toThrow(/too many deployment log streams/i);
    expect(deploymentStreamsInUse()).toEqual({ u1: MAX_DEPLOYMENT_STREAMS_PER_USER });
    held.forEach((release) => release());
    expect(deploymentStreamsInUse()).toEqual({});
  });

  it("does not let one user's streams limit another user", () => {
    const held = Array.from({ length: MAX_DEPLOYMENT_STREAMS_PER_USER }, () => takeDeploymentStream("u1"));
    expect(takeDeploymentStream("u2")).toBeTypeOf("function");
    expect(deploymentStreamsInUse()).toEqual({ u1: MAX_DEPLOYMENT_STREAMS_PER_USER, u2: 1 });
    held.forEach((release) => release());
  });

  it("only frees the first call to a release function", () => {
    const release = takeDeploymentStream("u1");
    release();
    release();
    expect(deploymentStreamsInUse()).toEqual({});
    expect(takeDeploymentStream("u1")).toBeTypeOf("function");
  });
});
