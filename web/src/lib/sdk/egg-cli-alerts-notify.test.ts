import { describe, expect, it } from "vitest";
import type { FetchLike, FetchResponse } from "./egg";
import { parseCli, run } from "../../../scripts/egg-cli.mjs";

const TOKEN = "egg_test_token_for_alerts_notify";
const ENV = { EGG_TOKEN: TOKEN, EGG_URL: "https://egg.example.com" };

function reply(status: number, body: unknown): FetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  };
}

type Routes = Record<string, FetchResponse>;

async function egg(argv: string[], routes: Routes = {}) {
  const calls: { method: string; path: string; search: string; body: unknown }[] = [];
  const fetch: FetchLike = async (rawUrl, init) => {
    const url = new URL(rawUrl);
    calls.push({
      method: init.method,
      path: url.pathname,
      search: url.search,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    return routes[`${init.method} ${url.pathname}`] ?? reply(404, {
      error: { code: "not_found", message: `No fake route for ${init.method} ${url.pathname}` },
    });
  };
  let out = "";
  let err = "";
  const code = await run(argv, {
    env: ENV,
    fetch,
    stdout: { isTTY: true, write: (value: string) => void (out += value) },
    stderr: { write: (value: string) => void (err += value) },
  });
  return { code, out, err, calls };
}

describe("Egg alert and notification commands", () => {
  it("parses each supported command and its options", () => {
    expect(parseCli([
      "notify", "channels", "create", "--webhook-url", "https://hooks.example.com/egg",
      "--events", "deployment.ready,deployment.failed", "--project", "p_1",
    ])).toMatchObject({ ok: true, command: "notify channels create" });
    expect(parseCli([
      "notify", "channels", "update", "ch_1", "--webhook-url", "https://hooks.example.com/new", "--enabled", "true",
    ])).toMatchObject({ ok: true, command: "notify channels update", args: ["ch_1"] });
    expect(parseCli([
      "notify", "channels", "delete", "ch_1", "--confirm", "hooks.example.com",
    ])).toMatchObject({ ok: true, command: "notify channels delete", args: ["ch_1"] });
    expect(parseCli(["notify", "deliveries", "ch_1", "--limit", "5"]).ok).toBe(true);
  });

  it("creates a webhook channel with its one-time signing secret", async () => {
    const created = {
      channel: {
        id: "ch_1",
        url: "https://hooks.example.com/egg",
        host: "hooks.example.com",
        projectId: "p_1",
        events: ["deployment.ready", "deployment.failed"],
        active: true,
        signingSecret: "must-stay-hidden",
      },
      secret: "whsec_one_time_value",
    };
    const r = await egg([
      "notify", "channels", "create", "--webhook-url", "https://hooks.example.com/egg",
      "--events", "deployment.ready,deployment.failed", "--project", "p_1", "--json",
    ], { "POST /api/v1/notification-channels": reply(201, created) });

    expect(r.code, r.err).toBe(0);
    expect(r.calls).toMatchObject([{
      method: "POST",
      path: "/api/v1/notification-channels",
      body: {
        url: "https://hooks.example.com/egg",
        events: ["deployment.ready", "deployment.failed"],
        projectId: "p_1",
      },
    }]);
    expect(JSON.parse(r.out)).toEqual({
      ...created,
      channel: { ...created.channel, signingSecret: "[redacted]" },
    });
    expect(r.out).toContain("whsec_one_time_value");
    expect(r.out).not.toContain("must-stay-hidden");
  });

  it("updates only supplied channel fields through the SDK", async () => {
    const updated = {
      channel: {
        id: "ch_1",
        url: "https://hooks.example.com/new",
        host: "hooks.example.com",
        projectId: null,
        events: ["deployment.failed"],
        active: true,
      },
    };
    const r = await egg([
      "notify", "channels", "update", "ch_1", "--webhook-url", "https://hooks.example.com/new",
      "--events", "deployment.failed", "--enabled", "true", "--json",
    ], { "PATCH /api/v1/notification-channels/ch_1": reply(200, updated) });

    expect(r.code, r.err).toBe(0);
    expect(r.calls).toMatchObject([{
      method: "PATCH",
      path: "/api/v1/notification-channels/ch_1",
      body: { url: "https://hooks.example.com/new", events: ["deployment.failed"], active: true },
    }]);
    expect(JSON.parse(r.out)).toEqual(updated);
  });

  it("checks the exact channel host before deleting", async () => {
    const r = await egg([
      "notify", "channels", "delete", "ch_1", "--confirm", "hooks.example.com", "--json",
    ], {
      "GET /api/v1/notification-channels/ch_1": reply(200, { channel: { id: "ch_1", host: "hooks.example.com" } }),
      "DELETE /api/v1/notification-channels/ch_1": reply(200, { deleted: true, channelId: "ch_1" }),
    });

    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([
      { method: "GET", path: "/api/v1/notification-channels/ch_1" },
      { method: "DELETE", path: "/api/v1/notification-channels/ch_1", body: { confirmName: "hooks.example.com" } },
    ]);
  });

  it("rejects channel deletion without an exact host confirmation", async () => {
    const missing = await egg(["notify", "channels", "delete", "ch_1"]);
    expect(missing.code).toBe(2);
    expect(missing.calls).toHaveLength(0);

    const wrong = await egg([
      "notify", "channels", "delete", "ch_1", "--confirm", "wrong.example.com",
    ], {
      "GET /api/v1/notification-channels/ch_1": reply(200, { channel: { id: "ch_1", host: "hooks.example.com" } }),
      "DELETE /api/v1/notification-channels/ch_1": reply(200, { deleted: true, channelId: "ch_1" }),
    });
    expect(wrong.code).toBe(2);
    expect(wrong.calls).toHaveLength(1);
    expect(wrong.calls[0].method).toBe("GET");
  });

  it("lists only the requested recent deliveries", async () => {
    const deliveries = [1, 2, 3].map((n) => ({
      id: `delivery_${n}`,
      event: "deployment.ready",
      status: "success",
      attempts: 1,
      lastErrorCode: null,
      createdAt: `2026-01-0${n}T00:00:00.000Z`,
    }));
    const r = await egg(["notify", "deliveries", "ch_1", "--limit", "2", "--json"], {
      "GET /api/v1/notification-channels/ch_1/deliveries": reply(200, { deliveries }),
    });

    expect(r.code).toBe(0);
    expect(r.calls).toMatchObject([{
      method: "GET",
      path: "/api/v1/notification-channels/ch_1/deliveries",
      search: "",
    }]);
    expect(JSON.parse(r.out)).toEqual({ deliveries: deliveries.slice(0, 2) });
  });
});
