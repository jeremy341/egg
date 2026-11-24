/**
 * Words for the last crash of a service (status and reason only; the output of
 * that run is not kept). Pure, so the logs page and the tests share it.
 */

const REASON_TEXT: Record<string, string> = {
  "exit-code": "exited with an error",
  signal: "was stopped by a signal",
  "core-dump": "crashed and dumped its core",
  "oom-kill": "was killed for using too much memory",
  watchdog: "was stopped by its watchdog",
  timeout: "did not start or stop in time",
  "start-limit-hit": "failed to start too many times in a row",
  resources: "ran out of a system resource",
};

/** A short phrase for systemd's reason. Unknown reasons are shown as they are. */
export function crashReasonText(reason: string): string {
  return REASON_TEXT[reason] ?? `stopped (${reason})`;
}

/** Exit 137 is SIGKILL, which is what the kernel sends when memory runs out. */
export function exitCodeText(code: number | null): string | null {
  if (code === null) return null;
  if (code === 137) return "exit status 137 (killed, usually out of memory)";
  return `exit status ${code}`;
}

/** One sentence for the logs page, for example "Last crash: exit status 137 (killed, usually out of memory), 5 Nov 2026, 10:00." */
export function lastCrashSentence(crash: { at: number; exitCode: number | null; reason: string }, locale = "en-GB"): string {
  const when = new Date(crash.at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const code = exitCodeText(crash.exitCode);
  const how = code ? `${code}, ${crashReasonText(crash.reason)}` : crashReasonText(crash.reason);
  return `The service ${how}. Recorded ${when}.`;
}
