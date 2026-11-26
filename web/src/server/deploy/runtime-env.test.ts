import { describe, expect, it } from "vitest";
import { renderEnvFile } from "./runtime";

describe("renderEnvFile", () => {
  it("writes a filled value, quoted and escaped", () => {
    expect(renderEnvFile({ API_URL: 'say "hi"\\now' })).toBe('API_URL="say \\"hi\\"\\\\now"\n');
  });

  it("omits an empty value so it cannot mask a default the app expects", () => {
    const out = renderEnvFile({ EMPTY: "", FILLED: "x" });
    expect(out).toBe('FILLED="x"\n');
    expect(out).not.toContain("EMPTY");
  });

  it("renders nothing but a newline when every value is empty", () => {
    expect(renderEnvFile({ A: "", B: "" })).toBe("\n");
  });

  it("still rejects an invalid name, even when the value is empty", () => {
    expect(() => renderEnvFile({ "BAD NAME": "" })).toThrow(/Invalid environment variable name/);
  });
});
