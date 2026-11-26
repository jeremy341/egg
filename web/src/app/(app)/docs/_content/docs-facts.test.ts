import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ANALYTICS_FEATURES, ANALYTICS_FEATURE_LABELS, parseAnalyticsDefaults } from "@/lib/analytics-defaults";
import { ACCENT_LABELS, AVATARS, DEFAULT_PREFERENCES, THEMES } from "@/lib/preferences";
import { LIVE_KEEP_MS, LIVE_WINDOW_MS, RETENTION_PERIOD_MS } from "@/server/analytics";
import { NO_FEATURES } from "@/server/analytics-config";
import { UTM_MAX, VITAL_THRESHOLDS } from "@/server/analytics-fields";
import { MIN_COHORT } from "@/server/analytics-retention";
import { JSON_BODY_LIMIT } from "@/server/body-limit";
import { trustProxyEnabled } from "@/server/config";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/server/deployment-page";
import { RESERVED_NAMES } from "@/server/domain-policy";
import { STATUS_TTL_MS } from "@/server/service-status";
import { MIN_SAMPLE } from "@/server/stats";
import { CONTENT } from "./index";

const root = path.resolve(__dirname, "../../../../../..");
const read = (file: string) => readFileSync(path.resolve(root, file), "utf8");

function html(id: string): string {
  const Page = CONTENT[id];
  return renderToStaticMarkup(createElement(() => Page())).replace(/&#x27;|&quot;/g, '"');
}

describe("deployment and log paging", () => {
  it("states the page size the server uses", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(25);
    expect(MAX_PAGE_SIZE).toBe(100);
    const out = html("deployments");
    expect(out).toContain("Load older");
    expect(out).toContain("25 at a time");
    expect(html("limits")).toContain("Load older");
  });

  it("says runtime logs load 300 lines at a time and have a Load older lines button", () => {
    const view = read("web/src/components/logs-view.tsx");
    expect(view).toContain("runtime-logs?lines=300");
    expect(view).toContain("Load older lines");
    const out = html("logs");
    expect(out).toContain("Load older lines");
    expect(out).toContain("300 at a time");
  });
});

describe("the Settings page", () => {
  const out = html("account");

  it("names every theme, accent and character the page offers", () => {
    for (const t of THEMES) expect(out.toLowerCase(), t).toContain(t);
    for (const label of Object.values(ACCENT_LABELS)) expect(out, label).toContain(label);
    for (const a of AVATARS) expect(out, a.label).toContain(a.label);
  });

  it("gives the defaults the code starts with", () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({
      theme: "system",
      accent: "default",
      density: "comfortable",
      reducedMotion: "system",
      defaultBranch: null,
      displayName: null,
      avatar: "pixel-01",
    });
    expect(AVATARS[0].label).toBe("Egg");
    expect(out).toContain("40 characters");
  });

  it("lists all eight analytics defaults, every one off", () => {
    expect(ANALYTICS_FEATURES).toHaveLength(8);
    expect(DEFAULT_PREFERENCES.analyticsDefaults).toEqual({});
    expect(parseAnalyticsDefaults(undefined)).toEqual({});
    for (const key of ANALYTICS_FEATURES) {
      expect(out, key).toContain(ANALYTICS_FEATURE_LABELS[key].title);
    }
    expect(out).toContain("All off");
    expect(out).toContain("first time you turn analytics on");
  });
});

describe("analytics switches and numbers", () => {
  const out = html("analytics");

  it("starts with every switch off", () => {
    expect(NO_FEATURES.clicks || NO_FEATURES.time || NO_FEATURES.funnel).toBe(false);
    expect(NO_FEATURES.referrers || NO_FEATURES.vitals || NO_FEATURES.events).toBe(false);
    expect(NO_FEATURES.live || NO_FEATURES.retention).toBe(false);
    expect(out).toContain("Everything else is a switch that starts off");
  });

  it("states the field limits and thresholds", () => {
    expect(UTM_MAX).toBe(80);
    expect(out).toContain("80 characters");
    expect(out).toContain("data-egg-value");
    expect(out).toContain("40 characters");
    expect(MIN_SAMPLE).toBe(50);
    expect(MIN_COHORT).toBe(20);
    expect(out).toContain("50 page views");
    expect(out).toContain("20 visitors");
    expect(LIVE_WINDOW_MS).toBe(5 * 60_000);
    expect(LIVE_KEEP_MS).toBe(60 * 60_000);
    expect(RETENTION_PERIOD_MS).toBe(90 * 86_400_000);
    expect(out).toContain("5 minutes");
    expect(out).toContain("every 90 days");
  });

  it("quotes the speed thresholds", () => {
    expect(VITAL_THRESHOLDS.lcp).toEqual([2500, 4000]);
    expect(VITAL_THRESHOLDS.cls).toEqual([0.1, 0.25]);
    expect(VITAL_THRESHOLDS.inp).toEqual([200, 500]);
    expect(VITAL_THRESHOLDS.fcp).toEqual([1800, 3000]);
    expect(VITAL_THRESHOLDS.ttfb).toEqual([800, 1800]);
    for (const text of ["LCP 2.5 s and 4 s", "CLS 0.1 and 0.25", "INP 200 ms and 500 ms", "FCP 1.8 s and 3 s", "TTFB 800 ms"]) {
      expect(out, text).toContain(text);
    }
  });

  it("says plainly how to turn retention off and that it is not a cookie", () => {
    expect(out).toContain("not a cookie");
    expect(out).toContain("local storage");
    expect(out).toContain("clear the Retention checkbox");
  });

  it("explains TRUST_PROXY for analytics", () => {
    expect(out).toContain("TRUST_PROXY=1");
    expect(out).toContain("every visitor counts as one address");
  });
});

describe("domains", () => {
  it("states the reserved-name count", () => {
    // 119 names copied from Nest, plus the seven Egg adds.
    expect(RESERVED_NAMES.size).toBe(126);
    const out = html("domains");
    expect(out).toContain("119 names from Nest");
    expect(out).toContain("domain-verification=your-nest-username");
    for (const status of ["Waiting for DNS", "Active", "Needs attention"]) expect(out, status).toContain(status);
  });
});

describe("host key confirmation", () => {
  it("quotes the labels the Connect page prints", () => {
    const flow = read("web/src/components/connect-flow.tsx");
    expect(flow).toContain("Confirm host key");
    expect(flow).toContain("Confirming…");
    for (const id of ["servers", "security", "quickstart"]) expect(html(id), id).toContain("Confirm host key");
    expect(html("servers")).toContain("This is the first connection to NAME.hackclub.app");
  });
});

describe("the service card and the status page", () => {
  it("says a reading under 30 seconds old is reused", () => {
    expect(STATUS_TTL_MS).toBe(30_000);
    expect(html("monitoring")).toContain("under 30 seconds old");
  });
});

describe("request size and masking", () => {
  it("states the 256 KB dashboard cap", () => {
    expect(JSON_BODY_LIMIT).toBe(256 * 1024);
    expect(html("security")).toContain("256 KB");
  });

  it("no longer says encoded secrets or short secrets are never masked", () => {
    const out = [html("env"), html("security"), html("logs")].join("\n");
    expect(out).not.toMatch(/shorter than 4 characters is not (hidden|masked)/);
    expect(out).not.toContain("Values of 4 or more characters");
  });
});

describe("self-hosting", () => {
  const readme = read("docs/selfhost/README.md");
  const config = read("web/src/server/config.ts");

  it("lists every setting that config.ts reads", () => {
    const schema = config.slice(config.indexOf("const schema"), config.indexOf("export type Config"));
    const names = [...schema.matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(15);
    for (const name of names) expect(readme, name).toContain(`\`${name}\``);
    expect(html("selfhost")).toContain("TRUST_PROXY");
  });

  it("gives TRUST_PROXY as off by default, in the code, the example file and the guide", () => {
    expect(trustProxyEnabled({})).toBe(false);
    expect(read("web/.env.example")).toMatch(/^TRUST_PROXY=0/m);
    expect(readme).toMatch(/\| `TRUST_PROXY` \| `0` \|/);
  });

  it("names the Node version that the pinned pnpm needs", () => {
    expect(read("web/package.json")).toContain('"packageManager": "pnpm@11.20.0"');
    expect(readme).toContain("Node.js 22.13 or newer");
  });

  it("runs the setup script with pnpm run, because pnpm has its own setup command", () => {
    const scripts = JSON.parse(read("web/package.json")).scripts as Record<string, string>;
    expect(scripts.setup).toBe("node scripts/setup.mjs");
    expect(readme).toContain("pnpm run setup");
    expect(readme.match(/pnpm setup/g)?.length).toBe(1); // only in the sentence that says not to use it
    expect(html("selfhost")).toContain("pnpm run setup");
  });

  it("only names pnpm scripts that exist", () => {
    const scripts = JSON.parse(read("web/package.json")).scripts as Record<string, string>;
    for (const m of readme.matchAll(/`pnpm ([a-z][a-z:-]*)/g)) {
      const name = m[1];
      if (name === "run" || name === "install" || name === "setup") continue;
      expect(Object.keys(scripts), `pnpm ${name}`).toContain(name);
    }
  });

  it("names the scripts, files and defaults that the one-command start and the server setup rely on", () => {
    const scripts = JSON.parse(read("web/package.json")).scripts as Record<string, string>;
    for (const name of ["egg", "doctor", "service:install", "service:remove", "compose:up", "backup"]) {
      expect(Object.keys(scripts), name).toContain(name);
    }
    const page = html("selfhost");
    for (const text of ["pnpm egg start", "pnpm run doctor", "pnpm run service:install", "docker compose up -d --build", "deploy/backup.sh", "deploy/upgrade.sh"]) {
      expect(readme, text).toContain(text);
      expect(page, text).toContain(text);
    }
    // The commands in the guide are the ones the scripts print and the files hold.
    expect(read("web/scripts/egg-cli.mjs")).toContain("egg start [--dev]");
    expect(read("web/scripts/setup.mjs")).toContain("LOCAL_MODE=1");
    expect(read("web/scripts/service/templates.mjs")).toContain("systemctl --user enable --now");
    expect(readme).toContain("systemctl --user enable --now egg");
    expect(read("web/scripts/service/install.mjs")).toContain("loginctl enable-linger");
    // The worker, and so Docker socket access, is off in the example file.
    expect(read("deploy/.env.example")).toMatch(/^# COMPOSE_PROFILES=builds$/m);
    expect(read("compose.yaml")).toContain('profiles: ["builds"]');
    expect(readme).toContain("`COMPOSE_PROFILES=builds` is commented out");
    expect(page).toContain("COMPOSE_PROFILES=builds");
    // The numbers in the server security notes match the code.
    expect(JSON_BODY_LIMIT).toBe(256 * 1024);
    expect(readme).toContain("up to 256 KB");
    expect(readme).toContain("20 sign-in attempts a minute");
    expect(readme).toContain("60 requests a minute");
  });
});
