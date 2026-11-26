import { describe, expect, it } from "vitest";
import { installService, removeService, stopCommand } from "./install.mjs";
import { launchdPlist, servicePlan, systemdUnit, windowsTaskScript } from "./templates.mjs";

describe("macOS LaunchAgent", () => {
  const plist = launchdPlist({
    pnpmPath: "/opt/homebrew/bin/pnpm",
    webDir: "/Users/ada/egg/web",
    logPath: "/Users/ada/Library/Logs/egg.log",
    searchPath: "/opt/homebrew/bin:/usr/bin",
    args: ["-p", "3100", "-H", "127.0.0.1"],
  });

  it("runs pnpm start in the web folder, once at login, without restarting", () => {
    expect(plist).toContain("<key>Label</key>\n  <string>app.egg.web</string>");
    expect(plist).toContain("<string>/opt/homebrew/bin/pnpm</string>\n    <string>start</string>\n    <string>-p</string>\n    <string>3100</string>");
    expect(plist).toContain("<key>WorkingDirectory</key>\n  <string>/Users/ada/egg/web</string>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(plist).toContain("<key>KeepAlive</key>\n  <false/>");
    expect(plist).toContain("<key>PATH</key>\n    <string>/opt/homebrew/bin:/usr/bin</string>");
  });

  it("sends both outputs to ~/Library/Logs/egg.log", () => {
    expect(plist).toContain("<key>StandardOutPath</key>\n  <string>/Users/ada/Library/Logs/egg.log</string>");
    expect(plist).toContain("<key>StandardErrorPath</key>\n  <string>/Users/ada/Library/Logs/egg.log</string>");
  });

  it("escapes characters that would break the XML", () => {
    const odd = launchdPlist({ pnpmPath: "/p", webDir: "/Users/a&b/<web>", logPath: "/l", searchPath: "/x" });
    expect(odd).toContain("/Users/a&amp;b/&lt;web&gt;");
    expect(odd).not.toContain("a&b");
  });
});

describe("Linux systemd user unit", () => {
  const unit = systemdUnit({ pnpmPath: "/home/ada/.local/share/pnpm/pnpm", webDir: "/home/ada/egg/web", searchPath: "/usr/bin:/bin", args: ["-p", "3100"] });

  it("sets the working directory, the start command and restart on failure", () => {
    expect(unit).toContain("WorkingDirectory=/home/ada/egg/web\n");
    expect(unit).toContain('ExecStart="/home/ada/.local/share/pnpm/pnpm" "start" "-p" "3100"\n');
    expect(unit).toContain("Restart=on-failure\n");
    expect(unit).toContain('Environment="PATH=/usr/bin:/bin"\n');
    expect(unit).toContain("WantedBy=default.target");
  });

  it("quotes paths with spaces and escapes systemd specifiers", () => {
    const odd = systemdUnit({ pnpmPath: "/home/a b/pnpm", webDir: "/home/100%/web", searchPath: "/x$y" });
    expect(odd).toContain('ExecStart="/home/a b/pnpm" "start"');
    expect(odd).toContain("WorkingDirectory=/home/100%%/web");
    expect(odd).toContain('Environment="PATH=/x$$y"');
  });
});

describe("Windows Scheduled Task script", () => {
  const script = windowsTaskScript({
    webDir: "C:\\Users\\Ada\\Documents\\egg\\web",
    logPath: "C:\\Users\\Ada\\AppData\\Local\\Egg\\egg.log",
    args: ["-p", "3100"],
  });

  it("registers a logon task that runs pnpm start from the web folder", () => {
    expect(script).toContain("$webDir = 'C:\\Users\\Ada\\Documents\\egg\\web'");
    expect(script).toContain("New-ScheduledTaskTrigger -AtLogOn");
    expect(script).toContain("-WorkingDirectory $webDir");
    expect(script).toContain("'/c pnpm start -p 3100 >> \"' + $log + '\" 2>&1'");
    expect(script).toContain("Register-ScheduledTask -TaskName $taskName");
  });

  it("has no time limit, needs no administrator, and can remove itself", () => {
    expect(script).toContain("-ExecutionTimeLimit ([TimeSpan]::Zero)");
    expect(script).toContain("-RunLevel Limited");
    expect(script).toContain("param([switch]$Remove)");
    expect(script).toContain("Unregister-ScheduledTask -TaskName $taskName -Confirm:$false");
    // Removing the task must also stop a running copy, or its port stays in use.
    expect(script.indexOf("Stop-ScheduledTask")).toBeGreaterThan(-1);
    expect(script.indexOf("Stop-ScheduledTask")).toBeLessThan(script.indexOf("Unregister-ScheduledTask"));
  });

  it("doubles single quotes in paths", () => {
    const odd = windowsTaskScript({ webDir: "C:\\Users\\O'Neil\\web", logPath: "C:\\l.log" });
    expect(odd).toContain("$webDir = 'C:\\Users\\O''Neil\\web'");
  });
});

describe("service plans", () => {
  const base = { home: "/Users/ada", webDir: "/Users/ada/egg/web", pnpmPath: "/opt/homebrew/bin/pnpm", nodePath: "/opt/homebrew/bin/node", localAppData: "C:\\Users\\Ada\\AppData\\Local" };

  it("puts the macOS file in LaunchAgents and logs in ~/Library/Logs", () => {
    const plan = servicePlan({ ...base, platform: "darwin" })!;
    expect(plan.file).toBe("/Users/ada/Library/LaunchAgents/app.egg.web.plist");
    expect(plan.logs).toBe("/Users/ada/Library/Logs/egg.log");
    expect(plan.content).toContain("/Users/ada/Library/Logs/egg.log");
    expect(plan.enable).toBe("launchctl bootstrap gui/$(id -u) '/Users/ada/Library/LaunchAgents/app.egg.web.plist'");
  });

  it("puts the Linux unit in ~/.config/systemd/user and prints the enable command", () => {
    const plan = servicePlan({ ...base, platform: "linux", home: "/home/ada" })!;
    expect(plan.file).toBe("/home/ada/.config/systemd/user/egg.service");
    expect(plan.enable).toBe("systemctl --user enable --now egg");
  });

  it("puts the Windows script under LocalAppData", () => {
    const plan = servicePlan({ ...base, platform: "win32" })!;
    expect(plan.file).toBe("C:\\Users\\Ada\\AppData\\Local\\Egg\\egg-task.ps1");
    expect(plan.enable).toContain('-File "C:\\Users\\Ada\\AppData\\Local\\Egg\\egg-task.ps1"');
    expect(plan.stop).toMatch(/-Remove$/);
  });

  it("has no plan for other systems", () => {
    expect(servicePlan({ ...base, platform: "freebsd" })).toBeNull();
  });
});

function fakeDeps(over: Record<string, unknown> = {}) {
  const log: string[] = [];
  const written = new Map<string, string>();
  const deps = {
    platform: "linux",
    home: "/home/ada",
    webDir: "/home/ada/egg/web",
    localAppData: "",
    nodePath: "/usr/bin/node",
    findPnpm: () => "/usr/bin/pnpm",
    appUrl: () => "http://localhost:3100",
    existsSync: (p: string) => written.has(p),
    mkdirSync: (p: string) => void log.push(`mkdir ${p}`),
    writeFileSync: (p: string, c: string) => void written.set(p, c),
    rmSync: (p: string) => void written.delete(p),
    run: (command: string, args: string[]) => {
      log.push([command, ...args].join(" "));
      return true;
    },
    out: (t: string) => void log.push(`out ${t}`),
    err: (t: string) => void log.push(`err ${t}`),
    ...over,
  };
  return { deps, log, written };
}

describe("install and remove", () => {
  it("writes the file with APP_URL's port, prints the enable command and starts nothing", () => {
    const { deps, log, written } = fakeDeps();
    expect(installService(deps as never)).toBe(0);
    const content = written.get("/home/ada/.config/systemd/user/egg.service")!;
    expect(content).toContain('ExecStart="/usr/bin/pnpm" "start" "-p" "3100" "-H" "127.0.0.1"');
    expect(log.join("\n")).toContain("systemctl --user enable --now egg");
    expect(log.some((l) => l.startsWith("systemctl"))).toBe(false);
  });

  it("stops the service, then deletes the file", () => {
    const { deps, log, written } = fakeDeps();
    installService(deps as never);
    log.length = 0;
    expect(removeService(deps as never)).toBe(0);
    expect(written.size).toBe(0);
    expect(log[0]).toBe("systemctl --user disable --now egg");
  });

  it("removing when nothing is installed is not an error", () => {
    const { deps, log } = fakeDeps();
    expect(removeService(deps as never)).toBe(0);
    expect(log.join("\n")).toContain("Nothing to remove");
  });

  it("stops with a message when pnpm is missing or the system is unsupported", () => {
    const missing = fakeDeps({ findPnpm: () => null });
    expect(installService(missing.deps as never)).toBe(1);
    expect(missing.log.join("\n")).toContain("pnpm was not found");
    const odd = fakeDeps({ platform: "freebsd" });
    expect(installService(odd.deps as never)).toBe(1);
    expect(odd.written.size).toBe(0);
  });

  it("builds the stop command for each system without a shell", () => {
    expect(stopCommand({ platform: "linux", file: "/f" })).toEqual(["systemctl", "--user", "disable", "--now", "egg"]);
    expect(stopCommand({ platform: "darwin", file: "/f" })[0]).toBe("launchctl");
    expect(stopCommand({ platform: "win32", file: "C:\\egg-task.ps1" }).slice(-2)).toEqual(["C:\\egg-task.ps1", "-Remove"]);
  });
});
