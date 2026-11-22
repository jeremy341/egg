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
import { BUILD_TIMEOUT_SECONDS, MIN_CONTAINER_CAP_MB, containerMemoryCapMb, describeBuildFailure } from "@/server/deploy/container-build";
import { MIN_FREE_DISK_MB, evaluatePreflight, type PreflightFacts, type PreflightNeeds } from "@/server/deploy/container-probe";
import { RESERVED_NAMES } from "@/server/domain-policy";
import { STATUS_TTL_MS } from "@/server/service-status";
import { MIN_SAMPLE } from "@/server/stats";
import { MIN_GAP_MINUTES, ScheduleError, parseSchedule } from "@/lib/cron-schedule";
import { REAUTH_WINDOW_MS, SESSION_DAYS } from "@/server/auth/session";
import { LOCAL_PASSWORD_MAX_BYTES, LOCAL_PASSWORD_MIN_CHARS } from "@/server/auth/local-password";
import { LOGIN_ERRORS } from "@/lib/login-errors";
import { LIVE_CARD_STEP, SEGMENTS, fillTokens } from "@/lib/onboarding";
import { CHAPTERS } from "@/lib/onboarding-marks";
import { assertCloneUrl } from "@/server/deploy/build";
import { friendlyConnectError } from "@/server/ssh/connection";
import { probeIssues, type NestProbe } from "@/server/ssh/probe";
import { MAX_SERVERS_PER_USER } from "@/server/servers";
import { JOB_TIMEOUT_SECONDS } from "@/server/deploy/jobs-remote";
import { MAX_JOBS_PER_PROJECT } from "@/server/scheduled-jobs";
import { WORKFLOW_PATH, WORKFLOW_SECRET_LIST, PRODUCTION_ENVIRONMENT } from "@/server/builds/workflow";
import { MAX_ARCHIVE_BYTES } from "@/server/deploy/build";
import { GETTING_STARTED_STEPS } from "./guide-c";
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

describe("Getting started follows the guided tour", () => {
  const out = html("getting-started").replace(/’/g, "'");
  const same = (text: string) => text.replace(/’/g, "'");
  const tourSteps = [...SEGMENTS.flatMap((s) => s.steps), LIVE_CARD_STEP];

  it("has one section for each of the four chapters, in the tour's order", () => {
    expect([...CHAPTERS]).toEqual(["connect", "import", "deploy", "address"]);
    const ids = [...out.matchAll(/<h2[^>]*\sid="(getting-started-[a-z]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(CHAPTERS.map((c) => `getting-started-${c}`));
  });

  // These two keep the tour's title but word the sentence a little differently, because the tour's own
  // sentence points at a link or a popover that a page does not have.
  const ADAPTED = new Set(["Put your app on Nest.", "Add the key in Nest."]);

  it("uses the title of every tour step, and its sentence word for word", () => {
    for (const step of tourSteps) {
      expect(out, step.title).toContain(same(step.title));
      if (ADAPTED.has(step.title)) continue;
      expect(out, step.title).toContain(same(fillTokens(step.body, { port: "N" })));
    }
  });

  it("does not describe a step the tour does not have", () => {
    const titles = new Set(tourSteps.map((s) => s.title));
    for (const steps of Object.values(GETTING_STARTED_STEPS)) {
      for (const s of steps) expect(titles.has(s.title), s.title).toBe(true);
    }
  });

  it("names buttons that exist on the real screens", () => {
    const connect = read("web/src/components/connect-flow.tsx");
    for (const label of ["Create key", "Test connection", "Confirm host key", "Open the Nest dashboard", "Public key", "Nest username"]) {
      expect(connect, label).toContain(label);
      expect(out, label).toContain(label);
    }
    const newProject = read("web/src/components/new-project-flow.tsx");
    for (const label of ["Install the GitHub App", "Public repository URL"]) expect(newProject, label).toContain(label);
    expect(read("web/src/components/project-conflicts.tsx")).toContain("What is already on this container");
    expect(read("web/src/components/domains-view.tsx")).toContain("Add domain");
    expect(read("web/src/components/build-logs.tsx")).toContain("Build Logs");
    for (const label of ["Connect a server", "Install the GitHub App", "Build Logs", "Add domain", "Waiting for DNS"]) {
      expect(out, label).toContain(label);
    }
  });
});

describe("Run Egg yourself and the self-hosting guide", () => {
  const page = html("run-yourself");
  const guide = read("docs/selfhost/README.md");
  const login = read("web/src/app/(auth)/login/page.tsx");
  const scripts = JSON.parse(read("web/package.json")).scripts as Record<string, string>;

  it("gives the numbers from the code", () => {
    expect(REAUTH_WINDOW_MS).toBe(5 * 60_000);
    expect(LOCAL_PASSWORD_MIN_CHARS).toBe(12);
    expect(LOCAL_PASSWORD_MAX_BYTES).toBe(256);
    expect(SESSION_DAYS).toBe(30);
    expect(page).toContain("5 minutes");
    expect(page).toContain("at least 12 characters");
    expect(guide).toContain("at least 12 characters and at most 256 bytes");
    expect(guide).toContain("A sign-in lasts 30 days.");
    expect(guide).toContain("5 minutes");
  });

  it("names the login page labels that the page prints", () => {
    for (const label of ["Set password and sign in", "Sign in on this computer", "Reset with the recovery key", "Continue with Hack Club", "Sign in with a password"]) {
      expect(login, label).toContain(label);
    }
    for (const label of ["Set password and sign in", "Sign in on this computer", "Reset with the recovery key"]) {
      expect(page, label).toContain(label);
      expect(guide, label).toContain(label);
    }
    expect(login).toContain("Choose a password (12 characters minimum)");
    expect(guide).toContain("Choose a password (12 characters minimum)");
    expect(login).toContain("Recovery key from private");
  });

  it("quotes every sign-in message the guide lists", () => {
    for (const code of ["not_configured", "local_recovery", "local_password", "rate_limited", "password_invalid", "local_password_invalid", "local_password_mismatch", "local_password_conflict"]) {
      expect(guide, code).toContain(LOGIN_ERRORS[code]);
    }
  });

  it("describes how the confirmation behaves with and without Hack Club, as the routes do", () => {
    const reauth = read("web/src/app/api/auth/reauth/route.ts");
    // Without Hack Club, local mode and the development sign-in skip the prompt; otherwise it is "not_configured".
    expect(reauth).toMatch(/if \(!hackClubConfigured\(\)\) \{[\s\S]*localModeEnabled\(\)[\s\S]*markFreshAuth[\s\S]*reauth=not_configured/);
    // With Hack Club set up, the callback only accepts the same Hack Club account, so the local owner gets "mismatch".
    expect(read("web/src/app/api/auth/callback/route.ts")).toContain('back("mismatch", "/account")');
    expect(guide).toContain("?reauth=not_configured");
    expect(guide).toContain("?reauth=mismatch");
    // Nothing on the account page reads the query, which the guide says too.
    expect(read("web/src/app/(app)/account/page.tsx")).not.toMatch(/reauth/);
  });

  it("says email and password sign-in cannot be turned on without Hack Club, because of these rules", () => {
    const route = read("web/src/app/api/account/password/route.ts");
    expect(route).toContain("Confirm with Hack Club first. Turning on password sign-in needs a sign-in in the last");
    expect(route).toContain('user.hackClubId.startsWith("local:")');
    expect(route).toContain("Your account does not share an email address, so a password cannot be used to sign in.");
    expect(guide).toContain("Your account does not share an email address, so a password cannot be used to sign in.");
    expect(guide).toContain("cannot be turned on");
    // The only accounts made without Hack Club have no email: the local owner and the development accounts.
    expect(read("web/src/app/api/auth/local/route.ts")).toContain('name: "Owner", email: null');
    expect(read("web/src/app/api/auth/dev/route.ts")).toContain("email: null");
    expect(page).toContain("cannot be turned on without Hack Club");
  });

  it("matches the config checks it quotes", () => {
    const config = read("web/src/server/config.ts");
    for (const text of [
      "LOCAL_MODE requires a private LOCAL_MODE_SECRET.",
      "LOCAL_MODE signs anyone in as the owner, so APP_URL must be localhost or 127.0.0.1.",
      "LOCAL_MODE_SECRET must be at least 32 characters",
      "APP_SECRET must be at least 32 characters",
    ]) {
      expect(config, text).toContain(text);
      expect(guide, text).toContain(text);
    }
    expect(config).toContain('Expected 0, 1, true or false');
    expect(guide).toContain('LOCAL_MODE: Expected 0, 1, true or false');
  });

  it("gives the defaults the code has", () => {
    const config = read("web/src/server/config.ts");
    expect(config).toContain('NEST_HOST: z.string().default("hackclub.app")');
    expect(config).toContain("NEST_PORT: z.coerce.number().int().positive().default(22)");
    expect(config).toContain('UNIT_DIR: z.string().default("/etc/systemd/system")');
    expect(config).toContain('DEPLOY_WORK_DIR: z.string().default("./data/work")');
    expect(guide).toMatch(/\| `NEST_HOST` \| `hackclub\.app` \|/);
    expect(guide).toMatch(/\| `NEST_PORT` \| `22` \|/);
    expect(guide).toMatch(/\| `UNIT_DIR` \| `\/etc\/systemd\/system` \|/);
    expect(guide).toMatch(/\| `DEPLOY_WORK_DIR` \| `\.\/data\/work` \|/);
    expect(read("web/src/server/retention.ts")).toContain("Number(raw ?? 90)");
    expect(read("web/src/server/retention.ts")).toContain("value <= 3650");
    expect(guide).toMatch(/\| `DEPLOY_LOG_RETENTION_DAYS` \| `90` \|/);
    expect(read("web/src/server/monitor.ts")).toContain("export const MONITOR_CONCURRENCY = 4;");
    expect(guide).toMatch(/\| `MONITOR_CONCURRENCY` \| `4` \|/);
  });

  it("only names commands, scripts and files that exist", () => {
    for (const name of ["setup", "egg", "doctor", "fake-nest", "seed:demo", "service:install", "service:remove", "compose:up", "backup", "worker"]) {
      expect(Object.keys(scripts), name).toContain(name);
    }
    expect(read("web/scripts/setup.mjs")).toContain("LOCAL_MODE_SECRET=");
    expect(read("web/scripts/create-github-app.mjs")).toContain('process.env.APP_URL ?? "http://localhost:3100"');
    expect(read("web/scripts/create-github-app.mjs")).toContain('String(app.webhook_secret || webhookSecret)');
    expect(guide).toContain("reads `APP_URL` from `web/.env.local`");
    expect(page).toContain("pnpm fake-nest");
    expect(page).toContain("pnpm egg start");
  });

  it("describes the deploy target the way the probe and the pipeline treat it", () => {
    const probe = (patch: Partial<Omit<NestProbe, "has">> & { has?: Partial<NestProbe["has"]> } = {}): NestProbe => ({
      uid: 0, os: "x", arch: "x", home: "/root", systemdState: "running",
      nodeVersion: "v22.13.0", pythonVersion: null, cpus: 2, memTotalMb: 2048, memUsedMb: 100, diskTotalMb: 10_000, diskUsedMb: 100, load1: 0,
      ...patch,
      has: { systemctl: true, node: true, npm: true, python3: true, tar: true, curl: true, git: true, sha256sum: true, ...patch.has },
    });
    const messages = [
      ...probeIssues(probe({ systemdState: "unavailable" })),
      ...probeIssues(probe({ uid: 1000 })),
      ...probeIssues(probe({ has: { tar: false } })),
    ].map((i) => i.message);
    expect(messages).toHaveLength(3);
    for (const m of messages) expect(guide, m).toContain(m);
    expect(probeIssues(probe({ systemdState: "unavailable" }))[0].level).toBe("error");
    expect(probeIssues(probe({ uid: 1000 }))[0].level).toBe("warning");
    expect(probeIssues(probe({ has: { curl: false, sha256sum: false } })).every((i) => i.level === "warning")).toBe(true);
    expect(friendlyConnectError(new Error("All configured authentication methods failed")).message).toContain("Nest rejected the key. Check that you pasted the public key");
    expect(guide).toContain("Nest rejected the key. Check that you pasted the public key");
    // System units, no sudo, no user services, no linger.
    const remote = read("web/src/server/deploy/remote.ts");
    expect(remote).not.toMatch(/systemctl --user|loginctl|sudo /);
    expect(read("web/src/server/deploy/layout.ts")).toContain('DEFAULT_UNIT_DIR = "/etc/systemd/system"');
    expect(remote).toContain("Environment=HOST=0.0.0.0");
    expect(MIN_FREE_DISK_MB).toBe(2048);
    expect(guide).toContain("At least 2048 MB of free disk");
  });

  it("says only github.com repositories can be cloned, with the message the code gives", () => {
    let message = "";
    try {
      assertCloneUrl("https://gitlab.com/owner/name");
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe("Repositories on gitlab.com are not supported yet. Supported: github.com.");
    expect(guide).toContain(message.replace("gitlab.com", "HOST"));
  });

  it("gives the GitHub App settings the code and the manifest script use", () => {
    const script = read("web/scripts/create-github-app.mjs");
    expect(script).toContain('contents: "read"');
    expect(script).toContain('metadata: "read"');
    expect(script).toContain('pull_requests: "write"');
    expect(script).toContain('default_events: ["push", "pull_request"]');
    expect(script).toContain("request_oauth_on_install: true");
    expect(script).toContain("setup_on_update: true");
    expect(script).toContain("/api/github/callback");
    expect(read("web/src/server/github/app.ts")).toContain("/api/github/callback");
    expect(read("web/src/app/api/webhooks/github/route.ts")).toContain("GITHUB_WEBHOOK_SECRET");
    expect(read("web/src/server/config.ts")).toMatch(/c\.GITHUB_APP_ID &&\s+c\.GITHUB_APP_PRIVATE_KEY &&\s+c\.GITHUB_APP_CLIENT_ID &&\s+c\.GITHUB_APP_CLIENT_SECRET &&\s+c\.GITHUB_WEBHOOK_SECRET/);
    expect(guide).toContain("<APP_URL>/api/github/callback");
    expect(guide).toContain("<APP_URL>/api/webhooks/github");
    expect(MAX_SERVERS_PER_USER).toBe(5);
    expect(guide).toContain("up to 5 servers");
  });
});

describe("the Build with GitHub Actions and Build on Nest pages", () => {
  const actions = html("build-github-actions").replace(/&#x27;/g, "'");
  const nest = html("build-on-nest");
  const token = read("web/src/server/builds/token.ts");
  const uploads = read("web/src/server/builds/uploads.ts");
  const check = read("web/src/server/builds/connection-check.ts");
  const workflow = read("web/src/server/builds/workflow.ts");

  it("states the limits the setup steps show, from the constants the server enforces", () => {
    expect(MAX_ARCHIVE_BYTES).toBe(500 * 1024 * 1024);
    expect(actions).toContain("500 MiB (524,288,000 bytes)");
    expect(uploads).toContain("export const UPLOAD_WAIT_MS = 60 * 60_000;");
    expect(actions).toContain("60 minutes");
    expect(token).toContain("export const BUILD_CREDENTIAL_TTL_MS = 90 * 24 * 60 * 60 * 1000;");
    expect(actions).toContain("90 days");
    expect(uploads).toContain('"GitHub did not send the build in time. Check the workflow run, then deploy again."');
    expect(actions).toContain("GitHub did not send the build in time. Check the workflow run, then deploy again.");
  });

  it("names the file, the environment and every secret with where it is saved", () => {
    expect(actions).toContain(WORKFLOW_PATH);
    expect(actions).toContain(PRODUCTION_ENVIRONMENT);
    for (const s of WORKFLOW_SECRET_LIST) {
      const row = new RegExp(`${s.name}</code></td><td[^>]*>${s.store === "environment" ? "The egg-production environment" : "Repository secrets"}<`);
      expect(actions, s.name).toMatch(row);
    }
  });

  it("says the workflow runs on pushes and by hand, not on pull requests", () => {
    expect(workflow).toContain("  push:");
    expect(workflow).toContain("  workflow_dispatch:");
    expect(workflow).not.toContain("pull_request:");
    expect(actions).toContain("not on pull requests");
    expect(actions).toContain("never runs it and never receives a secret");
  });

  it("explains each of the six connection checks by the label Egg prints, and the three app permissions", () => {
    for (const label of ["Build location", "Build credentials", "GitHub app", "Repository access", "Workflow file", "Workflow settings"]) {
      expect(check, label).toMatch(new RegExp(`"${label}"`));
      expect(actions, label).toContain(label);
    }
    for (const permission of ["Contents", "Pull requests", "Workflows"]) expect(actions, permission).toContain(permission);
    expect(actions).toContain("read and write");
  });

  it("gives the Nest build caps the way the code does", () => {
    expect(BUILD_TIMEOUT_SECONDS).toBe(15 * 60);
    expect(nest).toContain("15 minutes");
    expect(nest).toContain("minus 512 MB");
    expect(nest).toContain("768 MB");
    expect(MIN_CONTAINER_CAP_MB).toBe(256);
  });

  it("uses no em or en dashes", () => {
    expect(actions + nest).not.toMatch(/[–—]/);
  });
});

describe("the self-hosting guide: request limits, GitHub Actions credentials and variable storage", () => {
  const guide = read("docs/selfhost/README.md");
  const caddy = read("deploy/Caddyfile");

  it("gives the request size limits that deploy/Caddyfile sets", () => {
    for (const [path, size] of [["/api/builds/upload", "500MiB"], ["files/write", "50MiB"], ["/api/webhooks/github", "5MiB"], ["/api/security-reports", "5MiB"]]) {
      const block = caddy.slice(caddy.indexOf(path));
      expect(block, path).toContain(`max_size ${size}`);
    }
    expect(caddy).toMatch(/request_body @small \{\s+max_size 1MiB/);
    for (const row of ["| Every path not listed below | 1 MiB |", "| `/api/builds/upload` (a release sent from GitHub Actions) | 500 MiB |", "| `/api/projects/<id>/files/write` (file uploads) | 50 MiB |", "| `/api/webhooks/github` | 5 MiB |", "| `/api/security-reports` | 5 MiB |"]) {
      expect(guide, row).toContain(row);
    }
  });

  it("gives the import limits from the code", () => {
    expect(read("web/src/server/adoption-import.ts")).toContain("export const IMPORT_MAX_COPY_MB = 2048;");
    expect(MIN_FREE_DISK_MB).toBe(2048);
    expect(guide).toContain("over 2048 MB");
    expect(guide).toContain("under 2048 MB free");
  });

  it("names the four build credentials and the environment as the workflow does", () => {
    const workflow = read("web/src/server/builds/workflow.ts");
    for (const name of ["EGG_UPLOAD_PRODUCTION_TOKEN", "EGG_ENV_PRODUCTION_TOKEN", "EGG_UPLOAD_PREVIEW_TOKEN", "EGG_ENV_PREVIEW_TOKEN", 'PRODUCTION_ENVIRONMENT = "egg-production"']) {
      expect(workflow, name).toContain(name);
    }
    for (const name of ["EGG_UPLOAD_PRODUCTION_TOKEN", "EGG_ENV_PRODUCTION_TOKEN", "EGG_UPLOAD_PREVIEW_TOKEN", "EGG_ENV_PREVIEW_TOKEN", "egg-production"]) {
      expect(guide, name).toContain(name);
      expect(html("github"), name).toContain(name);
    }
  });

  it("describes where runtime variables are stored, and warns about /.env on public static sites", () => {
    const layout = read("web/src/server/deploy/layout.ts");
    expect(layout).toContain("`env/<release id>.env` is one release's file (mode 600, folder mode 700)");
    expect(layout).toContain("`current.env` is a link");
    expect(guide).toContain("<project>/env/<release id>.env");
    expect(guide).toContain("from `/.env`");
    expect(html("run-yourself")).toContain("/.env");
    const runtime = read("web/src/server/deploy/runtime.ts");
    expect(runtime).toContain("Only GET and HEAD are answered.");
    expect(runtime).toContain("python3 -c ${shellQuote(STATIC_PYTHON_SCRIPT)} ${port}");
  });
});
