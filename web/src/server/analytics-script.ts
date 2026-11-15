/**
 * The analytics snippet, built per project. With every opt-in off it is the
 * page view script and nothing more; each switch adds only its own few lines.
 *
 * Rules the script keeps:
 *  - it sends nothing, and adds no listener, when the browser sends Do Not Track
 *    or Global Privacy Control, and on localhost;
 *  - it sets no cookie. It stores one random id in localStorage only while the
 *    owner has retention on, and removes that id when retention is off;
 *  - route details default to `/`; only a site-declared route template is sent;
 *  - it sends the referrer's host only, never the address or the query string;
 *  - every listener, observer and timer it adds is removed when the page is left for good.
 */

export type ScriptFeatures = {
  clicks: boolean;
  time: boolean;
  /** data-egg-track names that are steps of the funnel. Empty when funnels are off. */
  goals: string[];
  /** Send the referring host once per page load. */
  referrers?: boolean;
  /** Send only campaign values explicitly allowlisted by the owner. */
  campaigns?: boolean;
  utmAllowlist?: { source: string[]; medium: string[]; campaign: string[] };
  /** Send web vitals (once, when the page is hidden). */
  vitals?: boolean;
  /** Send a track event, with the optional data-egg-value, for a click on a data-egg-track element. */
  events?: boolean;
  /** Send a heartbeat every 60 seconds while the page is visible. Needs the retention id. */
  live?: boolean;
  /** Make, keep and send a random id from localStorage. */
  retention?: boolean;
};

const HEAD = `(function () {
  var s = document.currentScript;
  if (!s) return;
  var key = s.getAttribute("data-key");
  if (!key) return;
  var n = navigator;
  if (n.doNotTrack === "1" || n.doNotTrack === "yes" || window.doNotTrack === "1" || n.globalPrivacyControl === true) return;
  var host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return;
  var endpoint = new URL(s.src).origin + "/api/collect/" + encodeURIComponent(key);
  var last = null;
  // Route names are opt-in so reset links and account identifiers never leave
  // the page by default. Sites may provide a stable template on <html>.
  function pagePath() {
    var p = document.documentElement && document.documentElement.getAttribute("data-egg-path");
    return p && p.charAt(0) === "/" ? p.split(/[?#]/)[0].slice(0, 200) : "/";
  }
  var off = [];
  function on(t, type, fn, cap) {
    t.addEventListener(type, fn, cap);
    off.push(function () { t.removeEventListener(type, fn, cap); });
  }
  function post(o) {
    var body = JSON.stringify(o);
    // text/plain keeps this a simple request, so no preflight is needed.
    if (n.sendBeacon) {
      n.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }));
    } else {
      fetch(endpoint, { method: "POST", body: body, keepalive: true, mode: "no-cors" });
    }
  }
`;

// A random id kept in localStorage, never a cookie. Only a project with retention
// on makes one. Without it, an id left by an earlier setting is removed.
const ID_ON = `  var id = "";
  try {
    id = localStorage.getItem("_egg_id") || "";
    if (!id) {
      var a = new Uint8Array(12);
      crypto.getRandomValues(a);
      id = Array.prototype.map.call(a, function (b) { return (b + 256).toString(16).slice(1); }).join("");
      localStorage.setItem("_egg_id", id);
    }
  } catch (e) {
    id = "";
  }
`;
const ID_OFF = `  try { localStorage.removeItem("_egg_id"); } catch (e) {}
`;

// The referrer's host from the first page of a visit only. A link inside the
// site is not a referrer, and the address is never sent.
const REFERRERS = `    if (first) {
      try {
        var h = new URL(document.referrer).hostname;
        if (h && h !== host) o.r = h;
      } catch (e) {}
    }
`;

// Query values can carry identifiers or secrets. Even with campaigns enabled,
// only the owner's exact approved static labels ever leave the visitor's page.
const CAMPAIGNS = `    if (first) {
      var q = new URLSearchParams(location.search);
      var u = { us: ["utm_source", @SOURCE@], um: ["utm_medium", @MEDIUM@], uc: ["utm_campaign", @CAMPAIGN@] };
      for (var k in u) {
        var v = (q.get(u[k][0]) || "").trim();
        if (v && u[k][1].indexOf(v) !== -1) o[k] = v;
      }
    }
`;

const VIEW = `  function send() {
    var route = location.pathname;
    if (route === last) return;
@FLUSH@    var first = last === null;
    last = route;
    var o = { p: pagePath(), pt: 1 };
@REFERRERS@@CAMPAIGNS@@ID@    post(o);
@RESET@  }
  var push = history.pushState;
  var wrapped = function () {
    push.apply(this, arguments);
    send();
  };
  history.pushState = wrapped;
  off.push(function () { if (history.pushState === wrapped) history.pushState = push; });
  on(window, "popstate", send);
`;

// Only explicitly named elements are measured. Accessible names and visible
// text can contain personal data, so analytics never reads them.
const CLICKS = `  on(document, "click", function (e) {
    var t = e.target;
    var el = t && t.closest && t.closest("[data-egg-track]");
    if (!el) return;
    var name = el.getAttribute("data-egg-track");
    var l = name || "";
    if (!l) return;
@SEND@  }, true);
`;

// Visible time only: the clock is two timestamps, not a timer, so a hidden tab
// adds nothing and nothing keeps running.
const TIME = `  var acc = 0;
  var since = document.hidden ? 0 : Date.now();
  function flush() {
    var ms = acc + (since ? Date.now() - since : 0);
    acc = 0;
    if (since) since = Date.now();
    if (ms <= 0) return;
    post({ e: "time", b: ms < 1e4 ? "lt10" : ms < 6e4 ? "10-60" : ms < 3e5 ? "60-300" : "gt300" });
  }
  on(document, "visibilitychange", function () {
    var now = Date.now();
    if (document.hidden) {
      if (since) acc += now - since;
      since = 0;
    } else if (!since) {
      since = now;
    }
  });
  on(window, "pageshow", function (e) {
    if (e.persisted) {
      acc = 0;
      since = document.hidden ? 0 : Date.now();
    }
  });
`;

// Speed: the browser's own PerformanceObserver, no library. One summary for the
// page load, sent once when the page is hidden, each number rounded. Exception
// messages are intentionally not collected because they can contain secrets.
const VITALS = `  var vit = {};
  var shift = 0;
  var p0 = pagePath();
  var sentV = 0;
  function watch(type, fn, extra) {
    try {
      var po = new PerformanceObserver(function (l) { l.getEntries().forEach(fn); });
      po.observe(Object.assign({ type: type, buffered: true }, extra));
      off.push(function () { po.disconnect(); });
    } catch (e) {}
  }
  watch("largest-contentful-paint", function (e) { vit.lcp = e.startTime; });
  watch("layout-shift", function (e) { if (!e.hadRecentInput) vit.cls = shift += e.value; });
  watch("paint", function (e) { if (e.name === "first-contentful-paint") vit.fcp = e.startTime; });
  watch("event", function (e) { if (e.interactionId && e.duration > (vit.inp || 0)) vit.inp = e.duration; }, { durationThreshold: 40 });
  try { vit.ttfb = performance.getEntriesByType("navigation")[0].responseStart; } catch (e) {}
  function sendVitals() {
    if (sentV) return;
    sentV = 1;
    var o = { e: "vitals", p: p0, pt: 1 };
    var any = 0;
    for (var k in vit) {
      o[k] = k === "cls" ? Math.round(vit[k] * 1e3) / 1e3 : Math.round(vit[k]);
      any = 1;
    }
    if (any) post(o);
  }
  on(document, "visibilitychange", function () { if (document.hidden) sendVitals(); });
`;

// A heartbeat while the page is visible, for the "on the site now" count.
const LIVE = `  if (id) {
    var hb = setInterval(function () { if (!document.hidden) post({ e: "ping", i: id }); }, 6e4);
    off.push(function () { clearInterval(hb); });
  }
`;

const TAIL = `  function stop() {
    while (off.length) off.pop()();
  }
  on(window, "pagehide", function (e) {
@LEAVE@    // A page kept in the back-forward cache may come back, so it keeps listening.
    if (!e.persisted) stop();
  });
  send();
})();
`;

/** Escape a value for a JavaScript string literal inside a script response. */
function literal(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/**
 * Take out what a browser does not need: indentation and whole-line comments.
 * Nothing in the script depends on either, and it shrinks what every page downloads.
 */
function squeeze(code: string): string {
  return code
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"))
    .join("\n")
    .concat("\n");
}

export function buildScript(f: ScriptFeatures): string {
  const goals = f.goals;
  const retention = Boolean(f.retention);
  let clicks = "";
  if (f.clicks || goals.length || f.events) {
    let send = "";
    if (f.clicks) send += '    post({ e: "click", l: l });\n';
    if (f.events) {
      send +=
        '    if (name) {\n      var v = el.getAttribute("data-egg-value");\n      post(v && v.length < 41 ? { e: "track", n: name, v: v } : { e: "track", n: name });\n    }\n';
    }
    if (goals.length) {
      send += `    if (name && [${goals.map(literal).join(",")}].indexOf(name) > -1) post({ e: "goal", n: name });\n`;
    }
    clicks = CLICKS.replace("@SEND@", send);
  }
  const code =
    HEAD +
    (retention ? ID_ON : ID_OFF) +
    (f.time ? TIME : "") +
    (f.vitals ? VITALS : "") +
    VIEW.replace("@FLUSH@", f.time ? "    if (last !== null) flush();\n" : "")
      .replace("@REFERRERS@", f.referrers ? REFERRERS : "")
      .replace("@CAMPAIGNS@", f.campaigns ? CAMPAIGNS
        .replace("@SOURCE@", `[${(f.utmAllowlist?.source ?? []).map(literal).join(",")}]`)
        .replace("@MEDIUM@", `[${(f.utmAllowlist?.medium ?? []).map(literal).join(",")}]`)
        .replace("@CAMPAIGN@", `[${(f.utmAllowlist?.campaign ?? []).map(literal).join(",")}]`) : "")
      .replace("@ID@", retention ? "    if (id) o.i = id;\n" : "")
      .replace("@RESET@", "") +
    clicks +
    (f.live && retention ? LIVE : "") +
    TAIL.replace("@LEAVE@", (f.time ? "    flush();\n" : "") + (f.vitals ? "    sendVitals();\n" : ""));
  return squeeze(code);
}
