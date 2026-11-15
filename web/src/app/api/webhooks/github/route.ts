import { NextResponse, type NextRequest } from "next/server";
import { readTextLimited } from "@/server/body-limit";
import { config } from "@/server/config";
import { verifyWebhookSignature } from "@/server/github/app";
import { claimDelivery, handleGithubEvent, releaseDelivery } from "@/server/github/webhook";
import { HttpError } from "@/server/http";

/** GitHub sends payloads of up to 25 MB; nothing larger is read. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;

/**
 * GitHub webhook. Public by design, so the only thing that lets a request in
 * is a valid HMAC signature over the raw body.
 */
export async function POST(req: NextRequest) {
  const secret = config().GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "webhook not configured" }, { status: 503 });
  }
  let raw: string;
  try {
    raw = await readTextLimited(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: "payload too large" }, { status: err.status });
    throw err;
  }
  if (!verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  // Only a request with a valid signature gets this far, so a repeated delivery id is a replay or a retry.
  const delivery = req.headers.get("x-github-delivery");
  if (!claimDelivery(delivery)) {
    return NextResponse.json({ handled: false, deployments: [], note: "duplicate delivery" });
  }
  try {
    const result = await handleGithubEvent(req.headers.get("x-github-event") ?? "", payload);
    return NextResponse.json(result);
  } catch (err) {
    releaseDelivery(delivery);
    console.error("webhook failed", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
