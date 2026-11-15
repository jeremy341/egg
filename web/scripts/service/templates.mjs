// Start-on-login files for macOS (launchd), Linux (systemd user unit) and Windows (Scheduled Task).
// Every function here is pure: paths come in as arguments, text goes out. Nothing is written or run
// here (see install.mjs), so the tests can check the exact text.
//
// All three run `pnpm start` in the web folder. `args` are extra arguments for `next start`,
// such as ["-p", "3100"], so the service listens where APP_URL says. The build must exist first:
// run `pnpm build` (or `pnpm egg start` once) before enabling a service.

import path from "node:path";

export const LAUNCHD_LABEL = "app.egg.web";
export const SYSTEMD_UNIT = "egg";
export const WINDOWS_TASK = "Egg";

const xml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A LaunchAgent. KeepAlive is off: if Egg stops, it stays stopped until the next login. */
export function launchdPlist({ label = LAUNCHD_LABEL, pnpmPath, webDir, logPath, searchPath, args = /** @type {string[]} */ ([]) }) {
  const program = [pnpmPath, "start", ...args].map((a) => `    <string>${xml(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${program}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(webDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(searchPath)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logPath)}</string>
</dict>
</plist>
`;
}

/** systemd treats % and $ specially and splits on spaces, so quote a value for the unit file. */
const unitQuote = (text) => `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;
const unitPercent = (text) => String(text).replace(/%/g, "%%");

/** A systemd user unit. It restarts Egg after a crash, not after you stop it. */
export function systemdUnit({ pnpmPath, webDir, searchPath, args = /** @type {string[]} */ ([]) }) {
  const exec = [pnpmPath, "start", ...args].map(unitQuote).join(" ");
  return `[Unit]
Description=Egg
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${unitPercent(webDir)}
Environment=${unitQuote(`PATH=${searchPath}`)}
ExecStart=${exec}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

/** A PowerShell single-quoted string: the only character to escape is the quote itself. */
const ps = (text) => `'${String(text).replace(/'/g, "''")}'`;

/**
 * A PowerShell script. Run it to register a Scheduled Task that starts `pnpm start` when you sign
 * in; run it with -Remove to delete the task. It needs no administrator rights: the task is for
 * your own account. The task has no time limit (the Windows default would stop it after 72 hours).
 */
export function windowsTaskScript({ webDir, logPath, args = /** @type {string[]} */ ([]), taskName = WINDOWS_TASK }) {
  const command = ["pnpm", "start", ...args].join(" ");
  return `# Registers a Scheduled Task named ${taskName} that starts Egg when you sign in.
#   Install: powershell -ExecutionPolicy Bypass -File <this file>
#   Remove:  powershell -ExecutionPolicy Bypass -File <this file> -Remove
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$taskName = ${ps(taskName)}

if ($Remove) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed the $taskName scheduled task."
  } else {
    Write-Host "There is no $taskName scheduled task."
  }
  return
}

$webDir = ${ps(webDir)}
$log = ${ps(logPath)}
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

$user = "$env:USERDOMAIN\\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c ${command} >> "' + $log + '" 2>&1') -WorkingDirectory $webDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Starts Egg when you sign in.' -Force | Out-Null
Write-Host "Registered the $taskName scheduled task. Egg will start the next time you sign in."
Write-Host "To start it now: Start-ScheduledTask -TaskName $taskName"
Write-Host "To remove it:    Unregister-ScheduledTask -TaskName $taskName -Confirm:\`$false"
`;
}

/** Folders and file names for one OS, and the commands to enable and remove it. */
export function servicePlan({ platform, home, webDir, pnpmPath, nodePath, localAppData, args = /** @type {string[]} */ ([]) }) {
  if (platform === "darwin") {
    const file = path.posix.join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    const logPath = path.posix.join(home, "Library", "Logs", "egg.log");
    const searchPath = unixSearchPath([nodePath, pnpmPath], ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]);
    return {
      platform,
      file,
      content: launchdPlist({ pnpmPath, webDir, logPath, searchPath, args }),
      enable: `launchctl bootstrap gui/$(id -u) ${shellQuote(file)}`,
      stop: `launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL}`,
      logs: logPath,
    };
  }
  if (platform === "linux") {
    const file = path.posix.join(home, ".config", "systemd", "user", `${SYSTEMD_UNIT}.service`);
    const searchPath = unixSearchPath([nodePath, pnpmPath], ["/usr/local/bin", "/usr/bin", "/bin"]);
    return {
      platform,
      file,
      content: systemdUnit({ pnpmPath, webDir, searchPath, args }),
      enable: `systemctl --user enable --now ${SYSTEMD_UNIT}`,
      stop: `systemctl --user disable --now ${SYSTEMD_UNIT}`,
      logs: `journalctl --user -u ${SYSTEMD_UNIT}`,
    };
  }
  if (platform === "win32") {
    const folder = path.win32.join(localAppData, "Egg");
    const file = path.win32.join(folder, "egg-task.ps1");
    const logPath = path.win32.join(folder, "egg.log");
    return {
      platform,
      file,
      content: windowsTaskScript({ webDir, logPath, args }),
      enable: `powershell -ExecutionPolicy Bypass -File "${file}"`,
      stop: `powershell -ExecutionPolicy Bypass -File "${file}" -Remove`,
      logs: logPath,
    };
  }
  return null;
}

const shellQuote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;

/** PATH for a service: the folders of node and pnpm first, then the usual places. */
function unixSearchPath(executables, fallback) {
  const folders = executables.filter(Boolean).map((e) => path.posix.dirname(e));
  return [...new Set([...folders, ...fallback])].join(":");
}
