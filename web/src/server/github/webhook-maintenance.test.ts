import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { POST } from "@/app/api/webhooks/github/route";
import { handleGithubEvent } from "@/server/github/webhook";
import { upsertUser } from "@/server/auth/session";
import { schema } from "@/server/db";
import { createProject } from "@/server/projects";
import { createServer } from "@/server/servers";
import { saveMaintenance } from "@/server/maintenance";
import { resetConfigForTests } from "@/server/config";
import { useFreshDb } from "@/server/test/db";
import { closePullRequestPreviews } from "@/server/github/pulls";

vi.mock("@/server/github/pulls", () => ({ attachPullRequest: vi.fn(), closePullRequestPreviews: vi.fn(async () => ({ canceled: 0, removed: 0 })) }));
const secret = "maintenance-webhook-secret";
let ctx: Awaited<ReturnType<typeof useFreshDb>>;
let adminId: string;
let project: Awaited<ReturnType<typeof createProject>>;

function signed(event: string, body: unknown) {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  return new NextRequest("http://localhost/api/webhooks/github", { method: "POST", body: raw, headers: { "x-github-event": event, "x-hub-signature-256": signature, "content-length": String(Buffer.byteLength(raw)) } });
}
beforeAll(async () => {
  process.env.GITHUB_WEBHOOK_SECRET = secret;
  resetConfigForTests();
  ctx = await useFreshDb();
  adminId = (await upsertUser({ id: "webhook-maintenance-admin", name: "Admin", email: null, slackId: null })).id;
  const owner = await upsertUser({ id: "webhook-maintenance-owner", name: "Owner", email: null, slackId: null });
  process.env.SECURITY_REPORT_ADMIN_ID = adminId;
  const server = await createServer(owner.id, "webhook-maintenance-owner");
  project = await createProject(owner.id, { serverId: server.id, name: "Webhook maintenance", slug: "webhook-maintenance", repoUrl: "https://github.com/sample/app.git", runtime: "node", port: 3000 });
  await ctx.db.update(schema.projects).set({ repoFullName: "sample/app", installationId: 777, autoDeploy: true }).where(eq(schema.projects.id, project.id));
  await ctx.db.insert(schema.githubInstallations).values({ id: 777, userId: owner.id, accountLogin: "sample", accountType: "User", createdAt: new Date() });
});
beforeEach(async () => { vi.clearAllMocks(); await saveMaintenance(adminId, { enabled: true, message: "Updating" }); });
afterAll(async () => { delete process.env.GITHUB_WEBHOOK_SECRET; delete process.env.SECURITY_REPORT_ADMIN_ID; resetConfigForTests(); await ctx.cleanup(); });

describe("GitHub events during read-only maintenance", () => {
  it("refuses all event side effects before recording replay state, and accepts redelivery after the window", async () => {
    const deletion = { action: "deleted", installation: { id: 777 } };
    const rename = { action: "renamed", installation: { id: 777 }, repository: { full_name: "sample/renamed" }, changes: { repository: { name: { from: "app" } } } };
    const pull = { action: "closed", installation: { id: 777 }, repository: { full_name: "sample/app" }, pull_request: { number: 12, head: { ref: "feature", sha: "a".repeat(40) } } };
    const push = { ref: "refs/heads/main", after: "b".repeat(40), installation: { id: 777 }, repository: { full_name: "sample/app" } };
    for (const [event, body] of [["installation", deletion], ["repository", rename], ["pull_request", pull], ["push", push]] as const) {
      const response = await POST(signed(event, body));
      expect(response.status, event).toBe(503);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(await response.json()).toMatchObject({ error: { code: "maintenance" } });
    }
    expect(await ctx.db.select().from(schema.githubWebhookEvents)).toHaveLength(0);
    expect(await ctx.db.select().from(schema.deployments)).toHaveLength(0);
    expect(await ctx.db.select().from(schema.githubInstallations).where(eq(schema.githubInstallations.id, 777)).get()).toBeTruthy();
    expect((await ctx.db.select().from(schema.projects).where(eq(schema.projects.id, project.id)).get())?.repoFullName).toBe("sample/app");
    expect(closePullRequestPreviews).not.toHaveBeenCalled();
    await saveMaintenance(adminId, { enabled: false });
    expect((await POST(signed("pull_request", pull))).status).toBe(200);
    expect(closePullRequestPreviews).toHaveBeenCalledWith(project.id, 12);
    expect((await POST(signed("push", push))).status).toBe(200);
    expect(await ctx.db.select().from(schema.deployments)).toHaveLength(1);
    expect((await POST(signed("installation", deletion))).status).toBe(200);
    expect(await ctx.db.select().from(schema.githubInstallations).where(eq(schema.githubInstallations.id, 777)).get()).toBeUndefined();
  });
  it("also guards direct service dispatch if maintenance begins after the route's early check", async () => {
    await expect(handleGithubEvent("installation", { action: "deleted", installation: { id: 777 } })).rejects.toMatchObject({ status: 503, code: "maintenance" });
  });
});
