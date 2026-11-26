/** True when a database error is a unique-index violation (also looks through `cause`). */
export function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err;
  for (let i = 0; i < 4 && e; i++) {
    const msg = String((e as { message?: unknown }).message ?? "");
    const code = String((e as { code?: unknown }).code ?? "");
    if (/UNIQUE constraint failed/i.test(msg) || code === "SQLITE_CONSTRAINT_UNIQUE") return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
