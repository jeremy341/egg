import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTests } from "@/server/config";
import { clearTokenCacheForTests } from "@/server/github/app";
import { isRepoFullName, repoVisibility } from "@/server/github/visibility";

beforeAll(() => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.GITHUB_APP_ID = "12345";
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({ type: "pkcs1", format: "pem" }).toString().replace(/\n/g, "\n");
  resetConfigForTests();
});
afterAll(() => {
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  resetConfigForTests();
});
beforeEach(() => clearTokenCacheForTests());

/** A fake GitHub: the token endpoint always works; the repository endpoint answers `repo`. */
function github(repo: () => Response) {
  const calls: string[] = [];
  const fake = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/access_tokens")) {
      return Response.json({ token: "t", expires_at: new Date(Date.now() + 3_600_000).toISOString() }, { status: 201 });
    }
    return repo();
  }) as typeof fetch;
  return { fake, calls };
}

const body = (extra: Record<string, unknown>) => ({ full_name: "sam/site", private: false, visibility: "public", ...extra });

describe("repoVisibility", () => {
  it("is public only when GitHub says the same repository is not private", async () => {
    const { fake, calls } = github(() => Response.json(body({})));
    expect(await repoVisibility(7, "sam/site", fake)).toBe("public");
    expect(calls.at(-1)).toBe("https://api.github.com/repos/sam/site");
  });

  it("accepts a different letter case of the same name", async () => {
    const { fake } = github(() => Response.json(body({ full_name: "Sam/Site" })));
    expect(await repoVisibility(7, "sam/site", fake)).toBe("public");
  });

  it.each([
    ["private", { private: true, visibility: "private" }],
    ["internal", { private: false, visibility: "internal" }],
    ["private flag only", { private: true, visibility: undefined }],
  ])("is private for a %s repository", async (_n, extra) => {
    const { fake } = github(() => Response.json(body(extra)));
    expect(await repoVisibility(7, "sam/site", fake)).toBe("private");
  });

  it.each([
    ["a missing repository", () => new Response("{}", { status: 404 })],
    ["a GitHub error", () => new Response("{}", { status: 500 })],
    ["a renamed repository", () => Response.json(body({ full_name: "sam/other" }))],
    ["an answer with no private flag", () => Response.json({ full_name: "sam/site" })],
    ["an answer that is not JSON", () => new Response("<html>", { status: 200 })],
    ["a network failure", () => { throw new Error("offline"); }],
  ])("is unknown for %s", async (_n, answer) => {
    const { fake } = github(answer as () => Response);
    expect(await repoVisibility(7, "sam/site", fake)).toBe("unknown");
  });

  it("is unknown when the installation cannot get a token", async () => {
    const fake = (async () => new Response("{}", { status: 404 })) as typeof fetch;
    expect(await repoVisibility(7, "sam/site", fake)).toBe("unknown");
  });

  it("never asks GitHub about a name that is not owner/name", async () => {
    const { fake, calls } = github(() => Response.json(body({})));
    for (const bad of ["", "sam", "sam/site/extra", "../../user", "sam/..", "sa m/site", "sam/si?te"]) {
      expect(await repoVisibility(7, bad, fake)).toBe("unknown");
    }
    expect(calls).toEqual([]);
  });
});

describe("isRepoFullName", () => {
  it("accepts GitHub names and nothing else", () => {
    expect(isRepoFullName("sam/site")).toBe(true);
    expect(isRepoFullName("sam-r/my.site_2")).toBe(true);
    expect(isRepoFullName("sam/site#frag")).toBe(false);
    expect(isRepoFullName("-sam/site")).toBe(false);
    expect(isRepoFullName(null)).toBe(false);
  });
});
