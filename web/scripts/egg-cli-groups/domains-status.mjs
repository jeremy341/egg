// CLI group "domains-status". Orchard source files: domain, statuspage.
// Each export is consumed by web/scripts/egg-cli.mjs. Owned by one child at a time.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void. Use kit for printData, table, clean, dash, json, redactSecrets, UsageError, Failure.
// optionTypes: { "option-name": "flag" | "value" } for options this group adds.
export const commands = [
  {
    name: "domains get",
    args: ["domain-id"],
    description: "Show one domain record by id.",
    runner: "domainsGet",
  },
  {
    name: "domains update",
    args: ["domain-id"],
    options: ["service-port"],
    description: "Change a domain's destination port.",
    runner: "domainsUpdate",
  },
  {
    name: "domains delete",
    args: ["domain-id"],
    required: ["confirm"],
    options: ["confirm"],
    description: "Remove a domain after confirming its exact name.",
    runner: "domainsDelete",
  },
  {
    name: "domains protection get",
    args: ["domain-id"],
    description: "Read a domain's protection settings.",
    runner: "domainsProtectionGet",
  },
  {
    name: "domains protection set",
    args: ["domain-id"],
    required: ["mode"],
    options: ["mode", "password"],
    description: "Set a domain's protection mode and optional password.",
    runner: "domainsProtectionSet",
  },
  {
    name: "status-page show",
    args: ["project"],
    description: "Show whether a project's status page is published and its URL.",
    runner: "statusPageShow",
  },
];

export const runners = {
  async domainsGet(nest, [domainId], flags, out, deps, _fail, kit) {
    const data = await nest.getIngress(domainId);
    return kit.printData(data, flags, deps, out, kit.json);
  },

  async domainsUpdate(nest, [domainId], flags, out, deps, _fail, kit) {
    if (flags.servicePort === undefined) {
      throw new kit.UsageError("domains update needs --service-port; this endpoint cannot change route hosts, paths, TLS, or redirects.");
    }
    const port = Number(flags.servicePort);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
      throw new kit.UsageError("--service-port must be an integer from 1 to 65535.");
    }
    const data = await nest.updateIngress(domainId, { port });
    return kit.printData(data, flags, deps, out, kit.json);
  },

  async domainsDelete(nest, [domainId], flags, out, deps, _fail, kit) {
    const { domains } = await nest.listDomains();
    const domain = domains.find((candidate) => candidate.id === domainId);
    if (!domain) throw new kit.Failure(`No domain with the id "${kit.clean(domainId)}".`);
    if (flags.confirm !== domain.domain) {
      throw new kit.UsageError(`--confirm must exactly match the domain name "${kit.clean(domain.domain)}".`);
    }
    const data = await nest.removeDomain(domainId);
    return kit.printData(data, flags, deps, out, () => `Removed domain ${kit.clean(domain.domain)}.\n`);
  },

  async domainsProtectionGet(nest, [domainId], flags, out, deps, _fail, kit) {
    const data = await nest.getIngressProtection(domainId);
    return kit.printData(data, flags, deps, out, kit.json);
  },

  async domainsProtectionSet(nest, [domainId], flags, out, deps, _fail, kit) {
    const input = { mode: flags.mode, ...(flags.password === undefined ? {} : { password: flags.password }) };
    const data = await nest.setIngressProtection(domainId, input);
    return kit.printData(data, flags, deps, out, kit.json);
  },

  async statusPageShow(nest, [slugOrId], flags, out, deps, _fail, kit) {
    const { projects } = await nest.listProjects();
    const project = projects.find((candidate) => candidate.slug === slugOrId) ?? projects.find((candidate) => candidate.id === slugOrId);
    if (!project) throw new kit.Failure(`No project with the slug or id "${kit.clean(slugOrId)}".`);
    const data = await nest.getStatusPage(project.id);
    return kit.printData(data, flags, deps, out, (visible) => {
      const page = visible.statusPage;
      return `Status page for ${kit.clean(project.slug)}: ${page.published ? "published" : "not published"}; URL ${kit.dash(page.url)}.\n`;
    });
  },
};

export const optionTypes = {
  "service-port": "value",
  mode: "value",
  password: "value",
};
