import { authed, handle, ok } from "@/server/http";
import { parseLogLevel, parseLogRange } from "@/lib/log-filter";
import { enforceRateLimit } from "@/server/rate-limit";
import { fetchRuntimeLogPage } from "@/server/runtime-info";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Answers `{ lines, older }`. `older` is a cursor for the lines before these, or
 * null when the journal has none; send it back as `before` to read them.
 * Reads journald over SSH, so the polling is limited per user.
 */
export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  enforceRateLimit("sshSession", user.id);
  const { id } = await params;
  enforceRateLimit("sshCall", user.id);
  const n = Number(req.nextUrl.searchParams.get("lines") ?? 200);
  const lines = Number.isFinite(n) ? Math.min(Math.max(n, 1), 1000) : 200;
  const q = req.nextUrl.searchParams.get("q") ?? "";
  // `range` (1h, 24h, 7d) becomes journalctl --since; `level` is all or problems.
  const range = req.nextUrl.searchParams.has("range")
    ? parseLogRange(req.nextUrl.searchParams.get("range"))
    : undefined;
  const level = parseLogLevel(req.nextUrl.searchParams.get("level"));
  const before = req.nextUrl.searchParams.get("before");
  return ok(await fetchRuntimeLogPage(user.id, id, lines, q, { range, level, before }));
});
