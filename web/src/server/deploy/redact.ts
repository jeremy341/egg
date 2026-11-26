/**
 * Secret masking for deployment output. Pure, so the build step (which runs
 * before the logger exists) and the logger share one rule.
 */

const MIN_SECRET = 4;
/** A line of a multi-line secret is masked on its own once it is this long. */
const MIN_LINE = 8;

/**
 * The strings to mask for a set of secret values, longest first. Output is
 * cut into lines before it is stored, so a multi-line value (a PEM key, a JSON
 * credential) would never match whole: each of its longer lines is masked too.
 */
export function secretNeedles(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    if (v.length < MIN_SECRET) continue;
    out.add(v);
    if (/[\r\n]/.test(v)) {
      for (const line of v.split(/\r?\n/)) {
        const t = line.trim();
        if (t.length >= MIN_LINE) out.add(t);
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** Replace every occurrence of every needle with `***`. */
export function maskSecrets(text: string, needles: readonly string[]): string {
  let out = text;
  for (const s of needles) out = out.split(s).join("***");
  return out;
}
