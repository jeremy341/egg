/**
 * The analytics snippet, built per project. With every opt-in off it is the
 * page view script and nothing more; each switch adds only its own few lines.
 *
 * Rules the script keeps:
 *  - it sends nothing, and adds no listener, when the browser sends Do Not Track
 *    or Global Privacy Control, and on localhost;
 *  - it sets no cookie and stores nothing in the browser;
 *  - every listener it adds is removed when the page is left for good.
 */

export type ScriptFeatures = {
  clicks: boolean;
  time: boolean;
  /** data-nd-track names that are steps of the funnel. Empty when funnels are off. */
  goals: string[];
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

const VIEW = `  function send() {
    var path = location.pathname;
    if (path === last) return;
@FLUSH@    last = path;
    post({ p: path, r: document.referrer || undefined });
  }
  var push = history.pushState;
  var wrapped = function () {
    push.apply(this, arguments);
    send();
  };
  history.pushState = wrapped;
  off.push(function () { if (history.pushState === wrapped) history.pushState = push; });
  on(window, "popstate", send);
`;

// One delegated listener for the whole document. It only looks at links,
// buttons and elements the owner marked, and it reads a label, never a value.
const CLICKS = `  on(document, "click", function (e) {
    var t = e.target;
    var el = t && t.closest && t.closest("[data-nd-track],a,button,[role=button],[role=link],summary");
    if (!el) return;
    var name = el.getAttribute("data-nd-track");
    var l = (name || el.getAttribute("aria-label") || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40);
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

export function buildScript(f: ScriptFeatures): string {
  const goals = f.goals;
  let clicks = "";
  if (f.clicks || goals.length) {
    let send = "";
    if (f.clicks) send += '    post({ e: "click", l: l });\n';
    if (goals.length) {
      send += `    if (name && [${goals.map(literal).join(",")}].indexOf(name) > -1) post({ e: "goal", n: name });\n`;
    }
    clicks = CLICKS.replace("@SEND@", send);
  }
  return (
    HEAD +
    (f.time ? TIME : "") +
    VIEW.replace("@FLUSH@", f.time ? "    if (last !== null) flush();\n" : "") +
    clicks +
    TAIL.replace("@LEAVE@", f.time ? "    flush();\n" : "")
  );
}
