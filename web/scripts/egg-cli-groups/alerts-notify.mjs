// CLI group "alerts-notify". Orchard source files: alert, notify, webhook.
// Each export is consumed by web/scripts/egg-cli.mjs. Owned by one child at a time.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void. Use kit for printData, table, clean, dash, json, redactSecrets, UsageError, Failure.
// optionTypes: { "option-name": "flag" | "value" } for options this group adds.
export const commands = [
  {
    name: "notify channels create",
    args: [],
    required: ["webhook-url", "events"],
    options: ["webhook-url", "events", "project"],
    description: "Create a signed webhook channel for selected deployment events.",
    runner: "notifyChannelCreate",
  },
  {
    name: "notify channels update",
    args: ["channel-id"],
    options: ["webhook-url", "events", "enabled", "disabled"],
    description: "Update a webhook channel's receiver, event filter, or active state.",
    runner: "notifyChannelUpdate",
  },
  {
    name: "notify channels delete",
    args: ["channel-id"],
    required: ["confirm"],
    options: ["confirm"],
    description: "Delete a notification channel after confirming its exact host.",
    runner: "notifyChannelDelete",
  },
  {
    name: "notify deliveries",
    args: ["channel-id"],
    options: ["limit"],
    description: "List recent delivery attempts for a notification channel.",
    runner: "notifyDeliveries",
  },
];

export const runners = {
  async notifyChannelCreate(nest, _args, flags, out, deps, _fail, kit) {
    const events = parseEvents(flags.events, kit);
    const data = await nest.createNotificationChannel({
      url: flags.webhookUrl,
      events,
      ...(flags.project ? { projectId: flags.project } : {}),
    });
    // This endpoint returns its signing secret once. The checklist explicitly
    // requires showing that value on creation, so redact the object through
    // the shared helper while opting into that one-time response value.
    const visible = kit.redactSecrets(data, false);
    const response = { ...visible, secret: kit.clean(data.secret) };
    if (flags.json || !deps.isTTY) return out(kit.json(response));
    const channel = response.channel ?? {};
    return out(`Created webhook channel ${kit.clean(channel.id ?? channel.host ?? "channel")}.\nSigning secret: ${response.secret}\n`);
  },

  async notifyChannelUpdate(nest, [channelId], flags, out, deps, _fail, kit) {
    if (flags.enabled !== undefined && flags.disabled) {
      throw new kit.UsageError("Use either --enabled or --disabled, not both.");
    }
    const changes = {};
    if (flags.webhookUrl !== undefined) changes.url = flags.webhookUrl;
    if (flags.events !== undefined) changes.events = parseEvents(flags.events, kit);
    if (flags.enabled !== undefined) {
      if (flags.enabled !== "true" && flags.enabled !== "false") {
        throw new kit.UsageError("--enabled needs true or false.");
      }
      changes.active = flags.enabled === "true";
    } else if (flags.disabled) {
      changes.active = false;
    }
    if (Object.keys(changes).length === 0) {
      throw new kit.UsageError("notify channels update needs --webhook-url, --events, --enabled, or --disabled.");
    }
    const data = await nest.updateNotificationChannel(channelId, changes);
    return kit.printData(data, flags, deps, out, (visible) =>
      `Updated notification channel ${kit.clean(visible.channel?.id ?? channelId)}.\n`
    );
  },

  async notifyChannelDelete(nest, [channelId], flags, out, deps, _fail, kit) {
    const { channel } = await nest.getNotificationChannel(channelId);
    if (flags.confirm !== channel?.host) {
      throw new kit.UsageError(`Pass --confirm with the exact channel host: ${kit.clean(channel?.host ?? "unknown")}`);
    }
    const data = await nest.deleteNotificationChannel(channelId, flags.confirm);
    return kit.printData(data, flags, deps, out, () => `Deleted notification channel ${kit.clean(channelId)}.\n`);
  },

  async notifyDeliveries(nest, [channelId], flags, out, deps, _fail, kit) {
    const limit = Number(flags.limit ?? 30);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30) {
      throw new kit.UsageError("--limit must be an integer from 1 to 30.");
    }
    const data = await nest.listNotificationDeliveries(channelId);
    const limited = { ...data, deliveries: data.deliveries.slice(0, limit) };
    return kit.printData(limited, flags, deps, out, (visible) => visible.deliveries.length === 0
      ? "No notification deliveries.\n"
      : kit.table(["ID", "EVENT", "STATUS", "ATTEMPTS", "ERROR", "CREATED"], visible.deliveries.map((item) => [
        kit.clean(item.id),
        kit.clean(item.event),
        kit.clean(item.status),
        item.attempts,
        kit.dash(item.lastErrorCode),
        kit.clean(item.createdAt),
      ]))
    );
  },
};

export const optionTypes = {
  "webhook-url": "value",
  events: "value",
  disabled: "flag",
};

function parseEvents(value, kit) {
  const events = String(value ?? "").split(",").map((event) => event.trim());
  if (events.length === 0 || events.some((event) => event === "")) {
    throw new kit.UsageError("--events needs a comma-separated list of event names.");
  }
  return events;
}
