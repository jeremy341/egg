import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverRoutes } from "next/dist/build/route-discovery";
import { GET } from "./route";
import { GET as originalGET } from "../../llms.txt/route";
import { llmsTxt } from "../../docs/_data/markdown";

const appDir = fileURLToPath(new URL("../../", import.meta.url));

describe("GET /.well-known/llms.txt", () => {
  it("re-exports the /llms.txt handler instead of duplicating it", () => {
    expect(GET).toBe(originalGET);
  });

  it("serves the same docs index, with the request's origin, as plain text", async () => {
    const origin = "https://nest.example";
    const res = GET(new Request(`${origin}/.well-known/llms.txt`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await res.text()).toBe(llmsTxt(origin));
  });

  it("is discovered by Next.js as a route at the literal /.well-known/llms.txt path", async () => {
    const { appRouteHandlers } = await discoverRoutes({
      appDir,
      pagesDir: undefined,
      pageExtensions: ["ts", "tsx", "js", "jsx"],
      isDev: false,
      baseDir: path.resolve(appDir, "..", ".."),
      isSrcDir: true,
      appDirOnly: true,
    });
    const routes = appRouteHandlers.map((h) => h.route);
    expect(routes).toContain("/.well-known/llms.txt");
    expect(routes).toContain("/llms.txt");
  });
});
