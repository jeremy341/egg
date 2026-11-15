import { describe, expect, it } from "vitest";
import { DeploymentLogger } from "@/server/deploy/logger";

describe("DeploymentLogger.mask", () => {
  it("masks secrets in text that is stored outside the log, such as a deployment's error", () => {
    const log = new DeploymentLogger("d1");
    log.setSecrets(["s3cr3t-token-value", "abc"]);
    expect(log.mask("fatal: could not read s3cr3t-token-value from remote")).toBe("fatal: could not read *** from remote");
    expect(log.mask("abc")).toBe("abc"); // under 4 characters would only add noise
  });
});
