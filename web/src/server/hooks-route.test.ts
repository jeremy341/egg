import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/hooks/deploy/[token]/route";

const call = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest("http://localhost/api/hooks/deploy/ndh_x", { method: "POST", body, headers }),
    { params: Promise.resolve({ token: "ndh_x" }) }
  );

describe("deploy hook route", () => {
  it("refuses a large body before looking up the token", async () => {
    const res = await call("x".repeat(100), { "content-length": String(10 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });

  it("refuses a chunked body that grows past the limit", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode("a".repeat(3000)));
        c.enqueue(enc.encode("b".repeat(3000)));
        c.close();
      },
    });
    const res = await POST(
      new NextRequest(new Request("http://localhost/api/hooks/deploy/ndh_x", { method: "POST", body, duplex: "half" } as RequestInit)),
      { params: Promise.resolve({ token: "ndh_x" }) }
    );
    expect(res.status).toBe(413);
  });
});
