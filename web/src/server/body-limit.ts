import { HttpError } from "@/server/http";

/**
 * Read a request body, refusing more than `maxBytes`. The declared
 * Content-Length is checked first, but a client can lie or use chunked
 * encoding, so the bytes are counted as they arrive and the read stops at the
 * limit. For routes that read a body before anything else has bounded it.
 */
export type ReadBytesOptions = {
  /** Sees each chunk as it arrives, before it is kept (for example to feed an HMAC). */
  onChunk?: (chunk: Uint8Array) => void;
  /** Give up, with 408, when no new bytes arrive for this long. Off unless set. */
  idleTimeoutMs?: number;
  /**
   * Give up, with 408, when the whole body has not arrived within this long. Off unless set.
   * The idle timeout alone does not stop a client that sends one byte at a time.
   */
  deadlineMs?: number;
};

/** Takes a request, or a fetch response when the bytes come from another server (headers and body are all it reads). */
export async function readBytesLimited(req: Pick<Request, "headers" | "body">, maxBytes: number, opts: ReadBytesOptions = {}): Promise<Buffer> {
  const tooLarge = () => new HttpError(413, "That request is too large.", "too_large");
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!req.body) return Buffer.alloc(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const endsAt = opts.deadlineMs ? Date.now() + opts.deadlineMs : null;
  try {
    for (;;) {
      let next: ReadableStreamReadResult<Uint8Array>;
      // Wait for the next chunk no longer than the idle timeout, and never past the overall deadline.
      const left = endsAt === null ? Infinity : endsAt - Date.now();
      if (left <= 0) {
        // Checked here, not only by the timer: a chunk that is already waiting would win the race below every time.
        await reader.cancel().catch(() => {});
        throw new HttpError(408, "The request body arrived too slowly.", "timeout");
      }
      const wait = Math.min(opts.idleTimeoutMs || Infinity, left);
      if (Number.isFinite(wait)) {
        const idle = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new HttpError(408, "The request body arrived too slowly.", "timeout")),
            wait
          );
        });
        try {
          next = await Promise.race([reader.read(), idle]);
        } catch (err) {
          await reader.cancel().catch(() => {});
          throw err;
        } finally {
          clearTimeout(timer);
        }
      } else {
        next = await reader.read();
      }
      const { done, value } = next;
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      opts.onChunk?.(value);
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * Counts requests in flight through a body read and refuses new ones past
 * `max`, so a burst of unauthenticated uploads cannot buffer more than
 * `max` bodies at once. Take a slot with `acquire()`; give it back by calling
 * the returned function, in a `finally`.
 */
export class InFlightLimit {
  private active = 0;

  constructor(readonly max: number) {}

  /** A release function when a slot is free, or null when all are taken. */
  acquire(): (() => void) | null {
    if (this.active >= this.max) return null;
    this.active++;
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.active--;
    };
  }

  get inFlight(): number {
    return this.active;
  }
}

/** Unauthenticated webhook body reads in progress at once. Each can hold up to its route's cap. */
export const webhookBodyReads = new InFlightLimit(4);

/** The same, as UTF-8 text. */
export async function readTextLimited(req: Request, maxBytes: number): Promise<string> {
  return (await readBytesLimited(req, maxBytes)).toString("utf8");
}

/** Default cap for JSON bodies on signed-in routes. File uploads keep their own, larger limits. */
export const JSON_BODY_LIMIT = 256 * 1024;

/**
 * Read a JSON body with a size cap (256 KB unless told otherwise). Over the cap
 * is a 413. Text that is not JSON is a 400, unless `fallback` is given, in which
 * case that value is returned instead (for routes whose body is optional).
 */
export async function readJsonLimited(
  req: Request,
  opts: { maxBytes?: number; fallback?: unknown } = {}
): Promise<unknown> {
  const text = await readTextLimited(req, opts.maxBytes ?? JSON_BODY_LIMIT);
  try {
    return JSON.parse(text);
  } catch {
    if ("fallback" in opts) return opts.fallback;
    throw new HttpError(400, "Request body must be JSON", "bad_json");
  }
}
