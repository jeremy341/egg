import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetConfigForTests } from "@/server/config";
import { POST } from "@/app/api/webhooks/github/route";
import { handleGithubEvent, isSafeBranch, isSafeSha } from "@/server/github/webhook";
import { useFreshDb } from "@/server/test/db";

const SECRET = "hook-secret";
let ctx: Awaited<ReturnType<typeof useFreshDb>>;

beforeAll(async () => {
  process.env.GITHUB_WEBHOOK_SECRET = SECRET;
  resetConfigForTests();
  ctx = await useFreshDb();
});
afterAll(async () => {
  delete process.env.GITHUB_WEBHOOK_SECRET;
  resetConfigForTests();
  await ctx.cleanup();
});

function signed(body: string, headers: Record<string, string> = {}) {
  const sig = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
  return new NextRequest("http://localhost/api/webhooks/github", {
    method: "POST",
    body,
    headers: { "x-hub-signature-256": sig, "x-github-event": "ping", ...headers },
  });
}

describe("GitHub webhook route", () => {
  it("answers a signed ping", async () => {
    const res = await POST(signed("{}", { "x-github-delivery": "d-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: true, note: "pong" });
  });

  it("does not run the same delivery twice", async () => {
    const first = await POST(signed('{"n":1}', { "x-github-delivery": "d-2" }));
    expect((await first.json()).note).toBe("pong");
    const again = await POST(signed('{"n":1}', { "x-github-delivery": "d-2" }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ handled: false, note: "duplicate delivery" });
  });

  it("lets a failed delivery be retried under the same id", async () => {
    const bad = await POST(signed("{not json", { "x-github-delivery": "d-3" }));
    expect(bad.status).toBe(400);
    const retry = await POST(signed("{}", { "x-github-delivery": "d-3" }));
    expect(retry.status).toBe(200);
    expect((await retry.json()).note).toBe("pong");
  });

  it("rejects a bad signature before looking at the payload", async () => {
    const req = new NextRequest("http://localhost/api/webhooks/github", {
      method: "POST",
      body: "{}",
      headers: { "x-hub-signature-256": "sha256=" + "0".repeat(64), "x-github-event": "ping", "x-github-delivery": "d-4" },
    });
    expect((await POST(req)).status).toBe(401);
  });

  it("refuses an oversized body before reading it", async () => {
    const req = new NextRequest("http://localhost/api/webhooks/github", {
      method: "POST",
      body: "{}",
      headers: { "content-length": String(30 * 1024 * 1024), "x-hub-signature-256": "sha256=00", "x-github-event": "ping" },
    });
    expect((await POST(req)).status).toBe(413);
  });
});

describe("refs and hashes from a push", () => {
  it("accepts ordinary branch names and full hashes", () => {
    expect(isSafeBranch("main")).toBe(true);
    expect(isSafeBranch("feature/login-2.0")).toBe(true);
    expect(isSafeSha("a".repeat(40))).toBe(true);
  });

  it("refuses names git could read as an option or revision", () => {
    for (const b of ["-x", "--upload-pack=touch /tmp/x", "a b", "a..b", "a:b", "x\ny", "", "a".repeat(300)]) {
      expect(isSafeBranch(b), b).toBe(false);
    }
    for (const s of ["--output=x", "abc", "z".repeat(40)]) expect(isSafeSha(s), s).toBe(false);
  });

  it("does not queue a push for an unsafe branch", async () => {
    const r = await handleGithubEvent("push", {
      ref: "refs/heads/--upload-pack=touch /tmp/x",
      after: "b".repeat(40),
      repository: { full_name: "sam/demo" },
    });
    expect(r).toMatchObject({ handled: false, deployments: [] });
  });
});
