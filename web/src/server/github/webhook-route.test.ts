import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { webhookBodyReads } from "@/server/body-limit";
import { resetConfigForTests } from "@/server/config";
import { closeDbForTests, getDb } from "@/server/db";
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
    headers: { "x-hub-signature-256": sig, "x-github-event": "ping", "content-length": String(Buffer.byteLength(body)), ...headers },
  });
}

describe("GitHub webhook route", () => {
  it("answers a signed ping", async () => {
    const res = await POST(signed('{"ping":"initial"}', { "x-github-delivery": "d-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: true, note: "pong" });
  });

  it("rejects the same signed body even when the unsigned delivery id changes", async () => {
    const first = await POST(signed('{"n":1}', { "x-github-delivery": "d-2" }));
    expect((await first.json()).note).toBe("pong");
    const again = await POST(signed('{"n":1}', { "x-github-delivery": "attacker-chosen-id" }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ handled: false, note: "duplicate delivery" });
  });

  it("does not let an alternate event label consume a valid signed push", async () => {
    const body = JSON.stringify({
      ref: "refs/heads/main",
      after: "a".repeat(40),
      repository: { full_name: "no-such-project/repo" },
    });
    const mislabeled = await POST(signed(body, { "x-github-event": "ping", "x-github-delivery": "wrong-label" }));
    expect(await mislabeled.json()).toMatchObject({ handled: false, note: "unsupported event or payload" });

    const intended = await POST(signed(body, { "x-github-event": "push", "x-github-delivery": "valid-push" }));
    expect(intended.status).toBe(200);
    expect(await intended.json()).toMatchObject({ handled: true, deployments: [] });
  });

  it("does not accept a pull request payload as an installation deletion", async () => {
    const body = JSON.stringify({
      action: "opened",
      installation: { id: 7 },
      repository: { full_name: "no-such-project/repo" },
      pull_request: {
        number: 1,
        head: { ref: "feature", sha: "b".repeat(40), repo: { full_name: "no-such-project/repo" } },
      },
    });
    const mislabeled = await POST(signed(body, { "x-github-event": "installation" }));
    expect(await mislabeled.json()).toMatchObject({ handled: false, note: "unsupported event or payload" });

    const intended = await POST(signed(body, { "x-github-event": "pull_request" }));
    expect(intended.status).toBe(200);
    expect(await intended.json()).toMatchObject({ handled: true, deployments: [] });
  });

  it("remembers an authenticated body across a database connection restart", async () => {
    const body = '{"ping":"survives-restart"}';
    expect((await POST(signed(body, { "x-github-delivery": "d-before-restart" }))).status).toBe(200);
    await closeDbForTests();
    await getDb();
    const again = await POST(signed(body, { "x-github-delivery": "d-after-restart" }));
    expect(await again.json()).toMatchObject({ handled: false, note: "duplicate delivery" });
  });

  it("lets a failed delivery be retried under the same id", async () => {
    const bad = await POST(signed("{not json", { "x-github-delivery": "d-3" }));
    expect(bad.status).toBe(400);
    const retry = await POST(signed("{}", { "x-github-delivery": "d-3" }));
    expect(retry.status).toBe(200);
    expect((await retry.json()).note).toBe("pong");
  });

  it("refuses a missing or malformed signature without reading the body", async () => {
    const headersFor = (sig?: string) => ({
      "content-length": "2",
      "x-github-event": "ping",
      "x-github-delivery": "d-4",
      ...(sig === undefined ? {} : { "x-hub-signature-256": sig }),
    });
    const sinks: Sink[] = [];
    for (const sig of [undefined, "", "sha256=", "sha256=" + "0".repeat(63), "sha1=" + "0".repeat(64), "sha256=" + "G".repeat(64)]) {
      // The body never finishes, so a route that read it first would not answer.
      const res = await within(POST(stalled(headersFor(sig), sinks)));
      expect(res, String(sig)).not.toBe(STALLED);
      expect((res as Response).status, String(sig)).toBe(401);
    }
  });

  it("refuses a body with no Content-Length, or one declared over the cap, without reading it", async () => {
    const sinks: Sink[] = [];
    const noLength = await within(POST(stalled({ "x-hub-signature-256": "sha256=" + "0".repeat(64), "x-github-event": "ping" }, sinks)));
    expect(noLength).not.toBe(STALLED);
    expect((noLength as Response).status).toBe(411);
    const tooBig = await within(POST(stalled({ "content-length": String(6 * 1024 * 1024), "x-hub-signature-256": "sha256=" + "0".repeat(64), "x-github-event": "ping" }, sinks)));
    expect(tooBig).not.toBe(STALLED);
    expect((tooBig as Response).status).toBe(413);
  });

  it("accepts a valid signature when the body arrives in pieces", async () => {
    const body = '{"ping":"in-pieces"}';
    const sinks: Sink[] = [];
    const pending = POST(stalled(signedHeaders(body, { "x-github-delivery": "d-pieces" }), sinks));
    const [sink] = sinks;
    sink.enqueue(enc.encode(body.slice(0, 8)));
    sink.enqueue(enc.encode(body.slice(8)));
    sink.close();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ handled: true, note: "pong" });
  });

  it("answers 401 for a well-formed but wrong signature, once the body has arrived", async () => {
    const sinks: Sink[] = [];
    const pending = POST(stalled({ ...signedHeaders('{"ping":"x"}', {}), "x-hub-signature-256": "sha256=" + "1".repeat(64) }, sinks));
    sinks[0].enqueue(enc.encode('{"ping":"x"}'));
    sinks[0].close();
    expect((await pending).status).toBe(401);
  });

  it("answers 503 with Retry-After when four bodies are already being read, and frees the slots afterwards", async () => {
    const body = '{"ping":"busy"}';
    const sinks: Sink[] = [];
    const reads = [1, 2, 3, 4].map(() => POST(stalled(signedHeaders(body, {}), sinks)));
    expect(webhookBodyReads.inFlight).toBe(4);

    const busy = await POST(stalled(signedHeaders(body, {}), []));
    expect(busy.status).toBe(503);
    expect(busy.headers.get("Retry-After")).toBe("5");

    // Wrong bodies fail after they arrive. Each failure must return its slot.
    for (const sink of sinks) {
      sink.enqueue(enc.encode('{"ping":"tampered"}'));
      sink.close();
    }
    for (const res of await Promise.all(reads)) expect(res.status).toBe(401);
    expect(webhookBodyReads.inFlight).toBe(0);

    const ok = await POST(signed('{"ping":"after-busy"}', { "x-github-delivery": "d-after-busy" }));
    expect(ok.status).toBe(200);
  });
});

// Requests whose body is still arriving: the stream is closed by the test, not by the request.
type Sink = ReadableStreamDefaultController<Uint8Array>;
const enc = new TextEncoder();
const STALLED = Symbol("stalled");

function stalled(headers: Record<string, string>, sinks: Sink[]) {
  const body = new ReadableStream<Uint8Array>({ start: (c) => void sinks.push(c) });
  return new NextRequest("http://localhost/api/webhooks/github", { method: "POST", body, duplex: "half", headers } as ConstructorParameters<typeof NextRequest>[1]);
}

function signedHeaders(body: string, extra: Record<string, string>): Record<string, string> {
  return {
    "x-hub-signature-256": "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex"),
    "x-github-event": "ping",
    "content-length": String(Buffer.byteLength(body)),
    ...extra,
  };
}

/** Resolve to the value, or to STALLED after 2 seconds, so a hung request fails fast. */
function within<T>(p: Promise<T>): Promise<T | typeof STALLED> {
  return Promise.race([p, new Promise<typeof STALLED>((r) => setTimeout(() => r(STALLED), 2000))]);
}

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
