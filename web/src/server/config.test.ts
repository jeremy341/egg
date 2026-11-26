import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, isLoopbackHost, localModeEnabled, resetConfigForTests } from "@/server/config";

function env(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) vi.stubEnv(k, undefined as unknown as string);
    else vi.stubEnv(k, v);
  }
  resetConfigForTests();
}

beforeEach(() => env({ LOCAL_MODE: undefined, LOCAL_MODE_ALLOW_REMOTE: undefined, LOCAL_MODE_SECRET: "test-local-mode-secret-test-local-mode-secret" }));
afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigForTests();
});

describe("local mode defaults", () => {
  it("is off when LOCAL_MODE is not set", () => {
    expect(config().LOCAL_MODE).toBe(false);
    expect(localModeEnabled()).toBe(false);
  });

  it("does not allow a remote address unless asked", () => {
    expect(config().LOCAL_MODE_ALLOW_REMOTE).toBe(false);
  });

  it("is off for any value other than 1 or true", () => {
    env({ LOCAL_MODE: "0" });
    expect(config().LOCAL_MODE).toBe(false);
  });

  it("is not turned on by the development switch", () => {
    env({ DEV_LOGIN: "1" });
    expect(localModeEnabled()).toBe(false);
  });

  it("turns on with 1 or true on localhost", () => {
    env({ LOCAL_MODE: "1", APP_URL: "http://localhost:3000" });
    expect(localModeEnabled()).toBe(true);
    env({ LOCAL_MODE: "true", APP_URL: "http://localhost:3000" });
    expect(localModeEnabled()).toBe(true);
  });

  it("normalizes case and whitespace the same way as the rate-limit path", () => {
    env({ LOCAL_MODE: " TRUE ", APP_URL: "http://localhost:3000" });
    expect(config().LOCAL_MODE).toBe(true);
    expect(localModeEnabled()).toBe(true);
    env({ LOCAL_MODE: " 0 " });
    expect(config().LOCAL_MODE).toBe(false);
  });

  it("requires a separate local sign-in secret before enabling local mode", () => {
    env({ LOCAL_MODE: "1", APP_URL: "http://localhost:3000", LOCAL_MODE_SECRET: undefined });
    expect(() => config()).toThrow(/LOCAL_MODE_SECRET/);
  });
});

describe("local mode refusal rules", () => {
  it.each(["http://localhost:3000", "http://127.0.0.1:4000", "http://127.1.2.3", "http://[::1]:3000"])(
    "accepts %s",
    (url) => {
      env({ LOCAL_MODE: "1", APP_URL: url });
      expect(() => config()).not.toThrow();
    }
  );

  it.each(["https://egg.example.com", "http://192.168.1.20:3000", "http://0.0.0.0:3000", "http://localhost.evil.com"])(
    "refuses %s",
    (url) => {
      env({ LOCAL_MODE: "1", APP_URL: url });
      expect(() => config()).toThrow(/LOCAL_MODE_ALLOW_REMOTE/);
    }
  );

  it("allows a remote address with the explicit override", () => {
    env({ LOCAL_MODE: "1", LOCAL_MODE_ALLOW_REMOTE: "1", APP_URL: "https://egg.example.com" });
    expect(localModeEnabled()).toBe(true);
  });

  it("ignores the override when local mode is off", () => {
    env({ LOCAL_MODE_ALLOW_REMOTE: "1", APP_URL: "https://egg.example.com" });
    expect(localModeEnabled()).toBe(false);
  });

  it("does not complain about a remote address when local mode is off", () => {
    env({ APP_URL: "https://egg.example.com" });
    expect(() => config()).not.toThrow();
  });
});

describe("isLoopbackHost", () => {
  it.each(["localhost", "LOCALHOST", "127.0.0.1", "[::1]", "::1"])("is true for %s", (h) => {
    expect(isLoopbackHost(h)).toBe(true);
  });
  it.each([
    "example.com",
    "10.0.0.1",
    "0.0.0.0",
    "localhost.evil.com",
    "127.0.0.1.evil.com",
    "127.999.999.999",
    "127.0.0.01",
    "",
  ])("is false for %s", (h) => {
    expect(isLoopbackHost(h)).toBe(false);
  });
});
