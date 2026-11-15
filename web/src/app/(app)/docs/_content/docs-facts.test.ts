import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ANALYTICS_FEATURES, ANALYTICS_FEATURE_LABELS, parseAnalyticsDefaults } from "@/lib/analytics-defaults";
import { AVATARS, DEFAULT_PREFERENCES, PRESETS } from "@/lib/preferences";
import { LIVE_KEEP_MS, LIVE_WINDOW_MS, RETENTION_PERIOD_MS } from "@/server/analytics";
import { NO_FEATURES, featuresPatch } from "@/server/analytics-config";
import { UTM_ALLOWLIST_MAX, UTM_ALLOWLIST_VALUE, VITAL_THRESHOLDS } from "@/server/analytics-fields";
import { MIN_COHORT } from "@/server/analytics-retention";
import { JSON_BODY_LIMIT } from "@/server/body-limit";
import { trustProxyEnabled } from "@/server/config";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@/server/deployment-page";
import { BUILD_TIMEOUT_SECONDS, containerMemoryCapMb, describeBuildFailure } from "@/server/deploy/container-build";
import { MIN_FREE_DISK_MB, evaluatePreflight, type PreflightFacts, type PreflightNeeds } from "@/server/deploy/container-probe";
import { RESERVED_NAMES } from "@/server/domain-policy";
import { STATUS_TTL_MS } from "@/server/service-status";
import { MIN_SAMPLE } from "@/server/stats";
import { MIN_GAP_MINUTES, ScheduleError, parseSchedule } from "@/lib/cron-schedule";
import { REAUTH_WINDOW_MS } from "@/server/auth/session";
import { JOB_TIMEOUT_SECONDS } from "@/server/deploy/jobs-remote";
import { MAX_JOBS_PER_PROJECT } from "@/server/scheduled-jobs";
import { CONTENT } from "./index";

const root = path.resolve(__dirname, "../../../../../..");
const read = (file: string) => readFileSync(path.resolve(root, file), "utf8");

function html(id: string): string {
  const Page = CONTENT[id];
  return renderToStaticMarkup(createElement(() => Page())).replace(/&#x27;|&quot;/g, '"');
}

describe("builds on the container", () => {
  const good: PreflightFacts = {
    ran: true, nodeVersion: "v22.13.0", hasNpm: true, hasCorepack: true, hasPython3: true, pythonVenv: true,
    hasSystemdRun: true, hasTimeout: true, cgroupMemory: true, scopeOk: true, diskFreeMb: 50_000, memTotalMb: 2048,
  };
  const needs: PreflightNeeds = { node: true, nodeEngine: null, packageManager: "npm", python: true, buildWork: true };
  const fixes = (facts: Partial<PreflightFacts>, n: Partial<PreflightNeeds> = {}) =>
    evaluatePreflight({ ...good, ...facts }, { ...needs, ...n }).map((p) => p.fix);
  const page = html("troubleshooting").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

  /** The part of a fix line before a value that changes, as the guide writes it. */
  const quoted = (line: string, cut: string) => line.slice(0, line.indexOf(cut));
  it("lists every fix line the pre-upload check can give", () => {
    expect(MIN_FREE_DISK_MB).toBe(2048);
    expect(fixes({ ran: false })[0]).toContain("Egg could not check your container before building, so nothing was uploaded.");
    expect(page).toContain("Egg could not check your container before building, so nothing was uploaded.");
    const disk = fixes({ diskFreeMb: 100 })[0];
    expect(disk).toContain("a build needs at least 2048 MB");
    expect(page).toContain(quoted(disk, "100 MB"));
    expect(page).toContain("a build needs at least 2048 MB");
    // Each entry: what the container lacks, a fragment of the code's fix line, and the same fragment in the guide.
    for (const [facts, n, inCode, inGuide] of [
      [{ hasSystemdRun: false }, {}, "Builds on your container run under a memory cap with systemd-run", "Builds on your container run under a memory cap with systemd-run"],
      [{ scopeOk: false }, {}, "Your container cannot apply a memory cap to a build", "Your container cannot apply a memory cap to a build"],
      [{ hasTimeout: false }, {}, "Install coreutils on your container: sudo apt install coreutils", "Install coreutils on your container: sudo apt install coreutils"],
      [{ nodeVersion: null }, {}, "Install Node.js 22.13 or newer on your container (nodejs.org), then deploy again.", "or newer on your container (nodejs.org), then deploy again."],
      [{ nodeVersion: "v18.0.0" }, {}, "on your container does not match what this project needs", "on your container does not match what this project needs"],
      [{ hasNpm: false }, {}, "Install npm on your container: sudo apt install npm", "Install npm on your container: sudo apt install npm"],
      [{ hasCorepack: false }, { packageManager: "pnpm" }, "which needs corepack. On your container run: npm install -g corepack", "which needs corepack. On your container run: npm install -g corepack"],
      [{ hasPython3: false }, {}, "Install Python 3 on your container: sudo apt install python3", "Install Python 3 on your container: sudo apt install python3"],
      [{ pythonVenv: false }, {}, "Install python3-venv on your container: sudo apt install python3-venv", "Install python3-venv on your container: sudo apt install python3-venv"],
    ] as [Partial<PreflightFacts>, Partial<PreflightNeeds>, string, string][]) {
      expect(fixes(facts, n).some((l) => l.includes(inCode)), inCode).toBe(true);
      expect(page, inGuide).toContain(inGuide);
    }
  });

  it("states the memory cap and the failure messages the way the code produces them", () => {
    expect(containerMemoryCapMb(512, 2048)).toBe(512);
    expect(containerMemoryCapMb(512, 2048, true)).toBe(1024);
    expect(containerMemoryCapMb(512, 1024, true)).toBe(512);
    expect(containerMemoryCapMb(2048, 2048)).toBe(1536);
    expect(() => containerMemoryCapMb(1024, 700)).toThrow(/too little to build in/);
    expect(BUILD_TIMEOUT_SECONDS).toBe(15 * 60);
    const ctx = { memoryCapMb: 1024, appRunning: true };
    expect(describeBuildFailure(137, ctx)).toBe("The build needed more memory than the cap of 1024 MB. Your app is still running.");
    expect(describeBuildFailure(124, ctx)).toBe("The build took longer than 15 minutes and was stopped. Your app is still running.");
    expect(page).toContain("The build needed more memory than the cap of <n> MB. Your app is still running.");
    expect(page).toContain("The build took longer than 15 minutes and was stopped. Your app is still running.");
    expect(html("container")).toContain("memory minus 512 MB");
  });
});

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

  it("names every theme setting, colour theme and character the page offers", () => {
    for (const name of ["Match my device", "Light theme", "Dark theme", "Light themes", "Dark themes"]) expect(out, name).toContain(name);
    for (const p of PRESETS) expect(out, p.label).toContain(p.label);
    for (const a of AVATARS) expect(out, a.label).toContain(a.label);
  });

  it("gives the defaults the code starts with", () => {
    expect(DEFAULT_PREFERENCES).toMatchObject({
      matchDevice: true,
      lightPreset: "egg-light",
      darkPreset: "egg-dark",
      preset: "egg-dark",
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

  it("says Campaigns and Record visitor countries are not among the defaults, and that Referrers is", () => {
    expect([...ANALYTICS_FEATURES]).not.toContain("campaigns");
    expect([...ANALYTICS_FEATURES]).not.toContain("locations");
    expect(ANALYTICS_FEATURE_LABELS.referrers.title).toBe("Referrers");
    expect(out).toContain("Referrers, Speed and errors");
    expect(out).not.toContain("Referrers and campaigns");
    expect(out).toContain("Campaigns and Record visitor countries are not in this list");
    expect(html("analytics")).toContain("Campaigns and Record visitor countries are not among them");
  });
});

describe("analytics switches and numbers", () => {
  const out = html("analytics");

  it("starts with every switch off", () => {
    expect(NO_FEATURES.clicks || NO_FEATURES.time || NO_FEATURES.funnel).toBe(false);
    expect(NO_FEATURES.referrers || NO_FEATURES.vitals || NO_FEATURES.events).toBe(false);
    expect(NO_FEATURES.live || NO_FEATURES.retention).toBe(false);
    expect(NO_FEATURES.campaigns || NO_FEATURES.locations).toBe(false);
    expect(out).toContain("Everything else is a switch that starts off");
  });

  it("states the field limits and thresholds", () => {
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

  it("describes Campaigns as its own switch with an exact allowlist, and the limits the server enforces", () => {
    expect(UTM_ALLOWLIST_MAX).toBe(20);
    expect(UTM_ALLOWLIST_VALUE.test("a".repeat(40))).toBe(true);
    expect(UTM_ALLOWLIST_VALUE.test("a".repeat(41))).toBe(false);
    expect(out).toContain("up to 20");
    expect(out).toContain("up to 40 characters: letters, numbers, dot, dash and underscore");
    expect(out).toContain("only a value that is on its list, spelled exactly as listed");
    expect(out).toContain("Any other value is dropped");
    expect(out).not.toContain("Referrers and campaigns");
    expect(out).not.toContain("80 characters");
    // The labels the guide quotes are on the Setup screen.
    const screen = read("web/src/components/analytics-features.tsx");
    for (const label of ["Referrers", "Campaigns", "Allowed campaign values", "Save allowed values", "Keep the numbers for", "Record visitor countries"]) {
      expect(screen, label).toContain(label);
      expect(out, label).toContain(label);
    }
    expect(read("web/src/server/analytics-config.ts")).toContain("Allow at least one safe campaign label before turning campaigns on.");
    expect(out).toContain("Allow at least one safe campaign label before turning campaigns on.");
  });

  it("gives the retention choices the server accepts, and 90 days as the start", () => {
    for (const days of [30, 60, 90]) expect(featuresPatch.safeParse({ retentionDays: days }).success, String(days)).toBe(true);
    for (const days of [0, 7, 45, 120, 365]) expect(featuresPatch.safeParse({ retentionDays: days }).success, String(days)).toBe(false);
    expect(NO_FEATURES.retentionDays).toBe(90);
    expect(out).toContain("30, 60 or 90 days");
    expect(out).toContain("A project keeps 90 days until you change it.");
    expect(out).toContain("Keep the numbers for");
  });

  it("says which switches delete what they stored when turned off, as the server does", () => {
    const code = read("web/src/server/analytics-config.ts");
    expect(code).toContain("set({ vid: null })");
    expect(code).toContain("set({ country: null })");
    expect(code).toContain("set({ referrer: null })");
    expect(code).toContain("set({ utmSource: null, utmMedium: null, utmCampaign: null })");
    expect(out).toContain("Turning off Referrers, Campaigns, Retention or Record visitor countries deletes what that switch stored");
  });

  it("describes Record visitor countries as the code does, with the database credit", () => {
    const code = read("web/src/server/analytics-locations.ts");
    // The lookup is a database that ships with the app, done in the request, with only the code kept.
    expect(code).toContain('import("geoip-country")');
    expect(code).toContain("return found && COUNTRY_CODE.test(found.country)");
    expect(read("web/src/server/analytics.ts")).toContain("country: await countryToStore(f.locations, who.ip),");
    expect(NO_FEATURES.locations).toBe(false);
    expect(out).toContain("Record visitor countries");
    expect(out).toContain("country database that ships with Egg");
    expect(out).toContain("in the same request that records the page view");
    expect(out).toContain("Only the two-letter country code");
    expect(out).toContain("Egg does not store or log the IP address");
    expect(out).toContain("keeps no city, region or position");
    expect(out).toContain("fewer than 10");
    expect(out).toContain("Where visitors are");
    const card = read("web/src/components/analytics-locations-card.tsx");
    expect(card).toContain('const TITLE = "Where visitors are"');
    const credit = "This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com.";
    expect(card).toContain(credit);
    expect(out).toContain(credit);
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

describe("scheduled jobs", () => {
  const out = html("jobs");

  it("states the limits the code enforces", () => {
    expect(MIN_GAP_MINUTES).toBe(5);
    expect(MAX_JOBS_PER_PROJECT).toBe(5);
    expect(JOB_TIMEOUT_SECONDS).toBe(30 * 60);
    expect(out).toContain(`at most once every ${MIN_GAP_MINUTES} minutes`);
    expect(out).toContain(`A project can have ${MAX_JOBS_PER_PROJECT} jobs.`);
    expect(out).toContain(`stopped after ${JOB_TIMEOUT_SECONDS / 60} minutes`);
    expect(html("limits")).toContain("5 per project. At most one run every 5 minutes. A run is stopped after 30 minutes.");
  });

  it("accepts the schedules in the examples and refuses the ones listed as not accepted", () => {
    for (const ok of ["*/15 * * * *", "0 * * * *", "0 */6 * * *", "30 3 * * *", "0 9 * * 1-5", "0 9 * * 1", "0 4 1 * *", "@daily", "@midnight", "@hourly", "@weekly", "@monthly"]) {
      expect(() => parseSchedule(ok), ok).not.toThrow();
    }
    expect(parseSchedule("@daily").expression).toBe("0 0 * * *");
    for (const bad of ["0 9 * * MON", "0 0 L * *", "0 0 * * * *", "@yearly", "0 9 1 * 1", "*/2 * * * *"]) {
      expect(() => parseSchedule(bad), bad).toThrow(ScheduleError);
    }
    expect(() => parseSchedule("*/5 * * * *")).not.toThrow();
    expect(out).toContain("Both a day of the month and a day of the week are set");
  });

  it("names the card and the dashboard routes, and keeps them out of the public API page", () => {
    const card = read("web/src/components/scheduled-jobs-card.tsx");
    for (const label of ["Scheduled Jobs", "Run now", "Pause", "Resume", "Add job", "No jobs yet.", "Common schedules"]) {
      expect(card, label).toContain(label);
      expect(out, label).toContain(label);
    }
    for (const route of ["GET /api/projects/:id/jobs", "POST /api/projects/:id/jobs", "PATCH /api/projects/:id/jobs/:jobId", "DELETE /api/projects/:id/jobs/:jobId", "POST /api/projects/:id/jobs/:jobId/run", "GET /api/projects/:id/jobs/:jobId/logs"]) {
      expect(out, route).toContain(route);
    }
    expect(html("api")).not.toContain("/jobs");
  });
});

describe("deleting a project and password sign-in", () => {
  it("says a delete is refused before the container is touched, and that shared/ is kept", () => {
    const code = read("web/src/server/project-delete.ts");
    expect(code).toContain("A deployment is still running for this project.");
    expect(code).toContain('["queued", "building", "deploying"]');
    expect(read("web/src/server/cleanup-guards.ts")).toContain("Cleanup is in progress for this project. Wait for it to finish or retry it before making changes.");
    const out = html("projects");
    expect(out).toContain("answers 409 before it touches anything on the container");
    expect(out).toContain("new deployments for the project are refused too");
    expect(out).toContain("~/.egg/NAME/shared");
  });

  it("gives the 5 minute window for turning on password sign-in", () => {
    expect(REAUTH_WINDOW_MS).toBe(5 * 60_000);
    expect(read("web/src/app/api/account/password/route.ts")).toContain("REAUTH_WINDOW_MS");
    expect(html("account")).toContain("Turning on password sign-in needs a sign-in in the last 5 minutes.");
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
    // Nothing is built on the server: the worker starts with the rest and has no Docker socket.
    const compose = read("compose.yaml");
    expect(compose).toMatch(/^ {2}worker:$/m);
    expect(compose).not.toContain("profiles:");
    expect(compose).not.toMatch(/^\s+- .*docker\.sock/m);
    expect(read("deploy/.env.example")).not.toMatch(/COMPOSE_PROFILES|BUILD_RUNNER|DOCKER_GID/);
    expect(readme).toContain("Nothing is built on this server.");
    expect(page).toContain("Nothing is built on this server");
    expect(readme).not.toMatch(/BUILD_RUNNER|docker\.sock|DOCKER_GID/);
    expect(page).not.toMatch(/BUILD_RUNNER|docker\.sock|DOCKER_GID/);
    // The numbers in the server security notes match the code.
    expect(JSON_BODY_LIMIT).toBe(256 * 1024);
    expect(readme).toContain("up to 256 KB");
    expect(readme).toContain("20 sign-in attempts a minute");
    expect(readme).toContain("60 requests a minute");
  });
});
