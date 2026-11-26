// CLI group "orgs". Orchard source files: org, org_registry.
// Each export is consumed by web/scripts/egg-cli.mjs. Owned by one child at a time.
// commands: registry entries { name, args, options?, required?, description, runner }.
// runners: async (nest, args, flags, out, deps, fail, kit) => void. Use kit for printData, table, clean, dash, json, redactSecrets, UsageError, Failure.
// optionTypes: { "option-name": "flag" | "value" } for options this group adds.
export const commands = [
  { name: "orgs list", args: [], description: "List the organizations available to the signed-in user.", runner: "orgsList" },
  { name: "orgs get", args: [], options: ["org"], description: "Show an organization selected with --org or the current organization scope.", runner: "orgsGet" },
  { name: "orgs registry list", args: [], options: ["org"], description: "List an organization's private registry logins without revealing passwords.", runner: "orgsRegistryList" },
  {
    name: "orgs registry set",
    args: ["registry"],
    options: ["org", "username", "password", "password-stdin"],
    description: "Add or replace an organization's private registry login.",
    runner: "orgsRegistrySet",
  },
  {
    name: "orgs registry remove",
    args: ["id"],
    required: ["confirm"],
    options: ["org", "confirm"],
    description: "Remove a registry login after confirming its exact registry host.",
    runner: "orgsRegistryRemove",
  },
];

export const runners = {
  async orgsList(nest, _args, flags, out, deps, _fail, kit) {
    const data = await nest.listOrganizations();
    return printSafe(data, flags, deps, out, (visible) => {
      const organizations = Array.isArray(visible?.organizations) ? visible.organizations : [];
      return organizations.length === 0
        ? "No organizations available.\n"
        : kit.table(
          ["ID", "SLUG", "NAME"],
          organizations.map((organization) => [
            kit.dash(kit.clean(organization.id)),
            kit.dash(kit.clean(organization.slug)),
            kit.dash(kit.clean(organization.name)),
          ])
        );
    }, kit);
  },

  async orgsGet(nest, _args, flags, out, deps, _fail, kit) {
    const organization = await resolveOrganization(nest, flags.org, kit);
    return printSafe(organization, flags, deps, out, (visible) => [
      `ID    ${kit.dash(kit.clean(visible.id))}`,
      `Slug  ${kit.dash(kit.clean(visible.slug))}`,
      `Name  ${kit.dash(kit.clean(visible.name))}`,
      "",
    ].join("\n"), kit);
  },

  async orgsRegistryList(nest, _args, flags, out, deps, _fail, kit) {
    const organization = await resolveOrganization(nest, flags.org, kit);
    const data = await nest.listRegistryCredentials();
    const credentials = scopedCredentials(data, organization, kit);
    return printSafe(credentials, flags, deps, out, (visible) => visible.length === 0
      ? "No registry credentials configured.\n"
      : kit.table(
        ["ID", "REGISTRY", "USERNAME"],
        visible.map((credential) => [
          kit.dash(kit.clean(credential.id)),
          kit.dash(kit.clean(registryHost(credential))),
          kit.dash(kit.clean(credential.username)),
        ])
      ), kit);
  },

  async orgsRegistrySet(nest, [registry], flags, out, deps, _fail, kit) {
    if (flags.password !== undefined && flags.passwordStdin) {
      throw new kit.UsageError("Use either --password or --password-stdin, not both.");
    }
    if (!flags.username) throw new kit.UsageError("orgs registry set needs --username.");
    const password = flags.passwordStdin ? await readPassword(deps.stdin ?? process.stdin, kit) : flags.password;
    if (password === undefined || password.length === 0) {
      throw new kit.UsageError("orgs registry set needs --password or --password-stdin.");
    }
    const organization = await resolveOrganization(nest, flags.org, kit);
    let data;
    try {
      data = await nest.setRegistryCredential({
        organizationId: organization.id,
        registry,
        username: flags.username,
        password,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const sanitized = kit.redactSecrets({ password, message }, false);
      throw new kit.Failure(sanitized.message);
    }
    const result = data?.credential ?? data;
    return printSafe({
      success: true,
      registry: result?.registry ?? result?.registryHost ?? registry,
      username: result?.username ?? flags.username,
    }, flags, deps, out, (visible) => `Updated registry login for ${kit.clean(visible.registry)}.\n`, kit);
  },

  async orgsRegistryRemove(nest, [credentialId], flags, out, deps, _fail, kit) {
    const organization = await resolveOrganization(nest, flags.org, kit);
    const data = await nest.listRegistryCredentials();
    const credential = scopedCredentials(data, organization, kit).find((entry) => entry.id === credentialId);
    if (!credential) throw new kit.Failure(`No registry credential with id "${credentialId}" exists in this organization.`);
    const host = registryHost(credential);
    if (!host) throw new kit.Failure(`Registry credential "${credentialId}" does not include a registry host.`);
    if (flags.confirm !== host) {
      throw new kit.UsageError(`Pass --confirm with the exact registry host: ${host}`);
    }
    await nest.deleteRegistryCredential(credentialId, {
      organizationId: organization.id,
      confirmName: flags.confirm,
    });
    return printSafe({ success: true, registry: host }, flags, deps, out, (visible) => `Removed registry login for ${kit.clean(visible.registry)}.\n`, kit);
  },
};

export const optionTypes = {
  org: "value",
  username: "value",
  password: "value",
  "password-stdin": "flag",
};

function printSafe(data, flags, deps, out, render, kit) {
  return kit.printData(data, { ...flags, showSecrets: false }, deps, out, render);
}

function unwrapOrganization(data) {
  return data?.organization ?? data?.org ?? data;
}

function organizationRows(data) {
  return Array.isArray(data?.organizations) ? data.organizations : Array.isArray(data) ? data : [];
}

async function resolveOrganization(nest, selector, kit) {
  if (selector) return unwrapOrganization(await nest.getOrganization(selector));

  const organizations = organizationRows(await nest.listOrganizations());
  if (organizations.length !== 1) {
    throw new kit.UsageError("Pass --org to select an organization when the current scope is ambiguous.");
  }
  const current = organizations[0];
  const key = current.id ?? current.slug;
  if (!key) throw new kit.Failure("The current organization has no id or slug.");
  return unwrapOrganization(await nest.getOrganization(key));
}

function credentialRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.credentials)) return data.credentials;
  if (Array.isArray(data?.registryCredentials)) return data.registryCredentials;
  return [];
}

function credentialOrganizationId(credential) {
  return credential.organizationId ?? credential.orgId ?? credential.organization?.id;
}

function scopedCredentials(data, organization, kit) {
  const id = organization.id;
  const slug = organization.slug;
  const credentials = credentialRows(data);
  if (credentials.some((credential) => credentialOrganizationId(credential) === undefined && credentialOrganizationSlug(credential) === undefined)) {
    throw new kit.Failure("The owner-wide registry response does not identify which organization owns each credential.");
  }
  return credentials.filter((credential) => {
    const credentialOrgId = credentialOrganizationId(credential);
    const credentialOrgSlug = credentialOrganizationSlug(credential);
    return (id !== undefined && credentialOrgId === id) || (slug !== undefined && credentialOrgSlug === slug);
  });
}

function credentialOrganizationSlug(credential) {
  return credential.organizationSlug ?? credential.orgSlug ?? credential.organization?.slug;
}

function registryHost(credential) {
  const value = credential.registryHost ?? credential.registry ?? credential.host;
  return typeof value === "string" ? value : "";
}

async function readPassword(input, kit) {
  if (typeof input === "string") return input.replace(/\r?\n$/, "");
  if (!input || typeof input[Symbol.asyncIterator] !== "function") {
    throw new kit.UsageError("--password-stdin needs a readable standard input stream.");
  }
  let value = "";
  for await (const chunk of input) value += String(chunk);
  return value.replace(/\r?\n$/, "");
}
