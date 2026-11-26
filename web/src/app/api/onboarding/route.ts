import type { NextRequest } from "next/server";
import { z } from "zod";
import { CHAPTERS, MARK_STATUSES, isChapter, type Chapter } from "@/lib/onboarding-marks";
import { authed, handle, HttpError, ok, readJson } from "@/server/http";
import { clearMarks, getMarks, setMark } from "@/server/onboarding";

/** Only a chapter and a status are accepted. Nothing else is stored. */
const markBody = z
  .object({
    chapter: z.enum(CHAPTERS, "Pick one of the tour chapters in the list"),
    status: z.enum(MARK_STATUSES, "Pick done, skipped or paused"),
  })
  .strict();

/** The signed-in person's tour marks. Never cached. */
export const GET = handle(async () => {
  const user = await authed();
  const res = ok({ marks: await getMarks(user.id) });
  res.headers.set("Cache-Control", "no-store");
  return res;
});

/** Record one chapter's mark. Same-origin is checked by handle(). */
export const PUT = handle(async (req: NextRequest) => {
  const user = await authed();
  const { chapter, status } = await readJson(req, markBody);
  const marks = await setMark(user.id, chapter, status);
  const res = ok({ marks });
  res.headers.set("Cache-Control", "no-store");
  return res;
});

/**
 * Clear one chapter's mark with ?chapter=, or every mark when there is no chapter ("show me again").
 * An unknown chapter is refused, not treated as "all".
 */
export const DELETE = handle(async (req: NextRequest) => {
  const user = await authed();
  const raw = req.nextUrl.searchParams.get("chapter");
  let chapter: Chapter | undefined;
  if (raw !== null) {
    if (!isChapter(raw)) throw new HttpError(400, "Pick one of the tour chapters in the list", "validation");
    chapter = raw;
  }
  const res = ok({ marks: await clearMarks(user.id, chapter) });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
