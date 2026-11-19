import { authed, handle } from "@/server/http";
import { getDb, schema } from "@/server/db";
import { deploymentLogs, readableDeployment } from "@/server/projects";
import { SESSION_COOKIE, userForSessionToken } from "@/server/auth/session";
import { takeDeploymentStream } from "@/server/deployment-streams";
import { eq } from "drizzle-orm";

type Ctx = { params: Promise<{ id: string }> };
const FINISHED = new Set(["ready", "error", "canceled"]);
const PAGE_SIZE = 100;
const MAX_AGE_MS = 15 * 60_000;
const POLL_MS = 750;

/** Server-sent events, with a bounded page buffered only as the client reads. A few streams per user at once. */
export const GET = handle<Ctx>(async (req, { params }) => {
  const user = await authed();
  const { id } = await params;
  await readableDeployment(user.id, id);
  // The slot is held until the stream ends (finished, canceled, or the 15-minute deadline) or the route throws.
  const releaseStream = takeDeploymentStream(user.id);
  let streamHeld = true;
  const freeStream = () => {
    if (!streamHeld) return;
    streamHeld = false;
    releaseStream();
  };
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    let after = Math.max(0, Number(req.nextUrl.searchParams.get("after") ?? 0) || 0);
    const encoder = new TextEncoder();
    const deadline = Date.now() + MAX_AGE_MS;
    const db = await getDb();
    let canceled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let wake: (() => void) | undefined;
    let page: Awaited<ReturnType<typeof deploymentLogs>> = [];
    let finalState: { state: string; error: string | null } | null = null;
    let lastKeepalive = Date.now();
    let lastAuthorization = 0;
    let closeStream: (() => void) | undefined;
    const cleanup = () => {
      canceled = true;
      freeStream();
      if (timer) clearTimeout(timer);
      if (expiryTimer) clearTimeout(expiryTimer);
      page = [];
      wake?.();
      req.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => { cleanup(); closeStream?.(); };
    req.signal.addEventListener("abort", onAbort, { once: true });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        closeStream = () => { try { controller.close(); } catch { /* Already canceled. */ } };
        expiryTimer = setTimeout(() => { cleanup(); closeStream?.(); }, MAX_AGE_MS);
        if (req.signal.aborted) onAbort();
      },
      async pull(controller) {
        const send = (event: string, data: unknown, eventId?: number) => controller.enqueue(encoder.encode(
          (eventId ? `id: ${eventId}\n` : "") + `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        ));
        try {
          while (!canceled && !req.signal.aborted && Date.now() < deadline) {
            if (page.length && Date.now() - lastAuthorization < 5_000) {
              const line = page.shift()!;
              after = line.id;
              send("log", { id: line.id, at: line.at, level: line.level, message: line.message }, line.id);
              return;
            }
            // Never use React's request-cached identity for a long-lived connection.
            if ((await userForSessionToken(token))?.id !== user.id || canceled) break;
            if (page.length) {
              await readableDeployment(user.id, id);
              if (canceled) break;
              lastAuthorization = Date.now();
              continue;
            }
            page = await deploymentLogs(user.id, id, after, PAGE_SIZE);
            lastAuthorization = Date.now();
            if (canceled) break;
            if (page.length) continue;
            if (finalState) {
              send("state", finalState);
              cleanup();
              controller.close();
              return;
            }
            const row = await db.select({ state: schema.deployments.state, error: schema.deployments.error })
              .from(schema.deployments).where(eq(schema.deployments.id, id)).get();
            if (canceled) break;
            if (!row) break;
            if (FINISHED.has(row.state)) {
              finalState = row;
              continue; // Read again after observing the terminal state, until every page drains.
            }
            if (Date.now() - lastKeepalive >= 15_000) {
              lastKeepalive = Date.now();
              controller.enqueue(encoder.encode(": keepalive\n\n"));
              return;
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
              timer = setTimeout(resolve, Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
            });
            wake = undefined;
            if (timer) clearTimeout(timer);
            timer = undefined;
          }
          cleanup();
          closeStream?.();
        } catch (error) {
          const wasCanceled = canceled;
          cleanup();
          if (!wasCanceled && !req.signal.aborted) controller.error(error);
        }
      },
      cancel() { cleanup(); },
    }, { highWaterMark: 1 });

    return new Response(stream, { headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    } });
  } catch (err) {
    freeStream();
    throw err;
  }
});
