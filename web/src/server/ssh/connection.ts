import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import { Client, type ConnectConfig } from "ssh2";
import { fingerprintOfBlob } from "@/server/ssh/keys";
import { openShellOnClient, type ShellHandle, type ShellOptions } from "@/server/ssh/shell";

export class SshError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "auth"
      | "network"
      | "host-key"
      | "timeout"
      | "exec"
      | "protocol",
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "SshError";
  }
}

const DEFAULT_MAX_OUTPUT_BYTES = 128 * 1024 * 1024;

export type ExecResult = { code: number; stdout: string; stderr: string };

export type ExecOptions = {
  /** Text written to the command's stdin. */
  stdin?: string | Buffer;
  /** Stream to pipe into stdin instead (for uploads). */
  stdinStream?: Readable;
  timeoutMs?: number;
  /** Abort a remote command when its owning job is canceled or loses its lease. */
  signal?: AbortSignal;
  /**
   * Most bytes of stdout plus stderr to keep. A container is the user's own
   * machine, so it can print without end; past this the command is cut off
   * and the call fails. Default 128 MB, room for a 50 MB file sent as base64.
   */
  maxOutputBytes?: number;
  /** Called with each line of stdout/stderr as it arrives. */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
};

export type ConnectOptions = {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  /** SHA256:... of the host key we saw last time. Mismatch aborts. */
  pinnedHostKey?: string | null;
  readyTimeoutMs?: number;
};

export function friendlyConnectError(err: unknown): SshError {
  if (err instanceof SshError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (
    lower.includes("all configured authentication methods failed") ||
    lower.includes("authentication")
  ) {
    return new SshError(
      "Nest rejected the key. Check that you pasted the public key on the SSH Keys page of the Nest dashboard, and that the username is exactly your Nest username.",
      "auth",
      { cause: err }
    );
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return new SshError(
      "Timed out connecting to Nest. Your container may be stopped or starting; try again in a minute.",
      "timeout",
      { cause: err }
    );
  }
  if (
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("ehostunreach") ||
    lower.includes("econnreset")
  ) {
    return new SshError(
      `Could not reach the Nest SSH host (${message}).`,
      "network",
      { cause: err }
    );
  }
  return new SshError(`SSH error: ${message}`, "protocol", { cause: err });
}

/** One live SSH connection to a Nest container (through the bastion). */
export class NestSession {
  private constructor(
    private readonly client: Client,
    readonly hostKeyFingerprint: string
  ) {}

  /** Called only after the transport confirms closure, including remote closure. */
  onClosed(callback: () => void): void {
    this.client.once("close", callback);
  }

  static async connect(opts: ConnectOptions): Promise<NestSession> {
    const client = new Client();
    let seenHostKey = "";

    const cfg: ConnectConfig = {
      host: opts.host,
      port: opts.port,
      username: opts.username,
      privateKey: opts.privateKey,
      readyTimeout: opts.readyTimeoutMs ?? 20000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 4,
      // Only ever offer the one key we were given.
      agent: undefined,
      tryKeyboard: false,
      hostVerifier: (key: Buffer) => {
        seenHostKey = fingerprintOfBlob(key);
        if (opts.pinnedHostKey && opts.pinnedHostKey !== seenHostKey) {
          return false;
        }
        return true;
      },
    };

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        client.removeListener("ready", onReady);
        if (opts.pinnedHostKey && seenHostKey && seenHostKey !== opts.pinnedHostKey) {
          reject(
            new SshError(
              `The host key of ${opts.host} changed (was ${opts.pinnedHostKey}, now ${seenHostKey}). Nothing was sent. If you expected this, reconnect the server.`,
              "host-key",
              { cause: err }
            )
          );
          return;
        }
        reject(friendlyConnectError(err));
      };
      const onReady = () => {
        client.removeListener("error", onError);
        resolve();
      };
      client.once("error", onError);
      client.once("ready", onReady);
      client.connect(cfg);
    });

    // Later errors (resets, keepalive failures) must not crash the process.
    client.on("error", () => {});

    return new NestSession(client, seenHostKey);
  }

  /** Run a command. Resolves with the exit code; rejects only on transport failure. */
  exec(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(new SshError("Command canceled", "exec"));
        return;
      }
      this.client.exec(command, (err, stream) => {
        if (err) {
          reject(friendlyConnectError(err));
          return;
        }

        let stdout = "";
        let stderr = "";
        let outBuf = "";
        let errBuf = "";
        let settled = false;
        let timer: NodeJS.Timeout | undefined;
        let received = 0;
        let stopError: SshError | null = null;
        const requestStop = (error: SshError) => {
          if (settled || stopError) return;
          stopError = error;
          if (timer) clearTimeout(timer);
          opts.signal?.removeEventListener("abort", onAbort);
          opts.stdinStream?.destroy();
          // Keep the SSH channel open until the server reports command exit.
          // Closing it immediately could release the queue guard while a remote
          // child is still modifying the project.
          stream.signal?.("TERM");
        };
        const onAbort = () => {
          requestStop(new SshError("Command canceled", "exec"));
        };
        const cap = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
        const overflow = (n: number) => {
          received += n;
          if (received <= cap || settled || stopError) return;
          requestStop(new SshError("The container printed more output than Egg will read.", "exec"));
        };

        const flush = (buf: string, which: "stdout" | "stderr", final: boolean) => {
          if (!opts.onLine) return buf;
          const parts = buf.split(/\r?\n/);
          const rest = final ? "" : (parts.pop() ?? "");
          for (const line of parts) {
            if (line.length > 0) opts.onLine(line, which);
          }
          if (final && rest) opts.onLine(rest, which);
          return rest;
        };

        const finish = (code: number) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          opts.signal?.removeEventListener("abort", onAbort);
          if (stopError) {
            reject(stopError);
            return;
          }
          flush(outBuf, "stdout", true);
          flush(errBuf, "stderr", true);
          resolve({ code, stdout, stderr });
        };

        if (opts.timeoutMs) {
          timer = setTimeout(() => {
            if (settled) return;
            requestStop(
              new SshError(
                `Command timed out after ${Math.round(opts.timeoutMs! / 1000)}s`,
                "timeout"
              )
            );
          }, opts.timeoutMs);
        }

        stream.on("data", (d: Buffer) => {
          overflow(d.length);
          if (settled || stopError) return;
          const s = d.toString("utf8");
          stdout += s;
          outBuf = flush(outBuf + s, "stdout", false);
        });
        stream.stderr.on("data", (d: Buffer) => {
          overflow(d.length);
          if (settled || stopError) return;
          const s = d.toString("utf8");
          stderr += s;
          errBuf = flush(errBuf + s, "stderr", false);
        });
        stream.on("close", (code: number | null) => finish(code ?? 255));
        stream.on("error", (e: Error) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          opts.signal?.removeEventListener("abort", onAbort);
          reject(friendlyConnectError(e));
        });

        // Install the close/error handlers before honoring an abort that raced
        // channel creation, so the promise always observes the channel exit.
        opts.signal?.addEventListener("abort", onAbort, { once: true });
        if (opts.signal?.aborted) {
          onAbort();
          return;
        }

        if (opts.stdinStream) {
          opts.stdinStream.pipe(stream);
        } else if (opts.stdin !== undefined) {
          stream.end(opts.stdin);
        } else {
          stream.end();
        }
      });
    });
  }

  /** Run a shell script by feeding it to `bash -s`, avoiding any quoting. */
  script(body: string, opts: Omit<ExecOptions, "stdin" | "stdinStream"> = {}) {
    return this.exec("bash -s", { ...opts, stdin: body });
  }

  /**
   * Upload a local file by piping it into `cat`. Uses only an exec channel, so
   * it works even if the bastion does not forward SFTP.
   */
  async uploadFile(localPath: string, remotePath: string, opts: { signal?: AbortSignal } = {}): Promise<void> {
    const result = await this.exec(
      `cat > ${shellQuote(remotePath)}.partial && mv ${shellQuote(remotePath)}.partial ${shellQuote(remotePath)}`,
      { stdinStream: createReadStream(localPath), timeoutMs: 10 * 60_000, signal: opts.signal }
    );
    if (result.code !== 0) {
      throw new SshError(
        `Upload failed (exit ${result.code}): ${result.stderr.trim() || "no output"}`,
        "exec"
      );
    }
  }

  async writeFile(remotePath: string, content: string, mode = "644", opts: { signal?: AbortSignal } = {}) {
    // The mode goes into the command line, so it must be octal digits and nothing else.
    if (!/^[0-7]{3,4}$/.test(mode)) throw new SshError("Invalid file mode", "exec");
    const result = await this.exec(
      `umask 077 && cat > ${shellQuote(remotePath)} && chmod ${mode} ${shellQuote(remotePath)}`,
      { stdin: content, signal: opts.signal }
    );
    if (result.code !== 0) {
      throw new SshError(
        `Could not write ${remotePath}: ${result.stderr.trim()}`,
        "exec"
      );
    }
  }

  /**
   * Open an interactive shell (a PTY) that starts in `opts.cwd`. The handle
   * reports when the shell ends or this connection drops.
   */
  async openShell(opts: ShellOptions): Promise<ShellHandle> {
    try {
      return await openShellOnClient(this.client, opts);
    } catch (err) {
      throw friendlyConnectError(err);
    }
  }

  close() {
    this.client.end();
  }
}

/** POSIX single-quote escaping for values interpolated into shell commands. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
