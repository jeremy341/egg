import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The proxy does not run for the four routes the matcher skips (src/proxy.ts, src/ingress-limits.test.ts), so each
 * of them must call the per-address gate itself. These checks read the route sources, the same way the ingress
 * limits test does, so a route that loses its call fails here.
 */
const root = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("routes the proxy skips call the per-address gate themselves", () => {
  it.each([
    ["src/app/api/webhooks/github/route.ts", 'bucket: "webhook"'],
    ["src/app/api/builds/upload/route.ts", 'enforceIngress(req.headers, "all")'],
    ["src/app/api/security-reports/route.ts", 'enforceIngress(req.headers, "all")'],
    ["src/app/api/projects/[id]/files/write/route.ts", 'enforceIngress(req.headers, "all")'],
  ])("%s", (file, call) => {
    expect(read(file)).toContain(call);
  });

  it("the security report intake keeps its own limits as well", () => {
    expect(read("src/app/api/security-reports/route.ts")).toContain("security-reports:global");
  });

  it("the webhook gate comes after its signature refusal, before the body is read", () => {
    const src = read("src/app/api/webhooks/github/route.ts");
    const gate = src.indexOf('bucket: "webhook"');
    expect(gate).toBeGreaterThan(src.indexOf("SIGNATURE_FORMAT.test(signature)"));
    expect(gate).toBeLessThan(src.indexOf("webhookBodyReads.acquire()"));
  });
});
