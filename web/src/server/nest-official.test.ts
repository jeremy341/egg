import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OFFICIAL_URL,
  getOfficialStatus,
  parseOfficialStatus,
  readOfficialStatus,
  resetOfficialStatusForTests,
} from "@/server/nest-official";

// The shape of the real page: a JS object literal inside the hydration data.
const PAGE = `<html><head><title>Nest Status</title></head><body><script>
  const data = [{type:"data",data:{pageStatus:{statusSummary:"Partial System Outage",statusClass:"bg-down"},ongoingIncidents:[]}}];
</script></body></html>`;

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } });

afterEach(() => {
  resetOfficialStatusForTests();
  vi.useRealTimers();
});

describe("parseOfficialStatus", () => {
  it("reads the summary and its class from the page", () => {
    expect(parseOfficialStatus(PAGE)).toEqual({ summary: "Partial System Outage", statusClass: "bg-down" });
  });

  it("also reads a JSON-style quoted key", () => {
    const json = `{"statusSummary":"All Systems Operational","statusClass":"bg-up"}`;
    expect(parseOfficialStatus(json)).toEqual({ summary: "All Systems Operational", statusClass: "bg-up" });
  });

  it("keeps the summary when the class is missing, and leaves the class empty", () => {
    expect(parseOfficialStatus(`x{statusSummary:"Degraded"}x`)).toEqual({ summary: "Degraded", statusClass: null });
  });

  it("is unavailable when the markup has no summary", () => {
    expect(parseOfficialStatus("<html><body>Nest Status</body></html>")).toBeNull();
    expect(parseOfficialStatus("")).toBeNull();
  });

  it("is unavailable when the markup changed so the value is not a short plain line", () => {
    expect(parseOfficialStatus(`{statusSummary:""}`)).toBeNull();
    expect(parseOfficialStatus(`{statusSummary:"<b>Operational</b>"}`)).toBeNull();
    expect(parseOfficialStatus(`{statusSummary:"${"x".repeat(200)}"}`)).toBeNull();
    expect(parseOfficialStatus(`{statusSummary:someVariable}`)).toBeNull();
  });

  it("drops a class that is not a plain token", () => {
    expect(parseOfficialStatus(`{statusSummary:"Ok",statusClass:"a<b"}`)).toEqual({ summary: "Ok", statusClass: null });
  });
});

describe("readOfficialStatus", () => {
  const now = new Date("2026-11-09T12:00:00Z");

  it("asks the public page with the status-check user agent and returns the summary", async () => {
    const fake = vi.fn(async () => html(PAGE));
    const out = await readOfficialStatus({ fetch: fake as unknown as typeof fetch, now });
    expect(out).toEqual({ available: true, summary: "Partial System Outage", statusClass: "bg-down", readAt: now.toISOString() });
    const [url, init] = fake.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OFFICIAL_URL);
    expect((init.headers as Record<string, string>)["user-agent"]).toBe("Egg-status-check");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("is unavailable on an error status, a changed page, a timeout or no reply", async () => {
    const unavailable = { available: false, readAt: now.toISOString() };
    expect(await readOfficialStatus({ fetch: (async () => html("nope", 503)) as unknown as typeof fetch, now })).toEqual(unavailable);
    expect(await readOfficialStatus({ fetch: (async () => html("<html>new layout</html>")) as unknown as typeof fetch, now })).toEqual(unavailable);
    expect(await readOfficialStatus({ fetch: (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch, now })).toEqual(unavailable);
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as unknown as typeof fetch;
    expect(await readOfficialStatus({ fetch: hang, now, timeoutMs: 20 })).toEqual(unavailable);
  });
});

describe("getOfficialStatus", () => {
  it("reads the page at most once a minute, however often it is asked", async () => {
    const fake = vi.fn(async () => html(PAGE));
    const f = fake as unknown as typeof fetch;
    const t0 = new Date("2026-11-09T12:00:00Z");
    await Promise.all([getOfficialStatus({ fetch: f, now: t0 }), getOfficialStatus({ fetch: f, now: t0 })]);
    await getOfficialStatus({ fetch: f, now: new Date(t0.getTime() + 59_000) });
    expect(fake).toHaveBeenCalledTimes(1);
    await getOfficialStatus({ fetch: f, now: new Date(t0.getTime() + 60_000) });
    expect(fake).toHaveBeenCalledTimes(2);
  });

  it("does not ask again at once after a failed read", async () => {
    const fake = vi.fn(async () => html("down", 500));
    const f = fake as unknown as typeof fetch;
    const t0 = new Date("2026-11-09T12:00:00Z");
    const first = await getOfficialStatus({ fetch: f, now: t0 });
    const second = await getOfficialStatus({ fetch: f, now: new Date(t0.getTime() + 5_000) });
    expect(first.available).toBe(false);
    expect(second).toBe(first);
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
