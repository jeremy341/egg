import { describe, expect, it } from "vitest";
import { NOTIFICATION_ENDPOINTS } from "@/server/api-v1-notifications";
import { NOTIF_OPS_ENDPOINTS } from "@/server/api-v1-notif-ops";

describe("notification operation endpoints", () => {
  it("exports the six notification channel, rule, delivery and replay operations", () => {
    expect(NOTIF_OPS_ENDPOINTS.map((entry) => entry.id)).toEqual([
      "delete_notification_channel",
      "delete_notification_rule",
      "update_notification_channel",
      "update_notification_rule",
      "list_notification_deliveries",
      "replay_notification_channel",
    ]);
    for (const entry of NOTIF_OPS_ENDPOINTS) {
      expect(NOTIFICATION_ENDPOINTS).toContain(entry);
    }
  });

  it("preserves existing operation metadata", () => {
    expect(NOTIF_OPS_ENDPOINTS.map(({ id, method, path, scope, destructive }) => ({
      id,
      method,
      path,
      scope,
      destructive,
    }))).toEqual([
      { id: "delete_notification_channel", method: "DELETE", path: "/notification-channels/{channelId}", scope: "webhooks:write", destructive: true },
      { id: "delete_notification_rule", method: "DELETE", path: "/notification-channels/{channelId}/rules/{ruleId}", scope: "webhooks:write", destructive: true },
      { id: "update_notification_channel", method: "PATCH", path: "/notification-channels/{channelId}", scope: "webhooks:write", destructive: false },
      { id: "update_notification_rule", method: "PATCH", path: "/notification-channels/{channelId}/rules/{ruleId}", scope: "webhooks:write", destructive: false },
      { id: "list_notification_deliveries", method: "GET", path: "/notification-channels/{channelId}/deliveries", scope: "webhooks:read", destructive: false },
      { id: "replay_notification_channel", method: "POST", path: "/notification-channels/{channelId}/deliveries/{deliveryId}/replay", scope: "webhooks:write", destructive: false },
    ]);
  });
});
