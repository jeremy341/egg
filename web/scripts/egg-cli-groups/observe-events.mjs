// CLI group "observe-events". Orchard source files: observe, events, audit.
// Each export is consumed by web/scripts/egg-cli.mjs. Owned by one child at a time.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void. Use kit for printData, table, clean, dash, json, redactSecrets, UsageError, Failure.
// optionTypes: { "option-name": "flag" | "value" } for options this group adds.
export const commands = [
  {
    name: "observe logs",
    args: ["deployment-id"],
    options: ["level", "search", "tail", "follow"],
    description: "Read and filter recent runtime log lines for a deployment.",
    runner: "observeLogs",
  },
  {
    name: "observe http",
    args: ["deployment-id"],
    description: "Read the HTTP metrics Egg exposes for a deployment.",
    runner: "observeHttp",
  },
  {
    name: "observe errors",
    args: ["deployment-id"],
    options: ["window"],
    description: "Read the anomaly summary for a deployment's project.",
    runner: "observeErrors",
  },
  {
    name: "observe activity",
    args: ["deployment-id"],
    options: ["kinds", "limit", "cursor", "all"],
    description: "Read activity entries that mention a deployment.",
    runner: "observeActivity",
  },
  {
    name: "events tail",
    args: [],
    options: ["types", "since-id"],
    description: "Poll project change feeds for new organization events.",
    runner: "eventsTail",
  },
  {
    name: "audit list",
    args: [],
    options: ["deployment", "action", "limit", "cursor", "all"],
    description: "List organization audit entries with optional filters and paging.",
    runner: "auditList",
  },
];

export const optionTypes = {
  level: "value",
  search: "value",
  tail: "value",
  follow: "flag",
  window: "value",
  kinds: "value",
  limit: "value",
  cursor: "value",
  all: "flag",
  types: "value",
  "since-id": "value",
  deployment: "value",
  action: "value",
};

function positiveInteger(value, name, fallback, maximum, kit) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || (maximum !== undefined && number > maximum)) {
    const range = maximum === undefined ? "a positive integer" : `an integer from 1 to ${maximum}`;
    throw new kit.UsageError(`--${name} must be ${range}.`);
  }
  return number;
}

function splitValues(value) {
  return value === undefined ? [] : value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getNextCursor(page) {
  if (!isRecord(page)) return undefined;
  return typeof page.nextCursor === "string" && page.nextCursor.length > 0 ? page.nextCursor : undefined;
}

function getItems(page) {
  if (!isRecord(page)) return undefined;
  for (const key of ["items", "entries", "events", "auditLog", "logs"]) {
    if (Array.isArray(page[key])) return page[key];
  }
  return undefined;
}

function combinePages(pages) {
  if (pages.length <= 1) return pages[0];
  const first = pages[0];
  const key = isRecord(first) ? Object.keys(first).find((name) => Array.isArray(first[name])) : undefined;
  if (!key) return { pages };
  const last = pages[pages.length - 1];
  return { ...first, [key]: pages.flatMap((page) => (isRecord(page) && Array.isArray(page[key]) ? page[key] : [])), nextCursor: getNextCursor(last) ?? null };
}

async function readPages(load, initialCursor, fetchAll) {
  const pages = [];
  const seen = new Set();
  let cursor = initialCursor;
  for (let pageNumber = 0; pageNumber < (fetchAll ? 100 : 1); pageNumber += 1) {
    pages.push(await load(cursor));
    if (!fetchAll) break;
    const next = getNextCursor(pages[pages.length - 1]);
    if (!next || seen.has(next)) break;
    seen.add(next);
    cursor = next;
  }
  return combinePages(pages);
}

function printGeneric(data, flags, out, deps, kit) {
  return kit.printData(data, flags, deps, out, (visible) => kit.json(visible));
}

function renderActivity(data, kit) {
  const items = getItems(data);
  if (!items) return kit.json(data);
  if (items.length === 0) return "No matching activity entries.\n";
  return kit.table(
    ["TIME", "KIND", "ACTION", "TARGET"],
    items.map((item) => [
      kit.dash(kit.clean(String(item?.at ?? ""))),
      kit.dash(kit.clean(String(item?.kind ?? ""))),
      kit.dash(kit.clean(String(item?.action ?? item?.label ?? ""))),
      kit.dash(kit.clean(String(item?.target?.name ?? ""))),
    ])
  );
}

function matchesDeployment(item, deploymentId) {
  const values = [item?.label, item?.target?.name, ...(Array.isArray(item?.fields) ? item.fields.flatMap((field) => [field?.label, field?.value]) : [])];
  return values.some((value) => typeof value === "string" && value.toLowerCase().includes(deploymentId.toLowerCase()));
}

function filterActivity(data, deploymentId, kinds) {
  if (!isRecord(data) || !Array.isArray(data.items)) return data;
  const wantedKinds = new Set(kinds.map((kind) => kind.toLowerCase()));
  return {
    ...data,
    items: data.items.filter((item) =>
      matchesDeployment(item, deploymentId) && (wantedKinds.size === 0 || wantedKinds.has(String(item?.kind ?? "").toLowerCase()))
    ),
  };
}

function renderLogLines(data, kit) {
  if (!Array.isArray(data?.lines) || data.lines.length === 0) return "No matching deployment log entries.\n";
  return kit.table(
    ["TIME", "LEVEL", "MESSAGE"],
    data.lines.map((line) => [
      kit.dash(kit.clean(String(line?.at ?? ""))),
      kit.dash(kit.clean(String(line?.level ?? ""))),
      kit.clean(String(line?.message ?? line)),
    ])
  );
}

function filterLogLines(lines, { level, search }) {
  const needle = search?.toLowerCase();
  return lines.filter((line) => {
    const message = typeof line?.message === "string" ? line.message : String(line);
    if (needle && !message.toLowerCase().includes(needle)) return false;
    return !level || String(line?.level ?? "").toLowerCase() === level;
  });
}

function durationMilliseconds(value, kit) {
  const match = /^(\d+)(ms|s|m|h|d)$/i.exec(value ?? "1h");
  if (!match) throw new kit.UsageError("--window must be a duration such as 15m or 1h.");
  const factors = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  const duration = Number(match[1]) * factors[match[2].toLowerCase()];
  if (!Number.isSafeInteger(duration) || duration < 60_000) throw new kit.UsageError("--window must be at least one minute.");
  return duration;
}

function auditTable(data, kit) {
  const items = getItems(data);
  if (!items) return kit.json(data);
  if (items.length === 0) return "No audit entries.\n";
  return kit.table(
    ["TIME", "ACTION", "ACTOR"],
    items.map((item) => [
      kit.dash(kit.clean(String(item?.at ?? item?.time ?? item?.createdAt ?? ""))),
      kit.dash(kit.clean(String(item?.action ?? ""))),
      kit.dash(kit.clean(String(item?.actor?.name ?? item?.actor ?? ""))),
    ])
  );
}

export const runners = {
  async observeLogs(nest, [deploymentId], flags, out, deps, _fail, kit) {
    const tail = positiveInteger(flags.tail, "tail", 200, 20000, kit);
    const level = flags.level?.toLowerCase();
    if (level !== undefined && !["info", "warn", "error"].includes(level)) {
      throw new kit.UsageError("--level must be info, warn, or error.");
    }

    const read = (after) => nest.getDeploymentLogs(deploymentId, { after, limit: tail });
    let page = await read(undefined);
    const visibleLines = (value) => filterLogLines(value.lines ?? [], { level, search: flags.search });
    const printLines = (lines) => {
      for (const line of lines) {
        const safe = kit.redactSecrets(line, flags.showSecrets);
        out(flags.json ? kit.json(safe) : `${kit.clean(`${safe.at} ${safe.level} ${safe.message}`)}\n`);
      }
    };
    if (!flags.follow) {
      const data = { ...page, lines: visibleLines(page) };
      return kit.printData(data, flags, deps, out, (visible) => renderLogLines(visible, kit));
    }

    printLines(visibleLines(page));
    let after = page.nextAfter;
    for (;;) {
      while (page.more) {
        const previousAfter = after;
        page = await read(after);
        if (page.nextAfter === previousAfter && (page.lines?.length ?? 0) === 0) {
          page = { ...page, more: false };
          break;
        }
        after = page.nextAfter;
        printLines(visibleLines(page));
      }

      if ((await deps.sleep(deps.pollMs ?? 1000)) === false) return;
      page = await read(after);
      if (page.nextAfter !== after) {
        after = page.nextAfter;
        printLines(visibleLines(page));
      }
    }
  },

  async observeHttp(nest, [deploymentId], flags, out, deps, _fail, kit) {
    const data = await nest.getDeploymentHttpMetrics(deploymentId);
    return printGeneric(data, flags, out, deps, kit);
  },

  async observeErrors(nest, [deploymentId], flags, out, deps, _fail, kit) {
    durationMilliseconds(flags.window, kit);
    const deployment = await nest.getDeployment(deploymentId);
    const projectId = deployment?.deployment?.projectId;
    if (typeof projectId !== "string" || !projectId) throw new kit.Failure("Egg did not return the deployment's project id.");
    const data = await nest.getAnomalies(projectId);
    return printGeneric(data, flags, out, deps, kit);
  },

  async observeActivity(nest, [deploymentId], flags, out, deps, _fail, kit) {
    const limit = positiveInteger(flags.limit, "limit", 50, undefined, kit);
    const kinds = splitValues(flags.kinds);
    const query = { limit, ...(flags.cursor ? { cursor: flags.cursor } : {}), ...(kinds.length === 1 ? { kind: kinds[0] } : {}) };
    const page = await readPages((cursor) => nest.getActivity({ ...query, ...(cursor ? { cursor } : {}) }), flags.cursor, Boolean(flags.all));
    const data = filterActivity(page, deploymentId, kinds);
    return kit.printData(data, flags, deps, out, (visible) => renderActivity(visible, kit));
  },

  async eventsTail(nest, _args, flags, out, deps, _fail, kit) {
    const types = splitValues(flags.types).map((kind) => kind.toLowerCase());
    const { projects } = await nest.listProjects();
    if (projects.length === 0) {
      return kit.printData({ events: [] }, flags, deps, out, () => "No projects have change feeds.\n");
    }
    const cursors = new Map(projects.map((project) => [project.id, flags.sinceId]));
    const seen = new Set();
    for (;;) {
      for (const project of projects) {
        const page = await nest.getChanges(project.id, { limit: 100, ...(cursors.get(project.id) ? { cursor: cursors.get(project.id) } : {}) });
        for (const item of page.items ?? []) {
          const eventKey = JSON.stringify([project.id, item.time, item.kind, item.summary, item.deploymentId]);
          if (seen.has(eventKey) || (types.length > 0 && !types.includes(String(item.kind).toLowerCase()))) continue;
          seen.add(eventKey);
          const safe = kit.redactSecrets({ project: project.slug, ...item }, flags.showSecrets);
          out(flags.json ? kit.json(safe) : `${kit.clean(`${safe.time} ${safe.kind} ${safe.summary}`)}\n`);
        }
        if (page.nextCursor) cursors.set(project.id, page.nextCursor);
      }
      await deps.sleep(deps.pollMs ?? 1000);
    }
  },

  async auditList(nest, _args, flags, out, deps, _fail, kit) {
    const limit = positiveInteger(flags.limit, "limit", 50, undefined, kit);
    const query = {
      ...(flags.deployment ? { deployment: flags.deployment } : {}),
      ...(flags.action ? { action: flags.action } : {}),
      limit,
    };
    const data = await readPages((cursor) => nest.getAuditLog({ ...query, ...(cursor ? { cursor } : {}) }), flags.cursor, Boolean(flags.all));
    return kit.printData(data, flags, deps, out, (visible) => auditTable(visible, kit));
  },
};
