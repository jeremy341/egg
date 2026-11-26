import { getDb, schema } from "@/server/db";
import { maskSecrets, secretNeedles } from "@/server/deploy/redact";

export type Level = "info" | "warn" | "error";

/** Most rows stored for one deployment; a runaway build gets one "truncated" line instead of more. */
const MAX_LOG_ROWS = 20_000;
const DEFAULT_LOG_BYTES = 4 * 1024 * 1024;
const LIMIT_MESSAGE = "Further log output was dropped: this deployment reached its log limit.";

// ANSI escape sequences, then the remaining control characters (NUL truncates a stored line).
// Only tab and newline are kept. Carriage return is stripped too: in a log viewer it rewinds
// the cursor to column 0, letting a later fragment overwrite earlier text so a build can
// forge its own output (e.g. turn a failed step into an apparent success).
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/**
 * Writes deployment log lines to the database in small batches, so a noisy
 * build does not turn into thousands of single-row inserts. Secret values are
 * masked before anything is stored.
 */
export class DeploymentLogger {
  private buffer: { at: Date; level: Level; message: string }[] = [];
  private timer: NodeJS.Timeout | undefined;
  private flushing: Promise<void> = Promise.resolve();
  private secrets: string[] = [];
  private rows = 0;
  private bytes = 0;
  private warned = false;

  constructor(
    private readonly deploymentId: string,
    private readonly flushMs = 250,
    private readonly maxBytes = DEFAULT_LOG_BYTES
  ) {}

  setSecrets(values: string[]) {
    this.secrets = secretNeedles(values);
  }

  /** Mask secret values in any text that is about to be stored or shown, such as a deployment's error. */
  mask(message: string) {
    return maskSecrets(message, this.secrets);
  }

  log = (level: Level, message: string) => {
    if (this.rows >= MAX_LOG_ROWS || this.bytes >= this.maxBytes) return;
    let clean = this.mask(message).replace(ANSI, "").replace(CONTROL, "").slice(0, 4000);
    const reserve = Buffer.byteLength(LIMIT_MESSAGE);
    if (this.rows + 1 >= MAX_LOG_ROWS || this.bytes + Buffer.byteLength(clean) + reserve > this.maxBytes) {
      level = "warn";
      clean = LIMIT_MESSAGE;
      if (this.bytes + reserve > this.maxBytes) { this.bytes = this.maxBytes; return; }
      this.rows = MAX_LOG_ROWS;
    } else {
      this.rows++;
    }
    this.bytes += Buffer.byteLength(clean);
    this.buffer.push({ at: new Date(), level, message: clean });
    if (this.buffer.length >= 200) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushMs);
    }
  };

  info = (m: string) => this.log("info", m);
  warn = (m: string) => this.log("warn", m);
  error = (m: string) => this.log("error", m);

  /** Wait until everything logged so far is stored. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const batch = this.buffer;
    this.buffer = [];
    if (batch.length === 0) return this.flushing;
    this.flushing = this.flushing.then(async () => {
      const rows = batch.map((b) => ({ deploymentId: this.deploymentId, ...b }));
      // The deployment, project, server or account may have been deleted mid-build, or the
      // database may be busy: try once more, then drop the batch. Logging never throws.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const db = await getDb();
          await db.insert(schema.deploymentLogs).values(rows);
          return;
        } catch (err) {
          if (attempt === 1 && !this.warned) {
            this.warned = true;
            console.warn(`Dropping log lines for deployment ${this.deploymentId}:`, err instanceof Error ? err.message : err);
          }
        }
      }
    });
    return this.flushing;
  }
}
