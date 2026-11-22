import { describe, expect, it } from "vitest";
import { InFlightLimit, JSON_BODY_LIMIT, KeyedInFlight, readBytesLimited, readJsonLimited, readTextLimited, webhookBodyReads } from "@/server/body-limit";
import { HttpError } from "@/server/http";

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", body, headers, duplex: "half" } as RequestInit);

function stream(chunks: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });
}

describe("readTextLimited", () => {
  it("returns a small body, and an empty one", async () => {
    expect(await readTextLimited(post("hello"), 100)).toBe("hello");
    expect(await readTextLimited(new Request("http://localhost/x", { method: "POST" }), 100)).toBe("");
  });

  it("refuses a body that declares too much, without reading it", async () => {
    const err: unknown = await readTextLimited(post("x", { "content-length": "5000" }), 100).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(413);
  });

  it("stops a chunked body that grows past the limit and never declared a size", async () => {
    const err: unknown = await readTextLimited(post(stream(["a".repeat(60), "b".repeat(60)])), 100).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(413);
  });

  it("accepts a body exactly at the limit", async () => {
    expect(await readTextLimited(post(stream(["a".repeat(50), "b".repeat(50)])), 100)).toHaveLength(100);
  });

  it("forwards the idle timeout so a stalled text body is bounded", async () => {
    const stalled = new ReadableStream<Uint8Array>({ start: () => {} });
    const err: unknown = await readTextLimited(post(stalled), 100, { idleTimeoutMs: 20 }).catch((e: unknown) => e);
    expect((err as HttpError).status).toBe(408);
  });
});

describe("readJsonLimited", () => {
  const status = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as HttpError).status;

  it("has a 256 KB default cap", () => {
    expect(JSON_BODY_LIMIT).toBe(256 * 1024);
  });

  it("parses a small JSON body", async () => {
    expect(await readJsonLimited(post('{"a":1}'))).toEqual({ a: 1 });
  });

  it("answers 413 for a body over the default cap, declared or streamed", async () => {
    const big = JSON.stringify({ v: "x".repeat(JSON_BODY_LIMIT) });
    expect(await status(readJsonLimited(post(big)))).toBe(413);
    expect(await status(readJsonLimited(post(stream([big.slice(0, 200_000), big.slice(200_000)]))))).toBe(413);
  });

  it("honours a smaller explicit cap", async () => {
    expect(await status(readJsonLimited(post('{"a":"0123456789"}'), { maxBytes: 8 }))).toBe(413);
  });

  it("answers 400 for text that is not JSON, or the fallback when one is given", async () => {
    expect(await status(readJsonLimited(post("nope")))).toBe(400);
    expect(await readJsonLimited(post("nope"), { fallback: {} })).toEqual({});
    expect(await readJsonLimited(post(""), { fallback: undefined })).toBeUndefined();
  });

  it("still answers 413 when a fallback is given", async () => {
    const big = "x".repeat(JSON_BODY_LIMIT + 1);
    expect(await status(readJsonLimited(post(big), { fallback: {} }))).toBe(413);
  });

  it("forwards idle and deadline timing so connection-holding JSON bodies are bounded", async () => {
    const stalled = () => new ReadableStream<Uint8Array>({ start: () => {} });
    expect(await status(readJsonLimited(post(stalled()), { idleTimeoutMs: 20 }))).toBe(408);
    expect(await status(readJsonLimited(post(stalled()), { deadlineMs: 20 }))).toBe(408);
  });
});

describe("readBytesLimited options", () => {
  it("shows every chunk to onChunk, in order, before it is kept", async () => {
    const seen: string[] = [];
    const bytes = await readBytesLimited(post(stream(["ab", "cd"])), 100, {
      onChunk: (c) => seen.push(Buffer.from(c).toString()),
    });
    expect(seen).toEqual(["ab", "cd"]);
    expect(bytes.toString()).toBe("abcd");
  });

  it("gives up with 408 when a body stalls past the idle timeout", async () => {
    const stalled = new ReadableStream<Uint8Array>({ start: () => {} });
    const err: unknown = await readBytesLimited(post(stalled), 100, { idleTimeoutMs: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(408);
  });

  it("does not time out a body that keeps arriving", async () => {
    const enc = new TextEncoder();
    const slow = new ReadableStream<Uint8Array>({
      async start(c) {
        for (const s of ["a", "b", "c"]) {
          await new Promise((r) => setTimeout(r, 5));
          c.enqueue(enc.encode(s));
        }
        c.close();
      },
    });
    expect((await readBytesLimited(post(slow), 100, { idleTimeoutMs: 200 })).toString()).toBe("abc");
  });

  it("gives up with 408 at the overall deadline, even when bytes keep trickling in", async () => {
    const enc = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;
    // One byte every 10 ms, forever: never idle for long, so only the deadline can stop it.
    const trickle = new ReadableStream<Uint8Array>({
      start(c) {
        timer = setInterval(() => c.enqueue(enc.encode("x")), 10);
      },
      cancel() {
        clearInterval(timer);
      },
    });
    const started = Date.now();
    const err: unknown = await readBytesLimited(post(trickle), 10_000, { idleTimeoutMs: 500, deadlineMs: 80 }).catch(
      (e: unknown) => e
    );
    clearInterval(timer);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(408);
    expect(Date.now() - started).toBeLessThan(450);
  });

  it("leaves a quick body alone when a deadline is set", async () => {
    expect((await readBytesLimited(post(stream(["ab", "cd"])), 100, { deadlineMs: 500 })).toString()).toBe("abcd");
  });
});

describe("InFlightLimit", () => {
  it("hands out at most max slots, and a released slot can be taken again", () => {
    const limit = new InFlightLimit(2);
    const a = limit.acquire();
    const b = limit.acquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(limit.acquire()).toBeNull();
    expect(limit.inFlight).toBe(2);
    a?.();
    expect(limit.inFlight).toBe(1);
    expect(limit.acquire()).not.toBeNull();
  });

  it("counts a slot once, even if its release is called twice", () => {
    const limit = new InFlightLimit(1);
    const release = limit.acquire();
    release?.();
    release?.();
    expect(limit.inFlight).toBe(0);
    expect(limit.acquire()).not.toBeNull();
    expect(limit.acquire()).toBeNull();
  });

  it("is the webhook pool of four", () => {
    expect(webhookBodyReads.max).toBe(4);
  });

  it("reset forgets held slots and invalidates old release handles", () => {
    const limit = new InFlightLimit(1);
    const release = limit.acquire();
    expect(limit.inFlight).toBe(1);
    limit.reset();
    expect(limit.inFlight).toBe(0);
    release?.();
    expect(limit.inFlight).toBe(0);
    expect(limit.acquire()).not.toBeNull();
  });
});

describe("KeyedInFlight", () => {
  it("caps each key on its own and releases only that key's slot", () => {
    const gate = new KeyedInFlight(1);
    const a = gate.acquire("a");
    expect(a).not.toBeNull();
    expect(gate.acquire("a")).toBeNull();
    const b = gate.acquire("b");
    expect(b).not.toBeNull();
    expect(gate.inFlight("a")).toBe(1);
    expect(gate.inFlight("b")).toBe(1);
    a?.();
    expect(gate.inFlight("a")).toBe(0);
    expect(gate.inFlight("b")).toBe(1);
    expect(gate.acquire("a")).not.toBeNull();
    expect(gate.acquire("b")).toBeNull();
  });

  it("reset forgets every key", () => {
    const gate = new KeyedInFlight(1);
    const release = gate.acquire("a");
    gate.reset();
    expect(gate.size).toBe(0);
    release?.();
    expect(gate.acquire("a")).not.toBeNull();
  });
});
