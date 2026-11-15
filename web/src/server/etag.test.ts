import { describe, expect, it } from "vitest";
import { etagFor, etagMatches, jsonWithEtag } from "@/server/etag";

describe("etag", () => {
  it("is stable for the same text and changes with it", () => {
    expect(etagFor('{"a":1}')).toBe(etagFor('{"a":1}'));
    expect(etagFor('{"a":1}')).not.toBe(etagFor('{"a":2}'));
    expect(etagFor("x")).toMatch(/^"[A-Za-z0-9_-]{27}"$/);
  });

  it("matches a single tag, a list, a weak tag and a star", () => {
    const tag = etagFor("body");
    expect(etagMatches(tag, tag)).toBe(true);
    expect(etagMatches(`"other", ${tag}`, tag)).toBe(true);
    expect(etagMatches(`W/${tag}`, tag)).toBe(true);
    expect(etagMatches("*", tag)).toBe(true);
    expect(etagMatches('"other"', tag)).toBe(false);
    expect(etagMatches(null, tag)).toBe(false);
    expect(etagMatches("", tag)).toBe(false);
  });

  it("answers 200 with the body and an ETag, then 304 when the tag matches", async () => {
    const url = "http://localhost/api/stats";
    const first = jsonWithEtag(new Request(url), { n: 1 }, "public, max-age=300");
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("application/json");
    expect(first.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await first.json()).toEqual({ n: 1 });
    const tag = first.headers.get("etag")!;

    const again = jsonWithEtag(
      new Request(url, { headers: { "If-None-Match": tag } }),
      { n: 1 },
      "public, max-age=300"
    );
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(tag);
    expect(await again.text()).toBe("");

    const changed = jsonWithEtag(
      new Request(url, { headers: { "If-None-Match": tag } }),
      { n: 2 },
      "public, max-age=300"
    );
    expect(changed.status).toBe(200);
  });
});
