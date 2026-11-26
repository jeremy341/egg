import { describe, expect, it } from "vitest";
import { readTextLimited } from "@/server/body-limit";
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
