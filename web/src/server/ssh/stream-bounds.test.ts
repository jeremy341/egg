import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { NestSession } from "./connection";

describe("bounded SSH streaming", () => {
  it("decodes split UTF-8 and discards an oversized line without exposing fragments", async () => {
    const session = Object.create(NestSession.prototype) as NestSession;
    const stream = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), end() {} });
    (session as unknown as { client: unknown }).client = { exec: (_: string, cb: (e: null, s: typeof stream) => void) => cb(null, stream) };
    const lines: string[] = [];
    const result = session.exec("test", { outputTailBytes: 16, onLine: l => lines.push(l) });
    const euro = Buffer.from("€\n");
    stream.emit("data", euro.subarray(0, 1));
    stream.emit("data", euro.subarray(1));
    stream.emit("data", Buffer.from("x".repeat(100_000) + "secret\nend\n"));
    stream.emit("close", 0);
    const output = await result;
    expect(lines[0]).toBe("€");
    expect(lines).not.toContain(expect.stringContaining("secret"));
    expect(lines.at(-1)).toBe("end");
    expect(Buffer.byteLength(output.stdout)).toBeLessThanOrEqual(16);
  });
});
