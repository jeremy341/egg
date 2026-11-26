import { describe, expect, it } from "vitest";
import { crashReasonText, exitCodeText, lastCrashSentence } from "./crash-text";

describe("crashReasonText", () => {
  it("explains each systemd reason in words", () => {
    expect(crashReasonText("exit-code")).toBe("exited with an error");
    expect(crashReasonText("oom-kill")).toBe("was killed for using too much memory");
    expect(crashReasonText("signal")).toBe("was stopped by a signal");
    expect(crashReasonText("start-limit-hit")).toBe("failed to start too many times in a row");
  });

  it("shows an unknown reason as it is", () => {
    expect(crashReasonText("weird-thing")).toBe("stopped (weird-thing)");
  });
});

describe("exitCodeText", () => {
  it("names exit 137 as out of memory", () => {
    expect(exitCodeText(137)).toBe("exit status 137 (killed, usually out of memory)");
  });

  it("gives other codes plainly and nothing for null", () => {
    expect(exitCodeText(1)).toBe("exit status 1");
    expect(exitCodeText(null)).toBeNull();
  });
});

describe("lastCrashSentence", () => {
  it("joins the code, the reason and the time", () => {
    const at = Date.UTC(2026, 10, 5, 10, 0, 0);
    const text = lastCrashSentence({ at, exitCode: 137, reason: "oom-kill" }, "en-GB");
    expect(text.startsWith("The service exit status 137 (killed, usually out of memory), was killed for using too much memory. Recorded ")).toBe(true);
  });

  it("leaves the code out when systemd had none", () => {
    const text = lastCrashSentence({ at: 0, exitCode: null, reason: "timeout" }, "en-GB");
    expect(text.startsWith("The service did not start or stop in time. Recorded ")).toBe(true);
  });
});
