import { getDb, schema } from "@/server/db";
import { maskSecrets, secretNeedles } from "@/server/deploy/redact";

export type Level = "info" | "warn" | "error";

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

  constructor(
    private readonly deploymentId: string,
    private readonly flushMs = 250
  ) {}

  setSecrets(values: string[]) {
    this.secrets = secretNeedles(values);
  }

  /** Mask secret values in any text that is about to be stored or shown, such as a deployment's error. */
  mask(message: string) {
    return maskSecrets(message, this.secrets);
  }

  log = (level: Level, message: string) => {
    const clean = this.mask(message).slice(0, 4000);
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
      const db = await getDb();
      await db.insert(schema.deploymentLogs).values(
        batch.map((b) => ({ deploymentId: this.deploymentId, ...b }))
      );
    });
    return this.flushing;
  }
}
