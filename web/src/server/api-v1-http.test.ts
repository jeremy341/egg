import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiToken } from "@/server/api-tokens";
import { authenticate, readBodyFields, readCappedText } from "@/server/api-v1-http";
import type { Endpoint } from "@/server/api-v1";
import { upsertUser } from "@/server/auth/session";
import { HttpError } from "@/server/http";
import { RATE_LIMITS, rateLimiter } from "@/server/rate-limit";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let secret: string;

beforeAll(async () => {
  ctx = await useFreshDb();
  const user = await upsertUser({ id: "http-1", name: "Sam", email: null, slackId: null });
  secret = (await createApiToken(user.id, { name: "t", scopes: ["projects:read"] })).secret;
});
afterAll(async () => ctx.cleanup());
beforeEach(() => {
  vi.stubEnv("TRUST_PROXY", "1");
  rateLimiter().clear();
});
afterEach(() => vi.unstubAllEnvs());

const withToken = (token: string, ip?: string) =>
  new Request("http://localhost:3000/api/v1/me", {
    headers: { authorization: `Bearer ${token}`, ...(ip ? { "x-forwarded-for": ip } : {}) },
  });
const failure = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as HttpError | null;

describe("authenticate: guessing tokens", () => {
  it("stops answering an address that keeps sending tokens that are not valid", async () => {
    for (let i = 0; i < RATE_LIMITS.badToken.limit; i++) {
      expect((await failure(authenticate(withToken(`egg_bad${i}`, "203.0.113.7"))))?.status).toBe(401);
    }
    const blocked = await failure(authenticate(withToken("egg_another", "203.0.113.7")));
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers?.["Retry-After"])).toBeGreaterThanOrEqual(1);
  });

  it("does not lock out other addresses, or count good tokens", async () => {
    for (let i = 0; i < RATE_LIMITS.badToken.limit + 5; i++) {
      await failure(authenticate(withToken(`egg_bad${i}`, "203.0.113.7")));
    }
    expect((await authenticate(withToken(secret, "203.0.113.8"))).scopes).toContain("projects:read");
    for (let i = 0; i < RATE_LIMITS.badToken.limit + 5; i++) {
      expect((await authenticate(withToken(secret, "203.0.113.9"))).scopes).toContain("projects:read");
    }
  });

  it("never throttles a request that names no address, since it cannot tell callers apart", async () => {
    for (let i = 0; i < RATE_LIMITS.badToken.limit + 5; i++) {
      expect((await failure(authenticate(withToken(`egg_bad${i}`))))?.status).toBe(401);
    }
  });
});

describe("readCappedText", () => {
  const body = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const x of chunks) c.enqueue(new TextEncoder().encode(x));
        c.close();
      },
    });
  const post = (b: BodyInit) => new Request("http://localhost/x", { method: "POST", body: b, duplex: "half" } as RequestInit);

  it("refuses a streamed body that outgrows the cap without a Content-Length", async () => {
    const err = await failure(readCappedText(post(body(["a".repeat(600), "b".repeat(600)])), 1000));
    expect(err?.status).toBe(413);
  });

  it("stops reading once the cap is passed", async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(512));
        if (pulled > 1000) c.close();
      },
    });
    const err = await failure(readCappedText(post(stream), 1000));
    expect(err?.status).toBe(413);
    expect(pulled).toBeLessThan(20);
  });

  it("returns a body inside the cap, multi-byte text included", async () => {
    expect(await readCappedText(post(body(["{\"a\":", "\"é\"}"])), 1000)).toBe('{"a":"é"}');
    expect((await failure(readCappedText(post("é".repeat(600)), 1000)))?.status).toBe(413);
  });
});

describe("readBodyFields", () => {
  const endpoint = (bodyFields: Record<string, unknown>) =>
    ({ body: bodyFields, maxBodyBytes: 1024 } as unknown as Endpoint);
  const withBody = (b?: string) =>
    new Request("http://localhost/x", { method: "POST", ...(b === undefined ? {} : { body: b }) });

  it("accepts a missing or empty body, on endpoints with and without body fields", async () => {
    const bare = endpoint({});
    expect(await readBodyFields(bare, withBody())).toEqual({});
    expect(await readBodyFields(bare, withBody(""))).toEqual({});
    const withBranch = endpoint({ branch: {} });
    expect(await readBodyFields(withBranch, withBody())).toEqual({});
    expect(await readBodyFields(withBranch, withBody("  "))).toEqual({});
  });

  it("accepts an empty JSON object and the declared fields, and names the allowed ones", async () => {
    const withBranch = endpoint({ branch: {} });
    expect(await readBodyFields(withBranch, withBody("{}"))).toEqual({});
    expect(await readBodyFields(withBranch, withBody('{"branch":"dev"}'))).toEqual({ branch: "dev" });
    const unknown = await failure(readBodyFields(withBranch, withBody('{"branch":"dev","sha":"x"}')));
    expect(unknown?.status).toBe(400);
    expect(unknown?.message).toBe('Unknown field "sha". Allowed: branch.');
  });

  it("refuses any field on an endpoint that takes no body fields, in the same style", async () => {
    const bare = endpoint({});
    const unknown = await failure(readBodyFields(bare, withBody('{"branch":"dev"}')));
    expect(unknown?.status).toBe(400);
    expect(unknown?.code).toBe("validation");
    expect(unknown?.message).toBe('Unknown field "branch". This endpoint takes no body fields.');
    expect(await readBodyFields(bare, withBody("{}"))).toEqual({});
  });

  it("answers bad_json for a body that is not a JSON object, on a body-less endpoint too", async () => {
    const bare = endpoint({});
    const notJson = await failure(readBodyFields(bare, withBody("hello")));
    expect(notJson?.status).toBe(400);
    expect(notJson?.message).toBe("Request body must be JSON");
    const array = await failure(readBodyFields(bare, withBody("[1]")));
    expect(array?.status).toBe(400);
    expect(array?.message).toBe("Request body must be a JSON object");
  });
});
