import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, hackClubConfigured, localModeEnabled, resetConfigForTests } from "@/server/config";

function env(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) vi.stubEnv(k, undefined as unknown as string);
    else vi.stubEnv(k, v);
  }
  resetConfigForTests();
}

// Match config.test.ts: start every case with only the local-mode switches set.
beforeEach(() =>
  env({
    LOCAL_MODE: undefined,
    LOCAL_MODE_ALLOW_REMOTE: undefined,
    HACKCLUB_CLIENT_ID: undefined,
    HACKCLUB_CLIENT_SECRET: undefined,
    LOCAL_MODE_SECRET: "test-local-mode-secret-test-local-mode-secret",
    APP_URL: "http://localhost:3000",
  })
);
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe("local mode and Hack Club credentials", () => {
  it("accepts local mode without any Hack Club credentials", () => {
    env({ LOCAL_MODE: "1" });
    expect(() => config()).not.toThrow();
    expect(localModeEnabled()).toBe(true);
    expect(hackClubConfigured()).toBe(false);
  });

  it.each([
    ["HACKCLUB_CLIENT_ID", { HACKCLUB_CLIENT_ID: "client-id" }],
    ["HACKCLUB_CLIENT_SECRET", { HACKCLUB_CLIENT_SECRET: "client-secret" }],
    [
      "HACKCLUB_CLIENT_ID and HACKCLUB_CLIENT_SECRET",
      { HACKCLUB_CLIENT_ID: "client-id", HACKCLUB_CLIENT_SECRET: "client-secret" },
    ],
  ])("refuses local mode with %s", (_label, credentials) => {
    env({ LOCAL_MODE: "1", ...credentials });
    expect(() => config()).toThrow(/LOCAL_MODE cannot be combined with Hack Club credentials/);
  });

  it("names both variables and OAuth in the schema error", () => {
    env({ LOCAL_MODE: "1", HACKCLUB_CLIENT_ID: "client-id", HACKCLUB_CLIENT_SECRET: "client-secret" });
    expect(() => config()).toThrow(/HACKCLUB_CLIENT_ID/);
    expect(() => config()).toThrow(/HACKCLUB_CLIENT_SECRET/);
    expect(() => config()).toThrow(/OAuth/);
  });

  it("still refuses the mix with the remote override on", () => {
    env({
      LOCAL_MODE: "1",
      LOCAL_MODE_ALLOW_REMOTE: "1",
      APP_URL: "https://egg.example.com",
      HACKCLUB_CLIENT_ID: "client-id",
      HACKCLUB_CLIENT_SECRET: "client-secret",
    });
    expect(() => config()).toThrow(/LOCAL_MODE cannot be combined with Hack Club credentials/);
  });

  it("keeps the remote override for a local install with no Hack Club credentials", () => {
    env({ LOCAL_MODE: "1", LOCAL_MODE_ALLOW_REMOTE: "1", APP_URL: "https://egg.example.com" });
    expect(localModeEnabled()).toBe(true);
    expect(hackClubConfigured()).toBe(false);
  });

  it("treats empty credentials as disabled, not as a conflict", () => {
    env({
      LOCAL_MODE: "1",
      HACKCLUB_CLIENT_ID: "",
      HACKCLUB_CLIENT_SECRET: "",
    });
    expect(localModeEnabled()).toBe(true);
    expect(hackClubConfigured()).toBe(false);
  });

  it("leaves a normal OAuth install alone when local mode is off", () => {
    env({ HACKCLUB_CLIENT_ID: "client-id", HACKCLUB_CLIENT_SECRET: "client-secret" });
    expect(() => config()).not.toThrow();
    expect(localModeEnabled()).toBe(false);
    expect(hackClubConfigured()).toBe(true);
  });
});
