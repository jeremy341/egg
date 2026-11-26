import { gzipSync } from "node:zlib";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildScript } from "@/server/analytics-script";

type Handler = (e: Record<string, unknown>) => void;

/** Run the snippet against a fake browser and report what it sent and which listeners are left. */
function browser(
  script: string,
  opts: {
    dnt?: string;
    gpc?: boolean;
    host?: string;
    sendBeacon?: boolean;
    hidden?: boolean;
    referrer?: string;
    search?: string;
    store?: Record<string, string>;
    storeBlocked?: boolean;
  } = {}
) {
  const bodies: string[] = [];
  const pending: Promise<unknown>[] = [];
  const listeners: { target: string; type: string; fn: Handler; capture: boolean }[] = [];
  const clock = { now: 1_000_000 };
  const target = (name: string) => ({
    addEventListener(type: string, fn: Handler, capture?: unknown) {
      listeners.push({ target: name, type, fn, capture: capture === true });
    },
    removeEventListener(type: string, fn: Handler, capture?: unknown) {
      const i = listeners.findIndex(
        (l) => l.target === name && l.type === type && l.fn === fn && l.capture === (capture === true)
      );
      if (i >= 0) listeners.splice(i, 1);
    },
  });
  const doc: Record<string, unknown> = {
    ...target("document"),
    currentScript: {
      getAttribute: (n: string) => (n === "data-key" ? "nda_k" : null),
      src: "https://nest.example/api/analytics/script?key=nda_k",
    },
    referrer: opts.referrer ?? "",
    hidden: opts.hidden ?? false,
    visibilityState: opts.hidden ? "hidden" : "visible",
  };
  const win: Record<string, unknown> = { ...target("window"), doNotTrack: undefined };
  const location = { hostname: opts.host ?? "app.example", pathname: "/", search: opts.search ?? "" };
  const history = {
    pushState(path?: string) {
      if (path) location.pathname = path;
    },
  };
  const nav: Record<string, unknown> = { doNotTrack: opts.dnt ?? null, globalPrivacyControl: opts.gpc };
  if (opts.sendBeacon !== false) {
    nav.sendBeacon = (_url: string, blob: Blob) => {
      pending.push(blob.text().then((t) => bodies.push(t)));
      return true;
    };
  }
  const store: Record<string, string> = opts.store ?? {};
  const localStorage = {
    getItem: (k: string) => {
      if (opts.storeBlocked) throw new Error("blocked");
      return k in store ? store[k] : null;
    },
    setItem: (k: string, v: string) => {
      if (opts.storeBlocked) throw new Error("blocked");
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
  // Observers the script makes, so a test can feed them entries.
  const observers: { type: string; opts: Record<string, unknown>; fn: (l: { getEntries: () => unknown[] }) => void; live: boolean }[] = [];
  class FakeObserver {
    fn: (l: { getEntries: () => unknown[] }) => void;
    mine: (typeof observers)[number] | null = null;
    constructor(fn: (l: { getEntries: () => unknown[] }) => void) {
      this.fn = fn;
    }
    observe(o: Record<string, unknown>) {
      this.mine = { type: String(o.type), opts: o, fn: this.fn, live: true };
      observers.push(this.mine);
    }
    disconnect() {
      if (this.mine) this.mine.live = false;
    }
  }
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const ctx = vm.createContext({
    localStorage,
    crypto: { getRandomValues: (a: Uint8Array) => a.fill(171) },
    URLSearchParams,
    PerformanceObserver: FakeObserver,
    performance: { getEntriesByType: () => [{ responseStart: 123.4 }] },
    setInterval: (fn: () => void, ms: number) => timers.push({ fn, ms, live: true }),
    clearInterval: (n: number) => {
      if (timers[n - 1]) timers[n - 1].live = false;
    },
    document: doc,
    window: win,
    navigator: nav,
    history,
    location,
    URL,
    Blob,
    Date: { now: () => clock.now },
    fetch: () => Promise.resolve(),
    encodeURIComponent,
    JSON,
    // The snippet refers to the global scope too (addEventListener on window).
    addEventListener: win.addEventListener,
    removeEventListener: win.removeEventListener,
  });
  vm.runInContext(script, ctx);
  return {
    listeners,
    history,
    doc,
    store,
    observers,
    timers,
    feed: (type: string, entries: unknown[]) => {
      for (const o of observers) if (o.live && o.type === type) o.fn({ getEntries: () => entries });
    },
    sent: async () => {
      await Promise.all(pending);
      return bodies.map((b) => JSON.parse(b) as Record<string, unknown>);
    },
    fire: (t: string, type: string, e: Record<string, unknown> = {}) => {
      for (const l of [...listeners]) if (l.target === t && l.type === type) l.fn(e);
    },
    tick: (ms: number) => {
      clock.now += ms;
    },
  };
}

const clickOn = (text: string, attrs: Record<string, string> = {}) => {
  const el = { getAttribute: (n: string) => attrs[n] ?? null, textContent: text };
  return { target: { closest: () => el } };
};

describe("the analytics script", () => {
  it("with every switch off is the plain page view script: no click or time listeners", async () => {
    const b = browser(buildScript({ clicks: false, time: false, goals: [] }));
    expect(b.listeners.map((l) => `${l.target}:${l.type}`).sort()).toEqual(["window:pagehide", "window:popstate"]);
    expect(await b.sent()).toEqual([{ p: "/" }]);
  });

  it("stays small when everything is off", () => {
    expect(buildScript({ clicks: false, time: false, goals: [] }).length).toBeLessThan(1800);
  });

  it.each([
    ["Do Not Track", { dnt: "1" }],
    ["Global Privacy Control", { gpc: true }],
  ])("sends nothing and listens to nothing when %s is set", async (_n, opts) => {
    const b = browser(buildScript({ clicks: true, time: true, goals: ["signup"] }), opts);
    expect(await b.sent()).toEqual([]);
    expect(b.listeners).toHaveLength(0);
  });

  it("sends nothing on localhost", async () => {
    const b = browser(buildScript({ clicks: true, time: false, goals: [] }), { host: "localhost" });
    expect(await b.sent()).toEqual([]);
    expect(b.listeners).toHaveLength(0);
  });

  describe("clicks", () => {
    const script = buildScript({ clicks: true, time: false, goals: [] });

    it("uses one delegated capture listener on the document", () => {
      const b = browser(script);
      expect(b.listeners.filter((l) => l.type === "click")).toEqual([
        expect.objectContaining({ target: "document", capture: true }),
      ]);
    });

    it("labels a click with the element text, collapsed and cut to 40 characters", async () => {
      const b = browser(script);
      b.fire("document", "click", clickOn("  Start   your\n free trial of the very best product ever made  "));
      const clicks = (await b.sent()).filter((m) => m.e === "click");
      expect(clicks).toEqual([{ e: "click", l: "Start your free trial of the very best p" }]);
      expect((clicks[0].l as string).length).toBeLessThanOrEqual(40);
    });

    it("prefers a data-egg-track name, then aria-label, then text", async () => {
      const b = browser(script);
      b.fire("document", "click", clickOn("Buy", { "data-egg-track": "buy-button", "aria-label": "Buy now" }));
      b.fire("document", "click", clickOn("X", { "aria-label": "Close dialog" }));
      const labels = (await b.sent()).filter((m) => m.e === "click").map((m) => m.l);
      expect(labels).toEqual(["buy-button", "Close dialog"]);
    });

    it("ignores clicks that are not on a link, button or tracked element, and clicks with no label", async () => {
      const b = browser(script);
      b.fire("document", "click", { target: { closest: () => null } });
      b.fire("document", "click", clickOn("   "));
      expect((await b.sent()).filter((m) => m.e === "click")).toEqual([]);
    });

    it("removes every listener when the page is left for good", () => {
      const b = browser(script);
      b.fire("window", "pagehide", { persisted: false });
      expect(b.listeners).toHaveLength(0);
    });

    it("keeps listening when the page may come back from the back-forward cache", () => {
      const b = browser(script);
      b.fire("window", "pagehide", { persisted: true });
      expect(b.listeners.some((l) => l.type === "click")).toBe(true);
    });
  });
  describe("time on page", () => {
    const script = buildScript({ clicks: false, time: true, goals: [] });
    const times = async (b: ReturnType<typeof browser>) => (await b.sent()).filter((m) => m.e === "time").map((m) => m.b);

    it.each([
      [3_000, "lt10"],
      [9_999, "lt10"],
      [10_000, "10-60"],
      [59_999, "10-60"],
      [60_000, "60-300"],
      [299_999, "60-300"],
      [300_000, "gt300"],
      [3_600_000, "gt300"],
    ])("sends %i ms on pagehide as the bucket %s, with a beacon", async (ms, bucket) => {
      const b = browser(script);
      b.tick(ms);
      b.fire("window", "pagehide", { persisted: false });
      expect(await times(b)).toEqual([bucket]);
    });

    it("sends only the bucket, never the number of seconds", async () => {
      const b = browser(script);
      b.tick(42_000);
      b.fire("window", "pagehide", { persisted: false });
      expect((await b.sent()).filter((m) => m.e === "time")).toEqual([{ e: "time", b: "10-60" }]);
    });

    it("does not count the time a tab spends hidden", async () => {
      const b = browser(script);
      b.tick(5_000);
      b.doc.hidden = true;
      b.fire("document", "visibilitychange");
      b.tick(600_000);
      b.doc.hidden = false;
      b.fire("document", "visibilitychange");
      b.tick(2_000);
      b.fire("window", "pagehide", { persisted: false });
      expect(await times(b)).toEqual(["lt10"]);
    });

    it("sends nothing for a page that was never visible", async () => {
      const b = browser(script, { hidden: true });
      b.tick(600_000);
      b.fire("window", "pagehide", { persisted: false });
      expect(await times(b)).toEqual([]);
    });

    it("sends once however many times the page is hidden and left", async () => {
      const b = browser(script);
      b.tick(20_000);
      b.doc.hidden = true;
      b.fire("document", "visibilitychange");
      b.fire("window", "pagehide", { persisted: true });
      b.fire("window", "pagehide", { persisted: true });
      expect(await times(b)).toEqual(["10-60"]);
    });

    it("starts the clock again when a page comes back from the back-forward cache", async () => {
      const b = browser(script);
      b.tick(20_000);
      b.doc.hidden = true;
      b.fire("document", "visibilitychange");
      b.fire("window", "pagehide", { persisted: true });
      b.tick(900_000);
      b.doc.hidden = false;
      b.fire("window", "pageshow", { persisted: true });
      b.fire("document", "visibilitychange");
      b.tick(3_000);
      b.fire("window", "pagehide", { persisted: false });
      expect(await times(b)).toEqual(["10-60", "lt10"]);
    });

    it("reports the time on the page that was left when the address changes", async () => {
      const b = browser(script);
      b.tick(70_000);
      b.history.pushState("/next");
      expect(await times(b)).toEqual(["60-300"]);
      b.tick(2_000);
      b.fire("window", "pagehide", { persisted: false });
      expect(await times(b)).toEqual(["60-300", "lt10"]);
    });

    it("sets no timer, so a hidden tab keeps nothing running", () => {
      expect(script).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    });

    it("removes the visibility and pageshow listeners with the rest", () => {
      const b = browser(script);
      b.fire("window", "pagehide", { persisted: false });
      expect(b.listeners).toHaveLength(0);
    });

    it("adds no time code when the switch is off", () => {
      expect(buildScript({ clicks: true, time: false, goals: [] })).not.toContain("visibilitychange");
    });
  });
  describe("funnel goals", () => {
    const script = buildScript({ clicks: false, time: false, goals: ["signup", 'we"ird</script>'] });

    it("sends a goal for a click on an element whose data-egg-track name is a funnel step, and nothing else", async () => {
      const b = browser(script);
      b.fire("document", "click", clickOn("Join", { "data-egg-track": "signup" }));
      b.fire("document", "click", clickOn("Other", { "data-egg-track": "newsletter" }));
      b.fire("document", "click", clickOn("Plain link"));
      expect((await b.sent()).filter((m) => m.e)).toEqual([{ e: "goal", n: "signup" }]);
    });

    it("sends the click too when both are on", async () => {
      const b = browser(buildScript({ clicks: true, time: false, goals: ["signup"] }));
      b.fire("document", "click", clickOn("Join", { "data-egg-track": "signup" }));
      expect((await b.sent()).filter((m) => m.e)).toEqual([
        { e: "click", l: "signup" },
        { e: "goal", n: "signup" },
      ]);
    });

    it("keeps a step name from breaking out of the script", () => {
      expect(script).not.toContain("</script>");
    });

    it("adds one delegated listener and removes it on leaving", () => {
      const b = browser(script);
      expect(b.listeners.filter((l) => l.type === "click")).toHaveLength(1);
      b.fire("window", "pagehide", { persisted: false });
      expect(b.listeners).toHaveLength(0);
    });
  });

  describe("referrers and campaigns", () => {
    const script = buildScript({ clicks: false, time: false, goals: [], referrers: true });
    const views = async (b: ReturnType<typeof browser>) => (await b.sent()).filter((m) => !m.e);

    it("sends the referrer's host only, never the address or the query string", async () => {
      const b = browser(script, { referrer: "https://www.news.example.com/post/1?id=9&token=secret#top" });
      expect(await views(b)).toEqual([{ p: "/", r: "www.news.example.com" }]);
    });

    it("sends no referrer for a visit from the same site or with none", async () => {
      expect(await views(browser(script, { referrer: "https://app.example/other" }))).toEqual([{ p: "/" }]);
      expect(await views(browser(script, { referrer: "" }))).toEqual([{ p: "/" }]);
      expect(await views(browser(script, { referrer: "not a url" }))).toEqual([{ p: "/" }]);
    });

    it("sends the three utm values, trimmed and cut to 80 characters, and no other parameter", async () => {
      const long = "x".repeat(120);
      const b = browser(script, {
        search: `?utm_source=%20news%20&utm_medium=email&utm_campaign=${long}&utm_term=secret&email=a%40b.co`,
      });
      const [v] = await views(b);
      expect(v).toEqual({ p: "/", us: "news", um: "email", uc: "x".repeat(80) });
    });

    it("sends the referrer and campaign with the first page only, not with a later navigation", async () => {
      const b = browser(script, { referrer: "https://news.example.com/", search: "?utm_source=a" });
      b.history.pushState("/next");
      expect(await views(b)).toEqual([{ p: "/", r: "news.example.com", us: "a" }, { p: "/next" }]);
    });

    it("is left out entirely when the switch is off", async () => {
      const b = browser(buildScript({ clicks: false, time: false, goals: [] }), {
        referrer: "https://news.example.com/",
        search: "?utm_source=a",
      });
      expect(await views(b)).toEqual([{ p: "/" }]);
    });
  });

  describe("speed and errors", () => {
    const script = buildScript({ clicks: false, time: false, goals: [], vitals: true });
    const sentOf = async (b: ReturnType<typeof browser>, e: string) => (await b.sent()).filter((m) => m.e === e);
    const feedAll = (b: ReturnType<typeof browser>) => {
      b.feed("largest-contentful-paint", [{ startTime: 900.2 }, { startTime: 2412.6 }]);
      b.feed("layout-shift", [{ value: 0.05, hadRecentInput: false }, { value: 0.5, hadRecentInput: true }, { value: 0.0334, hadRecentInput: false }]);
      b.feed("paint", [{ name: "first-paint", startTime: 100 }, { name: "first-contentful-paint", startTime: 640.4 }]);
      b.feed("event", [{ interactionId: 1, duration: 56 }, { interactionId: 0, duration: 900 }, { interactionId: 2, duration: 184.2 }]);
    };

    it("sends one rounded summary when the page is hidden, with the path it loaded", async () => {
      const b = browser(script);
      feedAll(b);
      b.doc.hidden = true;
      b.fire("document", "visibilitychange");
      expect(await sentOf(b, "vitals")).toEqual([{ e: "vitals", p: "/", lcp: 2413, cls: 0.083, fcp: 640, inp: 184, ttfb: 123 }]);
    });

    it("sends the summary once however often the page is hidden or left", async () => {
      const b = browser(script);
      feedAll(b);
      b.doc.hidden = true;
      b.fire("document", "visibilitychange");
      b.fire("document", "visibilitychange");
      b.fire("window", "pagehide", { persisted: false });
      expect(await sentOf(b, "vitals")).toHaveLength(1);
    });

    it("sends nothing when the browser reported nothing, and ignores layout shifts caused by input", async () => {
      const b = browser(script);
      b.feed("layout-shift", [{ value: 0.4, hadRecentInput: true }]);
      b.doc.hidden = true;
      b.fire("document", "visibilitychange");
      const [v] = await sentOf(b, "vitals");
      expect(v).toEqual({ e: "vitals", p: "/", ttfb: 123 });
    });

    it("reads interactions from a duration threshold of 40 ms and disconnects its observers on leaving", () => {
      const b = browser(script);
      expect(b.observers.find((o) => o.type === "event")?.opts.durationThreshold).toBe(40);
      expect(b.observers.length).toBe(4);
      b.fire("window", "pagehide", { persisted: false });
      expect(b.observers.every((o) => !o.live)).toBe(true);
      expect(b.listeners).toHaveLength(0);
    });

    it("sends an error's message cut to 200 characters, the file name without its address, and the line", async () => {
      const b = browser(script);
      b.fire("window", "error", { message: "x".repeat(500), filename: "https://cdn.example.com/js/app.js?v=3#a", lineno: 42, error: { stack: "at https://cdn.example.com/js/app.js?v=3:42:1" } });
      const [e] = await sentOf(b, "err");
      expect(e).toEqual({ e: "err", m: "x".repeat(200), f: "app.js", l: 42 });
      expect(JSON.stringify(e)).not.toContain("cdn.example.com");
    });

    it("reports an unhandled rejection by its message", async () => {
      const b = browser(script);
      b.fire("window", "unhandledrejection", { reason: { message: "network down" } });
      b.fire("window", "unhandledrejection", { reason: "plain text" });
      expect((await sentOf(b, "err")).map((m) => m.m)).toEqual(["network down", "plain text"]);
    });

    it("sends at most 5 errors for a page view, and again after the address changes", async () => {
      const b = browser(script);
      for (let i = 0; i < 12; i++) b.fire("window", "error", { message: `e${i}`, filename: "a.js", lineno: i });
      expect(await sentOf(b, "err")).toHaveLength(5);
      b.history.pushState("/next");
      for (let i = 0; i < 12; i++) b.fire("window", "error", { message: `f${i}`, filename: "a.js", lineno: i });
      expect(await sentOf(b, "err")).toHaveLength(10);
    });

    it("adds no observers or error listeners when the switch is off", () => {
      const b = browser(buildScript({ clicks: false, time: false, goals: [] }));
      expect(b.observers).toHaveLength(0);
      expect(b.listeners.some((l) => l.type === "error" || l.type === "unhandledrejection")).toBe(false);
    });
  });

  describe("custom events", () => {
    const script = buildScript({ clicks: false, time: false, goals: [], events: true });
    const tracks = async (b: ReturnType<typeof browser>) => (await b.sent()).filter((m) => m.e === "track");

    it("sends the name and the value of a data-egg-track element", async () => {
      const b = browser(script);
      b.fire("document", "click", clickOn("Buy", { "data-egg-track": "buy", "data-egg-value": "pro" }));
      expect(await tracks(b)).toEqual([{ e: "track", n: "buy", v: "pro" }]);
    });

    it("sends the name alone when there is no value or the value is over 40 characters", async () => {
      const b = browser(script);
      b.fire("document", "click", clickOn("Buy", { "data-egg-track": "buy" }));
      b.fire("document", "click", clickOn("Buy", { "data-egg-track": "buy", "data-egg-value": "v".repeat(41) }));
      expect(await tracks(b)).toEqual([{ e: "track", n: "buy" }, { e: "track", n: "buy" }]);
    });

    it("sends nothing for a link or button with no data-egg-track, and reads no value from it", async () => {
      const b = browser(script);
      b.fire("document", "click", clickOn("Plain", { "data-egg-value": "x" }));
      expect(await tracks(b)).toEqual([]);
    });

    it("still sends a funnel goal for the same name", async () => {
      const b = browser(buildScript({ clicks: false, time: false, goals: ["buy"], events: true }));
      b.fire("document", "click", clickOn("Buy", { "data-egg-track": "buy", "data-egg-value": "pro" }));
      expect((await b.sent()).filter((m) => m.e)).toEqual([{ e: "track", n: "buy", v: "pro" }, { e: "goal", n: "buy" }]);
    });
  });

  describe("retention and the live view", () => {
    const on = buildScript({ clicks: false, time: false, goals: [], retention: true });
    const live = buildScript({ clicks: false, time: false, goals: [], retention: true, live: true });

    it("makes a random id in localStorage, sets no cookie, and sends it with the page view", async () => {
      const b = browser(on);
      const id = b.store["_egg_id"];
      expect(id).toMatch(/^[a-f0-9]{24}$/);
      expect(await b.sent()).toEqual([{ p: "/", i: id }]);
      expect(on).not.toMatch(/cookie/i);
    });

    it("keeps the id it already has", async () => {
      const b = browser(on, { store: { _egg_id: "abcdef0123456789abcdef01" } });
      expect(await b.sent()).toEqual([{ p: "/", i: "abcdef0123456789abcdef01" }]);
    });

    it("sends no id when storage is blocked", async () => {
      const b = browser(on, { storeBlocked: true });
      expect(await b.sent()).toEqual([{ p: "/" }]);
    });

    it("removes an id left by an earlier setting when retention is off", async () => {
      const b = browser(buildScript({ clicks: false, time: false, goals: [] }), { store: { _egg_id: "abcdef0123456789abcdef01" } });
      expect(b.store["_egg_id"]).toBeUndefined();
      expect(await b.sent()).toEqual([{ p: "/" }]);
    });

    it("sends a heartbeat every 60 seconds while the page is visible", async () => {
      const b = browser(live);
      expect(b.timers).toHaveLength(1);
      expect(b.timers[0].ms).toBe(60_000);
      b.timers[0].fn();
      b.doc.hidden = true;
      b.timers[0].fn();
      b.doc.hidden = false;
      b.timers[0].fn();
      const pings = (await b.sent()).filter((m) => m.e === "ping");
      expect(pings).toEqual([{ e: "ping", i: b.store["_egg_id"] }, { e: "ping", i: b.store["_egg_id"] }]);
    });

    it("stops the heartbeat when the page is left for good", () => {
      const b = browser(live);
      b.fire("window", "pagehide", { persisted: false });
      expect(b.timers.every((t) => !t.live)).toBe(true);
    });

    it("sets no timer without live view, and none without the retention id to count", () => {
      expect(browser(on).timers).toHaveLength(0);
      expect(browser(buildScript({ clicks: false, time: false, goals: [], live: true })).timers).toHaveLength(0);
    });
  });

  describe("size", () => {
    it("stays small with everything on", () => {
      const all = buildScript({
        clicks: true,
        time: true,
        goals: ["signup"],
        referrers: true,
        vitals: true,
        events: true,
        live: true,
        retention: true,
      });
      expect(gzipSync(all).length).toBeLessThan(2500);
    });
  });
});
