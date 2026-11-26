import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@/server/db";
import { sendTestNotification, setNotifications } from "@/server/notify";
import { useFreshDb } from "@/server/test/db";

let ctx: Awaited<ReturnType<typeof useFreshDb>>;
const now = new Date("2026-11-01T00:00:00Z");

beforeAll(async () => {
  ctx = await useFreshDb();
  await ctx.db.insert(schema.users).values({
    id: "owner", hackClubId: "owner", name: "Owner", email: "owner@example.com", createdAt: now,
  });
  await ctx.db.insert(schema.servers).values({
    id: "s", userId: "owner", nestUsername: "owner", host: "host", publicKey: "pub",
    privateKeyEnc: "sealed", keyFingerprint: "fp", createdAt: now,
  });
  await ctx.db.insert(schema.projects).values({
    id: "p", userId: "owner", serverId: "s", slug: "p", name: "<!channel> & co",
    repoUrl: "https://github.com/a/b", runtime: "node", port: 3000, createdAt: now, updatedAt: now,
  });
});
afterAll(async () => ctx.cleanup());

describe("webhook notification markup", () => {
  it("escapes Slack mention and markup characters in project-controlled text", async () => {
    await setNotifications("owner", "p", { url: "https://hooks.slack.com/services/T000/B000/XXXX" });
    let body = "";
    await sendTestNotification("owner", "p", async (_url, init) => {
      body = String(init.body);
      return new Response("ok", { status: 200 });
    });
    expect(body).not.toContain("<!channel>");
    expect(body).toContain("&lt;!channel&gt;");
    expect(body).toContain("&amp;");
  });
});
