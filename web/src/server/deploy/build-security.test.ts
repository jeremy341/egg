import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BuildError,
  assertCloneUrl,
  assertGitRef,
  assertGitSha,
  buildCliEnv,
  resolveInside,
} from "@/server/deploy/build";

let dir: string;
let repo: string;
let outside: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "egg-build-sec-"));
  repo = path.join(dir, "repo");
  outside = path.join(dir, "outside");
  mkdirSync(path.join(repo, "app", "dist"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(outside, "secret.txt"), "host secret");
  // A repository can contain links that point anywhere on the machine that clones it.
  symlinkSync(outside, path.join(repo, "linked-root"), "junction");
  symlinkSync(outside, path.join(repo, "app", "linked-out"), "junction");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("resolveInside", () => {
  it("accepts a normal folder and the folder itself", () => {
    expect(resolveInside(repo, "app")).toBe(path.join(repo, "app"));
    expect(resolveInside(repo, "")).toBe(path.resolve(repo));
  });

  it("refuses .. escapes", () => {
    expect(() => resolveInside(repo, "../outside")).toThrow(BuildError);
  });

  it("accepts a folder that does not exist yet", () => {
    expect(resolveInside(repo, "app/missing")).toBe(path.join(repo, "app", "missing"));
  });

  it("refuses a link in the repository that leads out of it", () => {
    expect(() => resolveInside(repo, "linked-root")).toThrow(BuildError);
    expect(() => resolveInside(path.join(repo, "app"), "linked-out")).toThrow(BuildError);
    expect(() => resolveInside(repo, "linked-root/sub")).toThrow(BuildError);
  });
});

describe("git arguments", () => {
  it("accepts ordinary branch names and refuses ones git could read as an option", () => {
    expect(assertGitRef("main")).toBe("main");
    expect(assertGitRef("feature/x-1.2")).toBe("feature/x-1.2");
    for (const bad of ["-x", "--upload-pack=touch /tmp/x", "a b", "a:b", "a..b", "a@{1}", "", "x".repeat(300), "a\nb"]) {
      expect(() => assertGitRef(bad), bad).toThrow(BuildError);
    }
  });

  it("accepts a full commit hash and nothing else", () => {
    expect(assertGitSha("a".repeat(40))).toBe("a".repeat(40));
    for (const bad of ["-abc", "--upload-pack=x", "abc", "g".repeat(40), "a".repeat(41), ""]) {
      expect(() => assertGitSha(bad), bad).toThrow(BuildError);
    }
  });

  it("keeps assertCloneUrl strict", () => {
    expect(() => assertCloneUrl("https://github.com/a/b.git")).not.toThrow();
    expect(() => assertCloneUrl("file:///etc")).toThrow(BuildError);
    expect(() => assertCloneUrl("https://evil.example/a/b.git")).toThrow(BuildError);
  });
});

describe("buildCliEnv", () => {
  it("keeps ordinary variables out of argv and in the environment", () => {
    const { env, argv } = buildCliEnv({ API_KEY: "abc123", NODE_ENV: "x" }, { PATH: "/bin" });
    expect(env.API_KEY).toBe("abc123");
    expect(argv).toEqual(["-e", "API_KEY", "-e", "NODE_ENV"]);
  });

  it("never lets a project variable change how the docker command itself runs", () => {
    const dangerous = {
      DOCKER_HOST: "ssh://evil",
      DOCKER_CONFIG: "/tmp/x",
      LD_PRELOAD: "/tmp/evil.so",
      LD_LIBRARY_PATH: "/tmp",
      BASH_ENV: "/tmp/x",
      SSH_AUTH_SOCK: "/tmp/agent",
      HTTPS_PROXY: "http://evil",
      SSL_CERT_FILE: "/tmp/ca",
      GIT_SSH_COMMAND: "evil",
      docker_host: "lowercase",
    };
    const base = { PATH: "/bin" };
    const { env, argv } = buildCliEnv(dangerous, base);
    for (const k of Object.keys(dangerous)) expect(env[k], k).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    // They still reach the build container, as explicit values.
    expect(argv).toContain("DOCKER_HOST=ssh://evil");
    expect(argv).toContain("LD_PRELOAD=/tmp/evil.so");
    expect(argv).toContain("docker_host=lowercase");
  });
});
