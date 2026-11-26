/**
 * Crash-loop diagnosis: maps the recent log lines of a service that keeps
 * crashing to one likely cause, with one line of advice. Pure. The first cause
 * that matches wins, in this order: import error, connection refused, out of
 * memory (exit 137), never became ready.
 */

export type CrashCause = "import_error" | "connection_refused" | "out_of_memory" | "never_ready";

export type CrashDiagnosis = {
  cause: CrashCause;
  /** The cause in a few words. */
  title: string;
  /** One line of advice. */
  suggestion: string;
  /** The line that matched, when a line did. */
  evidence: string | null;
};

const IMPORT_ERROR =
  /ModuleNotFoundError|ImportError|Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND|No module named|Error: Cannot find module/;
const CONNECTION_REFUSED =
  /ECONNREFUSED|[Cc]onnection refused|could not connect to server|Can't connect to (?:MySQL|MariaDB) server|could not translate host name/;
const NOT_READY = /health check (?:failed|timed out)|did not become ready|never became ready|No healthy response/i;

function firstMatch(lines: string[], pattern: RegExp): string | null {
  // Newest lines first: the last error before a crash is the one that matters.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (pattern.test(lines[i])) return lines[i];
  }
  return null;
}

export function diagnoseCrashLoop(input: {
  /** Recent log lines, oldest first. */
  lines: string[];
  /** The last exit status, when the monitor recorded one. */
  exitCode?: number | null;
  /** systemd's reason, for example oom-kill. */
  reason?: string | null;
  /** True when the health check has been failing while the service restarts. */
  healthFailing?: boolean;
}): CrashDiagnosis | null {
  const { lines } = input;

  const importLine = firstMatch(lines, IMPORT_ERROR);
  if (importLine) {
    return {
      cause: "import_error",
      title: "Import error",
      suggestion:
        "The app loads a module that is not in the image. Check that the build stage that installs dependencies is the one that ships.",
      evidence: importLine,
    };
  }

  const connLine = firstMatch(lines, CONNECTION_REFUSED);
  if (connLine) {
    return {
      cause: "connection_refused",
      title: "Connection refused",
      suggestion:
        "The app cannot reach a service it needs, usually the database. Check the connection setting and that the database is running.",
      evidence: connLine,
    };
  }

  if (input.exitCode === 137 || input.reason === "oom-kill") {
    return {
      cause: "out_of_memory",
      title: "Out of memory",
      suggestion: "The kernel stopped the app for using too much memory. Raise the memory limit or find what grows.",
      evidence: null,
    };
  }

  const readyLine = firstMatch(lines, NOT_READY);
  if (input.healthFailing || readyLine) {
    return {
      cause: "never_ready",
      title: "Never became ready",
      suggestion:
        "The app starts but does not answer its health check in time. Check that it listens on the port you set and that the health path returns a success code.",
      evidence: readyLine,
    };
  }

  return null;
}
