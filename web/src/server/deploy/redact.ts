/**
 * Secret masking for deployment output. Pure, so the build step (which runs
 * before the logger exists) and the logger share one rule.
 */

/** Values shorter than this are masked only as whole tokens, never inside other text. */
const MIN_SECRET = 4;
/** One-character values are not masked: they would garble every log line (CI=1, DEBUG=0). */
const MIN_SHORT = 2;
/** A line of a multi-line secret is masked on its own once it is this long. */
const MIN_LINE = 8;
/**
 * Shifted base64 forms (see `shiftedBase64Forms`) are only made for values at least this long, and only
 * kept when the stable middle is at least this long. Shorter pieces of base64 appear in unrelated
 * text often enough that masking them would hide real log output.
 */
const MIN_SHIFTED = 8;

/**
 * The base64 text a value leaves inside a longer base64 string. The value may start on a 3-byte
 * boundary or one or two bytes past it. A header like `Authorization: Basic base64("user:" + secret)`
 * encodes the secret at such an offset, so the plain base64 form never appears in it. The
 * characters that also depend on the bytes next to the value are cut off, which leaves only text
 * that is the same wherever the value sits. That stable middle is what is masked.
 */
function shiftedBase64Forms(v: string): string[] {
  if (v.length < MIN_SHIFTED) return [];
  const out: string[] = [];
  for (const lead of [0, 1, 2]) {
    const full = Buffer.from("a".repeat(lead) + v, "utf8").toString("base64");
    const tail = (lead + Buffer.byteLength(v, "utf8")) % 3; // bytes in the last, incomplete group
    const body = full.replace(/=+$/, "");
    // Front: 2 characters (1-byte lead) or 3 (2-byte lead) mix in the lead bytes. Back: the last
    // character of an incomplete group holds padding bits that change with the byte that follows.
    const stable = body.slice(lead === 0 ? 0 : lead === 1 ? 2 : 3, tail === 0 ? undefined : body.length - 1);
    if (stable.length < MIN_SHIFTED) continue;
    out.push(stable, stable.replace(/\+/g, "-").replace(/\//g, "_"));
  }
  return out;
}

/** The forms a secret can take when a tool prints or encodes it: base64 (padded, unpadded, URL-safe) and percent-encoded. */
function encodedForms(v: string): string[] {
  const b64 = Buffer.from(v, "utf8").toString("base64");
  const forms = [
    b64,
    b64.replace(/=+$/, ""),
    b64.replace(/\+/g, "-").replace(/\//g, "_"),
    b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    encodeURIComponent(v),
    encodeURIComponent(v).replace(/%20/g, "+"),
    // Other encoders write the hex digits in lower case (%2f), and some also escape ! ' ( ) *.
    encodeURIComponent(v).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()),
    encodeURIComponent(v).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()),
    ...shiftedBase64Forms(v),
  ];
  return forms.filter((f) => f !== v && f.length >= MIN_SECRET);
}

/**
 * The strings to mask for a set of secret values, longest first. Output is
 * cut into lines before it is stored, so a multi-line value (a PEM key, a JSON
 * credential) would never match whole: each of its longer lines is masked too.
 * Base64 and percent-encoded forms of each value are masked as well. A value of
 * two or three characters is kept in the list and masked only where it stands
 * alone (see `maskSecrets`).
 */
export function secretNeedles(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (v.trim().length < MIN_SHORT) continue;
    out.add(v);
    if (v.length < MIN_SECRET) {
      for (const f of encodedForms(v)) out.add(f);
      continue;
    }
    for (const f of encodedForms(v)) out.add(f);
    if (/[\r\n]/.test(v)) {
      for (const line of v.split(/\r?\n/)) {
        const t = line.trim();
        if (t.length >= MIN_LINE) out.add(t);
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const ALNUM = /[A-Za-z0-9]/;

/** Replace a short needle only where it is not part of a longer word or number. */
function maskStandalone(text: string, needle: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i === -1) break;
    const before = i > 0 ? text[i - 1] : "";
    const after = text[i + needle.length] ?? "";
    const standalone = !(before && ALNUM.test(before)) && !(after && ALNUM.test(after));
    out += text.slice(from, i) + (standalone ? "***" : needle);
    from = i + needle.length;
  }
  return out + text.slice(from);
}

/** Replace every occurrence of every needle with `***`. */
export function maskSecrets(text: string, needles: readonly string[]): string {
  let out = text;
  for (const s of needles) {
    out = s.length < MIN_SECRET ? maskStandalone(out, s) : out.split(s).join("***");
  }
  return out;
}
