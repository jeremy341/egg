import { describe, expect, it } from "vitest";
import { loginErrorMessage } from "@/lib/login-errors";

describe("loginErrorMessage", () => {
  it("explains a rate-limited sign-in", () => {
    expect(loginErrorMessage("rate_limited")).toBe("Too many sign-in attempts. Wait a minute and try again.");
  });

  it("falls back for an unknown code, including ones that are object property names", () => {
    expect(loginErrorMessage("nope")).toBe("Something went wrong signing in.");
    expect(loginErrorMessage("constructor")).toBe("Something went wrong signing in.");
  });
});
