import { describe, expect, it } from "vitest";
import { JSON_BODY_LIMIT, readJsonLimited, readTextLimited } from "@/server/body-limit";
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
});
