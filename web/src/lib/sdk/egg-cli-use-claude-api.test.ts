import { describe, expect, it } from "vitest";
import { parseCli } from "../../../scripts/egg-cli.mjs";
import { commands } from "../../../scripts/egg-cli-groups/use-claude-api.mjs";
import { Egg } from "./egg";

describe("use-claude-api CLI group", () => {
  it("leaves unsupported checklist commands unregistered until the SDK exposes their methods", () => {
    const sdkMethods = Egg.prototype as unknown as Record<string, unknown>;
    for (const method of [
      "resolveAndSetDefaultScope",
      "showContext",
      "clearContext",
      "callApi",
      "searchApi",
      "describeOperation",
    ]) {
      expect(sdkMethods[method], `Egg.${method}`).toBeUndefined();
    }

    expect(commands).toEqual([]);
    for (const argv of [
      ["use", "org", "my-org"],
      ["context", "show"],
      ["context", "clear"],
      ["api", "GET", "/health"],
      ["api", "search", "deployments"],
      ["api", "describe", "getDeployments"],
    ]) {
      expect(parseCli(argv)).toMatchObject({ ok: false });
    }
  });
});
