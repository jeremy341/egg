import { HttpError } from "@/server/http";

/**
 * Read a request body, refusing more than `maxBytes`. The declared
 * Content-Length is checked first, but a client can lie or use chunked
 * encoding, so the bytes are counted as they arrive and the read stops at the
 * limit. For routes that read a body before anything else has bounded it.
 */
export async function readBytesLimited(req: Request, maxBytes: number): Promise<Buffer> {
  const tooLarge = () => new HttpError(413, "That request is too large.", "too_large");
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!req.body) return Buffer.alloc(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

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
