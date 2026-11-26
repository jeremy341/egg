import { NOTIFICATION_ENDPOINTS } from "@/server/api-v1-notifications";

const notificationOperationIds = [
  "delete_notification_channel",
  "delete_notification_rule",
  "update_notification_channel",
  "update_notification_rule",
  "list_notification_deliveries",
  "replay_notification_channel",
] as const;

const notificationOperationOrder = new Map(
  notificationOperationIds.map((id, index) => [id, index])
);

export const NOTIF_OPS_ENDPOINTS = NOTIFICATION_ENDPOINTS
  .filter((entry) => notificationOperationOrder.has(entry.id as (typeof notificationOperationIds)[number]))
  .sort((left, right) =>
    notificationOperationOrder.get(left.id as (typeof notificationOperationIds)[number])! -
    notificationOperationOrder.get(right.id as (typeof notificationOperationIds)[number])!
  );
