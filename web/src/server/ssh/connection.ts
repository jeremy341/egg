import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
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

/** How long a stopped command (TERM sent) may keep its channel open before it is force-closed. */
const STOP_GRACE_MS = 30_000;

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
  /** Retain only this many bytes per stream as a diagnostic tail. */
  outputTailBytes?: number;
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
        const outDecoder = new StringDecoder("utf8");
        const errDecoder = new StringDecoder("utf8");
        const lineBuffers = { stdout: "", stderr: "" };
        const dropping = { stdout: false, stderr: false };
        const droppingTail = { stdout: false, stderr: false };
        let settled = false;
        let timer: NodeJS.Timeout | undefined;
        let grace: NodeJS.Timeout | undefined;
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
          // child is still modifying the project. But a remote process that
          // ignores TERM (or a grandchild holding the channel open) must not
          // wedge the awaited promise forever: after a grace period the channel
          // is force-closed and the caller learns the command could not be
          // confirmed stopped.
          stream.signal?.("TERM");
          grace = setTimeout(() => {
            if (settled) return;
            stream.close();
            finish(255);
          }, STOP_GRACE_MS);
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

        const flush = (text: string, which: "stdout" | "stderr", final = false) => {
          if (!opts.onLine) return;
          const parts = text.split("\n");
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!dropping[which]) {
              if (lineBuffers[which].length + part.length > 16_384) {
                lineBuffers[which] = "";
                dropping[which] = true;
              } else lineBuffers[which] += part;
            }
            if (i < parts.length - 1 || final) {
              if (dropping[which]) opts.onLine("[Oversized log line omitted]", which);
              else {
                const line = lineBuffers[which].replace(/\r$/, "");
                if (line) opts.onLine(line, which);
              }
              lineBuffers[which] = "";
              dropping[which] = false;
            }
          }
        };
        const retain = (old: string, value: string, which: "stdout" | "stderr") => {
          if (opts.outputTailBytes === undefined) return old + value;
          const limit = Math.max(0, Math.floor(opts.outputTailBytes));
          if (droppingTail[which]) {
            const newline = value.indexOf("\n");
            if (newline < 0) return old;
            droppingTail[which] = false;
            value = value.slice(newline + 1);
          }
          const bytes = Buffer.from(old + value);
          if (bytes.length <= limit) return bytes.toString("utf8");
          // Never retain the suffix of a clipped line: it might be part of a
          // secret and would no longer match the logger's full-secret mask.
          const newline = bytes.indexOf(10, bytes.length - limit);
          if (newline < 0) { droppingTail[which] = true; return ""; }
          return bytes.subarray(newline + 1).toString("utf8");
        };

        const finish = (code: number) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (grace) clearTimeout(grace);
          opts.signal?.removeEventListener("abort", onAbort);
          if (stopError) {
            reject(stopError);
            return;
          }
          const outEnd = outDecoder.end();
          const errEnd = errDecoder.end();
          stdout = retain(stdout, outEnd, "stdout");
          stderr = retain(stderr, errEnd, "stderr");
          flush(outEnd, "stdout", true);
          flush(errEnd, "stderr", true);
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
          const s = outDecoder.write(d);
          stdout = retain(stdout, s, "stdout");
          flush(s, "stdout");
        });
        stream.stderr.on("data", (d: Buffer) => {
          overflow(d.length);
          if (settled || stopError) return;
          const s = errDecoder.write(d);
          stderr = retain(stderr, s, "stderr");
          flush(s, "stderr");
        });
        stream.on("close", (code: number | null) => finish(code ?? 255));
        stream.on("error", (e: Error) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          if (grace) clearTimeout(grace);
          opts.signal?.removeEventListener("abort", onAbort);
          // The channel is gone, so the local read stream piped into it must be
          // dropped too, or it holds its fd open until garbage collection.
          opts.stdinStream?.destroy();
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
