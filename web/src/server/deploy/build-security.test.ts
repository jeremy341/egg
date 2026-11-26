import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BuildError,
  assertCloneUrl,
  assertGitRef,
  assertGitSha,
  gitEnvironment,
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

describe("gitEnvironment", () => {
  it("configures GitHub auth through environment instead of process arguments", () => {
    const token = "ghs-private-token";
    const env = gitEnvironment(token);
    expect(env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(env.GIT_CONFIG_VALUE_0).toBe(
      `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`
    );
    expect(env.GIT_CONFIG_COUNT).toBe("1");
  });
});
