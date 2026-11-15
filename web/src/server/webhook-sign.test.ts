import { describe, expect, it } from "vitest";
import { newWebhookSecret, signWebhook, SIGNATURE_HEADER, verifyWebhookSignature } from "@/server/webhook-sign";

const SECRET = "whsec_test_secret";
const BODY = '{"event":"deployment.succeeded"}';

describe("webhook signature", () => {
  it("signs the timestamp and body with HMAC-SHA256 (checked against openssl)", () => {
    // printf '%s' '1700000000.{"event":"deployment.succeeded"}' | openssl dgst -sha256 -hmac 'whsec_test_secret'
    expect(signWebhook(SECRET, BODY, 1_700_000_000)).toBe(
      "t=1700000000,v1=ec2157b7a227ff44d17d9aee9c1c0d109531eabb07b95b9210c3694c24cff8c9"
    );
    expect(SIGNATURE_HEADER).toBe("X-NestDeploy-Signature");
  });

  it("verifies a fresh signature and refuses a changed body, timestamp or secret", () => {
    const header = signWebhook(SECRET, BODY, 1_700_000_000);
    expect(verifyWebhookSignature(SECRET, header, BODY, 1_700_000_010)).toBe(true);
    expect(verifyWebhookSignature(SECRET, header, `${BODY} `, 1_700_000_010)).toBe(false);
    expect(verifyWebhookSignature("whsec_other", header, BODY, 1_700_000_010)).toBe(false);
    const moved = header.replace("t=1700000000", "t=1700000001");
    expect(verifyWebhookSignature(SECRET, moved, BODY, 1_700_000_010)).toBe(false);
    expect(verifyWebhookSignature(SECRET, "garbage", BODY, 1_700_000_010)).toBe(false);
  });

  it("refuses a replay older than five minutes", () => {
    const header = signWebhook(SECRET, BODY, 1_700_000_000);
    expect(verifyWebhookSignature(SECRET, header, BODY, 1_700_000_000 + 301)).toBe(false);
  });

  it("makes long random secrets with a recognisable prefix", () => {
    const a = newWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(newWebhookSecret()).not.toBe(a);
  });
});
