import { describe, expect, it } from "vitest";
import { diagnoseCrashLoop } from "./crash-diagnosis";

describe("diagnoseCrashLoop", () => {
  it("finds an import error", () => {
    const d = diagnoseCrashLoop({
      lines: ["starting", "Traceback (most recent call last):", "ModuleNotFoundError: No module named 'flask_cors'"],
      exitCode: 1,
    });
    expect(d?.cause).toBe("import_error");
    expect(d?.title).toBe("Import error");
    expect(d?.evidence).toContain("ModuleNotFoundError");
    expect(d?.suggestion).toMatch(/build stage/);
  });

  it("finds a Node module that cannot be found", () => {
    const d = diagnoseCrashLoop({ lines: ["Error: Cannot find module 'express'"] });
    expect(d?.cause).toBe("import_error");
  });

  it("finds a refused connection to the database", () => {
    const d = diagnoseCrashLoop({
      lines: ["connect ECONNREFUSED 10.0.0.5:5432"],
      exitCode: 1,
    });
    expect(d?.cause).toBe("connection_refused");
    expect(d?.evidence).toContain("ECONNREFUSED");
    expect(d?.suggestion).toMatch(/database/);
  });

  it("finds a Postgres refusal", () => {
    const d = diagnoseCrashLoop({ lines: ["could not connect to server: Connection refused"] });
    expect(d?.cause).toBe("connection_refused");
  });

  it("finds exit 137 as out of memory", () => {
    const d = diagnoseCrashLoop({ lines: ["worker started"], exitCode: 137 });
    expect(d?.cause).toBe("out_of_memory");
    expect(d?.evidence).toBeNull();
  });

  it("finds an oom-kill reason as out of memory too", () => {
    const d = diagnoseCrashLoop({ lines: [], reason: "oom-kill" });
    expect(d?.cause).toBe("out_of_memory");
  });

  it("finds a service that never became ready", () => {
    const d = diagnoseCrashLoop({ lines: ["listening on 3000", "Health check failed after 30s"] });
    expect(d?.cause).toBe("never_ready");
    expect(d?.evidence).toMatch(/Health check failed/);
  });

  it("finds never-ready from the health check state alone", () => {
    const d = diagnoseCrashLoop({ lines: ["listening"], healthFailing: true });
    expect(d?.cause).toBe("never_ready");
    expect(d?.evidence).toBeNull();
  });

  it("prefers the import error when several causes match", () => {
    const d = diagnoseCrashLoop({
      lines: ["ECONNREFUSED 127.0.0.1:6379", "ImportError: cannot import name 'x'"],
      exitCode: 137,
    });
    expect(d?.cause).toBe("import_error");
  });

  it("returns null when nothing matches", () => {
    expect(diagnoseCrashLoop({ lines: ["all good", "request served"], exitCode: 0 })).toBeNull();
    expect(diagnoseCrashLoop({ lines: [] })).toBeNull();
  });
});
