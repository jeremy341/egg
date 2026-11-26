import { describe, expect, it } from "vitest";
import { CONNECTION_SUMMARY, describeConnectionError, domainCause } from "@/lib/connection-error";

describe("describeConnectionError", () => {
  it.each([
    "Timed out connecting to Nest. Your container may be stopped or starting; try again in a minute.",
    "Could not reach the Nest SSH host (connect ECONNREFUSED 1.2.3.4:22).",
    "Nest rejected the key. Check that you pasted the public key.",
    "The host key of nest.example changed (was SHA256:a, now SHA256:b). Nothing was sent.",
    "Could not read the service from your container.",
    "Could not read the container",
    "SSH error: Connection lost before banner",
  ])("treats %j as a connection problem and keeps the raw text as detail", (raw) => {
    const out = describeConnectionError(raw);
    expect(out.connection).toBe(true);
    expect(out.summary).toBe("We can't reach your container right now");
    expect(out.summary).toBe(CONNECTION_SUMMARY);
    expect(out.detail).toBe(raw);
  });

  it("leaves other errors untouched", () => {
    const out = describeConnectionError("No such project");
    expect(out).toEqual({ connection: false, summary: "No such project", detail: null });
  });

  it("handles an empty message", () => {
    expect(describeConnectionError("").connection).toBe(false);
  });
});

describe("domainCause", () => {
  it("uses the reason from the last check when there is one", () => {
    const reason = "No CNAME found yet. Create one pointing to nest.hackclub.app.";
    expect(domainCause(reason)).toBe(reason);
  });
  it("says in plain words that DNS is not pointing at the server when there is no reason yet", () => {
    expect(domainCause(null)).toBe("DNS does not point at your server yet. Press Check to see what it points at.");
    expect(domainCause("  ")).toBe(domainCause(null));
  });
});
