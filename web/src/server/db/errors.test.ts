import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "@/server/db/errors";

describe("isUniqueViolation", () => {
  it("matches a SQLite unique failure and a wrapped one", () => {
    expect(isUniqueViolation(new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: a.b"))).toBe(true);
    expect(isUniqueViolation(new Error("Failed query", { cause: Object.assign(new Error("x"), { code: "SQLITE_CONSTRAINT_UNIQUE" }) }))).toBe(true);
  });
  it("ignores other errors", () => {
    expect(isUniqueViolation(new Error("NOT NULL constraint failed"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
