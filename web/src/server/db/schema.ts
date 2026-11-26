import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const ts = (name: string) => integer(name, { mode: "timestamp_ms" });

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  /** Hack Club Auth `sub`. */
  hackClubId: text("hack_club_id").notNull().unique(),
  name: text("name").notNull(),
  email: text("email"),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  slackId: text("slack_id"),
  createdAt: ts("created_at").notNull(),
  /**
   * Set by an administrator's ban. A suspended account keeps working until graceEndsAt, then its writes are
   * refused (see server/account-standing.ts). Reads always work. Changed only through the admin ban actions.
   */
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  suspendedAt: ts("suspended_at"),
  graceEndsAt: ts("grace_ends_at"),
  /** The administrator's reason, kept for the audit trail and the admin page. */
  suspensionReason: text("suspension_reason"),
});

/**
 * Personal access tokens for the public API and AI agents. Only a hash is stored;
 * the token is shown once when it is created. `scopes` is a JSON array.
 */
export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** First characters of the token, shown in lists so tokens can be told apart. */
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull(),
    scopes: text("scopes").notNull(),
    createdAt: ts("created_at").notNull(),
    lastUsedAt: ts("last_used_at"),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("api_tokens_hash_idx").on(t.hash), index("api_tokens_user_idx").on(t.userId)]
);

/** Session ids are stored hashed; the raw token only lives in the cookie. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull(),
    userAgent: text("user_agent"),
    /** When this session last signed in with Hack Club. Sensitive switches need this to be recent. */
    freshAuthAt: ts("fresh_auth_at"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)]
);

export const servers = sqliteTable(
  "servers",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nestUsername: text("nest_username").notNull(),
    host: text("host").notNull(),
    port: integer("port").notNull().default(22),
    /** OpenSSH public key line the user pastes into the Nest dashboard. */
    publicKey: text("public_key").notNull(),
    /** Sealed OpenSSH private key. */
    privateKeyEnc: text("private_key_enc").notNull(),
    /** SHA256 fingerprint of our own key, shown to the user. */
    keyFingerprint: text("key_fingerprint").notNull(),
    /** Pinned host key of the bastion (trust on first use). */
    hostKeyFingerprint: text("host_key_fingerprint"),
    /**
     * Container permissions. Every switch is off for a new server until you turn it on.
     * A server connected before leftover removal became off by default keeps its stored value.
     */
    allowTerminal: integer("allow_terminal", { mode: "boolean" }).notNull().default(false),
    allowFileWrites: integer("allow_file_writes", { mode: "boolean" }).notNull().default(false),
    allowOrphanRemoval: integer("allow_orphan_removal", { mode: "boolean" }).notNull().default(false),
    /** Memory limit of the build sandbox for this server's projects, in MB. Range in lib/build-memory.ts. */
    buildMemoryMb: integer("build_memory_mb").notNull().default(2048),
    /** CPU limit of the build sandbox in quarter-core units. */
    buildCpuQuarters: integer("build_cpu_quarters").notNull().default(8),
    /**
     * One build at a time on a container. The deployment that holds the lock and the
     * last time it renewed it; a lock that is not renewed for a while is free again.
     */
    buildLockHolder: text("build_lock_holder"),
    buildLockAt: ts("build_lock_at"),
    status: text("status", { enum: ["pending", "connected", "error", "disconnected"] })
      .notNull()
      .default("pending"),
    lastError: text("last_error"),
    /** JSON of the last capability probe. */
    probe: text("probe"),
    lastCheckedAt: ts("last_checked_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("servers_user_nest_idx").on(t.userId, t.nestUsername),
    // One Nest account per instance: a server's whole namespace (systemd units,
    // containers, ~/.egg folder, images) lives in that account's home, so two
    // Egg accounts must never point at the same host login.
    uniqueIndex("servers_nest_host_idx").on(t.host, t.nestUsername),
  ]
);

export const githubInstallations = sqliteTable("github_installations", {
  /** GitHub's installation id. */
  id: integer("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const providerConnections = sqliteTable("provider_connections", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["gitlab", "forgejo", "codeberg"] }).notNull(),
  label: text("label").notNull(),
  host: text("host").notNull(),
  tokenEnc: text("token_enc").notNull(),
  createdAt: ts("created_at").notNull(),
}, (t) => [index("provider_connections_user_idx").on(t.userId)]);

export const RUNTIMES = ["node", "python", "static", "command", "go", "rust", "ruby", "php", "java"] as const;
export type Runtime = (typeof RUNTIMES)[number];
export const WORKLOAD_KINDS = ["web", "worker"] as const;
/** "image": a prebuilt container image pulled from a registry; nothing is built from source. */
export const DEPLOYMENT_MODES = ["native", "dockerfile", "compose", "image"] as const;

/**
 * How a new release replaces the running one. "rolling" (the default) starts the new copy before the
 * old one stops; "recreate" stops first; "blue_green" brings the new copy up beside the old one and
 * switches once it is healthy. An app whose containers mount a volume must use "recreate", because
 * two copies must never share a volume at once.
 */
export const DEPLOY_STRATEGIES = ["rolling", "recreate", "blue_green"] as const;
export type DeployStrategy = (typeof DEPLOY_STRATEGIES)[number];
export type PullPolicy = (typeof PULL_POLICIES)[number];

/**
 * Where a project is built. "container": on the user's Nest container, under a memory and CPU
 * cap. "github": in the user's own GitHub Actions workflow, which uploads the finished release;
 * the container then only installs production dependencies and runs it. Egg's own machine
 * builds nothing in either mode.
 */
export const BUILD_LOCATIONS = ["container", "github"] as const;
export type BuildLocation = (typeof BUILD_LOCATIONS)[number];

/**
 * Logins for private container registries, one per owner and registry host. The username and the
 * password are sealed with the instance key (server/crypto); the password is never sent back by the API.
 */
export const registryCredentials = sqliteTable(
  "registry_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Registry host, with an optional port, such as ghcr.io or registry.example.com:5000. */
    host: text("host").notNull(),
    usernameEnc: text("username_enc").notNull(),
    passwordEnc: text("password_enc").notNull(),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [uniqueIndex("registry_credentials_user_host_idx").on(t.userId, t.host)]
);

export const PULL_POLICIES = ["auto", "always", "cached"] as const;

/**
 * An organization groups projects under shared roles. Personal projects have no
 * organization (`projects.orgId` is null).
 */
export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [uniqueIndex("organizations_slug_idx").on(t.slug)]
);

export const ORG_ROLES = ["owner", "admin", "member", "guest"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Organization membership. Owners and admins see every project in the organization. */
export const orgMembers = sqliteTable(
  "org_members",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ORG_ROLES }).notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("org_members_org_user_idx").on(t.orgId, t.userId),
    index("org_members_user_idx").on(t.userId),
  ]
);

export const projects = sqliteTable(
  "projects",
  {
    /** Owner opt-in: download cache may retain private packages; it is not a sandbox. */
    buildCacheEnabled: integer("build_cache_enabled", { mode: "boolean" }).notNull().default(false),
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    /** Lowercase letters, digits and hyphens. Used in paths and unit names. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** "owner/name" on GitHub, when imported through the GitHub App. */
    repoFullName: text("repo_full_name"),
    /** Clone URL. For public repos without the App this is all we have. */
    repoUrl: text("repo_url").notNull(),
    sourceProvider: text("source_provider", { enum: ["github", "gitlab", "forgejo", "codeberg", "generic"] }).notNull().default("github"),
    providerConnectionId: text("provider_connection_id").references(() => providerConnections.id, { onDelete: "restrict" }),
    providerWebhookSecretEnc: text("provider_webhook_secret_enc"),
    installationId: integer("installation_id"),
    productionBranch: text("production_branch").notNull().default("main"),
    rootDir: text("root_dir").notNull().default("."),
    runtime: text("runtime", { enum: RUNTIMES }).notNull(),
    workloadKind: text("workload_kind", { enum: WORKLOAD_KINDS }).notNull().default("web"),
    deploymentMode: text("deployment_mode", { enum: DEPLOYMENT_MODES }).notNull().default("native"),
    deployStrategy: text("deploy_strategy", { enum: DEPLOY_STRATEGIES }).notNull().default("rolling"),
    /** Image mode only: the image reference, such as nginx:1.27 or ghcr.io/owner/app@sha256:... */
    imageRef: text("image_ref"),
    /** Image mode only: when Docker pulls the image. "auto" pulls only if it is missing. */
    pullPolicy: text("pull_policy", { enum: PULL_POLICIES }).notNull().default("auto"),
    /** Image mode only: the registry login for a private image. Null for a public image. */
    registryCredentialId: text("registry_credential_id").references(() => registryCredentials.id, { onDelete: "restrict" }),
    /** Set by the last Compose deploy: the main service mounts a named volume. Such an app must use "recreate". */
    hasVolumes: integer("has_volumes", { mode: "boolean" }).notNull().default(false),
    /** Dockerfile path relative to the repository root; used only in "dockerfile" mode. */
    dockerfilePath: text("dockerfile_path"),
    /** Path of the Compose file relative to the repository root; used only in "compose" mode. */
    composeFilePath: text("compose_file_path"),
    /** The Compose service that is deployed; used only in "compose" mode. */
    composeService: text("compose_service"),
    /** Port the container image listens on; used only in Docker modes. */
    containerPort: integer("container_port"),
    installCommand: text("install_command"),
    buildCommand: text("build_command"),
    startCommand: text("start_command"),
    /** Folder to ship for static sites, relative to the root directory. */
    outputDir: text("output_dir"),
    /** Where builds run: on the container, or in GitHub Actions. */
    buildLocation: text("build_location", { enum: BUILD_LOCATIONS }).notNull().default("container"),
    /** Port the app listens on. Map your domain to this port in Nest. */
    port: integer("port").notNull(),
    listenPort: integer("listen_port"),
    /** Full Egg host-to-container listener list; null keeps the legacy single-port view. */
    servicePorts: text("service_ports"),
    /** Optional private service name recorded by Egg; DNS is managed outside Egg. */
    internalDomain: text("internal_domain"),
    healthPath: text("health_path").notNull().default("/"),
    autoDeploy: integer("auto_deploy", { mode: "boolean" })
      .notNull()
      .default(true),
    /** SHA-256 of the deploy hook token. The token itself is shown once and never stored. */
    hookHash: text("hook_hash"),
    hookCreatedAt: ts("hook_created_at"),
    /** Sealed Discord or Slack webhook URL that gets a message when a deployment finishes. */
    notifyUrlEnc: text("notify_url_enc"),
    notifyOn: text("notify_on", { enum: ["all", "failures"] })
      .notNull()
      .default("all"),
    /** Result of the last uptime check. Alerts fire when this changes, not on every check. */
    monitorState: text("monitor_state", { enum: ["unknown", "up", "down"] })
      .notNull()
      .default("unknown"),
    monitorSince: ts("monitor_since"),
    /** Failed checks in a row. One blip is not an outage. */
    monitorFailures: integer("monitor_failures").notNull().default(0),
    /** Warn when the server's disk, memory or CPU load share reaches this percent. */
    alertDiskPct: integer("alert_disk_pct").notNull().default(90),
    alertMemPct: integer("alert_mem_pct").notNull().default(90),
    alertCpuPct: integer("alert_cpu_pct").notNull().default(90),
    /** Failed checks in a row before the app counts as down. */
    alertFailures: integer("alert_failures").notNull().default(2),
    /** A check slower than this many milliseconds counts as failed. Null means no limit. */
    alertSlowMs: integer("alert_slow_ms"),
    /** Which events go to the webhook. Deploy results also follow `notifyOn`. */
    alertOnDown: integer("alert_on_down", { mode: "boolean" }).notNull().default(true),
    alertOnRecovery: integer("alert_on_recovery", { mode: "boolean" }).notNull().default(true),
    alertOnResource: integer("alert_on_resource", { mode: "boolean" }).notNull().default(true),
    alertOnDeploy: integer("alert_on_deploy", { mode: "boolean" }).notNull().default(true),
    /** Alerts are recorded but not sent until this time. */
    alertMutedUntil: ts("alert_muted_until"),
    /** Muted until someone resumes alerts. */
    alertMutedForever: integer("alert_muted_forever", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Public key for the analytics snippet. Null means analytics is off. */
    analyticsKey: text("analytics_key"),
    /** Unguessable id in the public status page URL. Null means there is no public page. */
    statusKey: text("status_key"),
    /**
     * Owner opt-in: list this project's latest deployments on the public Egg homepage. Separate from the
     * status page. Only ever honoured for a repository that GitHub confirms is public (server/public-feed.ts).
     */
    homepageFeed: integer("homepage_feed", { mode: "boolean" }).notNull().default(false),
    /** While on, the app cannot be deleted (or moved to the trash) until someone switches it off. */
    deletionProtected: integer("deletion_protected", { mode: "boolean" }).notNull().default(false),
    /** systemd's result for the service's last exit, such as "oom-kill". Null when unknown. */
    lastExitResult: text("last_exit_result"),
    /** Organization that owns this project. Null for a personal project. */
    orgId: text("org_id").references(() => organizations.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("projects_user_slug_idx").on(t.userId, t.slug),
    // Unit, container, folder, image and Compose-project names are slug-only on the
    // server, so the slug must be unique per server across all users of that server.
    uniqueIndex("projects_server_slug_idx").on(t.serverId, t.slug),
    uniqueIndex("projects_server_listen_port_idx").on(t.serverId, t.listenPort).where(sql`${t.listenPort} is not null`),
    uniqueIndex("projects_server_internal_domain_idx").on(t.serverId, t.internalDomain).where(sql`${t.internalDomain} is not null`),
    uniqueIndex("projects_hook_idx").on(t.hookHash),
    uniqueIndex("projects_analytics_idx").on(t.analyticsKey),
    uniqueIndex("projects_status_idx").on(t.statusKey),
    index("projects_user_idx").on(t.userId),
    index("projects_org_idx").on(t.orgId),
  ]
);

export const PROJECT_ROLES = ["admin", "member", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Per-project access for people who are not the project owner or an org owner/admin. */
export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: PROJECT_ROLES }).notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("project_members_project_user_idx").on(t.projectId, t.userId),
    index("project_members_user_idx").on(t.userId),
  ]
);

/**
 * Email invitations to an organization. Only the SHA-256 of the token is stored;
 * the link is shown once. `acceptedAt`, `cancelledAt` and `expiresAt` make a
 * token single-use and time-limited.
 */
export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ORG_ROLES }).notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    acceptedBy: text("accepted_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: ts("cancelled_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("invitations_token_hash_idx").on(t.tokenHash),
    index("invitations_org_idx").on(t.orgId),
  ]
);

/**
 * Transfer of a project to another user. The recipient must already be a project
 * member and must accept. Pending requests expire after 7 days.
 */
export const ownershipTransfers = sqliteTable(
  "ownership_transfers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: text("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    state: text("state", { enum: ["pending", "accepted", "declined", "cancelled", "expired"] })
      .notNull()
      .default("pending"),
    expiresAt: ts("expires_at").notNull(),
    resolvedAt: ts("resolved_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("ownership_transfers_project_idx").on(t.projectId, t.state), index("ownership_transfers_to_idx").on(t.toUserId, t.state)]
);

export const providerWebhookDeliveries = sqliteTable("provider_webhook_deliveries", {
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  deliveryId: text("delivery_id").notNull(),
  receivedAt: ts("received_at").notNull(),
}, (t) => [uniqueIndex("provider_webhook_delivery_project_id_idx").on(t.projectId, t.deliveryId)]);

export const envVars = sqliteTable(
  "env_vars",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    valueEnc: text("value_enc").notNull(),
    target: text("target", { enum: ["all", "production", "preview"] })
      .notNull()
      .default("all"),
    secret: integer("secret", { mode: "boolean" }).notNull().default(true),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("env_project_key_idx").on(t.projectId, t.key, t.target)]
);

/** Account-wide sets of variables shared by the owner's projects. */
export const sharedEnvSets = sqliteTable(
  "shared_env_sets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("shared_env_sets_user_name_idx").on(t.userId, t.name),
    uniqueIndex("shared_env_sets_default_user_idx").on(t.userId).where(sql`${t.isDefault} = 1`),
  ]
);

/** Encrypted values stored in one shared environment set. */
export const sharedEnvVars = sqliteTable(
  "shared_env_vars",
  {
    id: text("id").primaryKey(),
    setId: text("set_id")
      .notNull()
      .references(() => sharedEnvSets.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    valueEnc: text("value_enc").notNull(),
    target: text("target", { enum: ["all", "production", "preview"] })
      .notNull()
      .default("all"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("shared_env_vars_set_key_idx").on(t.setId, t.key, t.target)]
);

/**
 * SSH keys Egg generates for you, beyond the per-server key stored on the
 * servers row. Each key's private half is sealed for its own row, and is
 * replaced by a seal of "removed" once the key is revoked.
 */
export const SSH_KEY_KINDS = ["github_deploy", "git_key", "personal"] as const;
export type SshKeyKind = (typeof SSH_KEY_KINDS)[number];

export const sshKeys = sqliteTable(
  "ssh_keys",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The project a github_deploy or git_key belongs to. Always null for personal keys. */
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    /** "github_deploy": added to the linked repo through the GitHub App. "git_key": pasted by you on your own git host. "personal": for your own use outside Egg. */
    kind: text("kind", { enum: SSH_KEY_KINDS }).notNull(),
    name: text("name").notNull(),
    publicKey: text("public_key").notNull(),
    privateKeyEnc: text("private_key_enc").notNull(),
    /** SHA256 fingerprint of the public key, shown in lists. */
    fingerprint: text("fingerprint").notNull(),
    /** The id GitHub gave the deploy key, so it can be removed there on revoke. */
    externalId: text("external_id"),
    createdAt: ts("created_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [
    // One active key per project and kind; revoking frees the slot.
    uniqueIndex("ssh_keys_project_kind_idx")
      .on(t.projectId, t.kind)
      .where(sql`${t.projectId} is not null and ${t.revokedAt} is null`),
    index("ssh_keys_user_idx").on(t.userId),
  ]
);

export const DEPLOY_STATES = [
  "queued",
  "building",
  "deploying",
  "ready",
  "error",
  "canceled",
] as const;
export type DeployState = (typeof DEPLOY_STATES)[number];

export const deployments = sqliteTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    triggeredBy: text("triggered_by"),
    env: text("env", { enum: ["production", "preview"] }).notNull(),
    state: text("state", { enum: DEPLOY_STATES }).notNull().default("queued"),
    source: text("source", {
      enum: ["manual", "webhook", "hook", "redeploy", "rollback"],
    }).notNull(),
    branch: text("branch").notNull(),
    commitSha: text("commit_sha"),
    commitMessage: text("commit_message"),
    /** Pull request this preview was built for, when it came from one. */
    prNumber: integer("pr_number"),
    author: text("author"),
    /** Port this release listens on. Previews get their own. */
    port: integer("port").notNull(),
    listenPort: integer("listen_port"),
    /** Directory name under the project's releases folder on the server. */
    releaseId: text("release_id").notNull(),
    /** True for the release currently serving the production port. */
    isCurrent: integer("is_current", { mode: "boolean" })
      .notNull()
      .default(false),
    /** True once its release folder and service were removed from the server. */
    cleanedUp: integer("cleaned_up", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Size of the uploaded archive, for the log and the UI. */
    archiveBytes: integer("archive_bytes"),
    error: text("error"),
    createdAt: ts("created_at").notNull(),
    startedAt: ts("started_at"),
    /** Set atomically immediately before production/preview activation; cancellation is refused after this point. */
    activationStartedAt: ts("activation_started_at"),
    finishedAt: ts("finished_at"),
    /** Before/after comparison 15 minutes after the deploy became ready. JSON; null until it has run. */
    postDeployCheck: text("post_deploy_check"),
    postDeployCheckedAt: ts("post_deploy_checked_at"),
  },
  (t) => [
    index("deployments_project_idx").on(t.projectId, t.createdAt, t.id),
    index("deployments_state_idx").on(t.state),
    // Closes the check-then-act race in the webhook dedupe: a retried or racing
    // push for the same commit cannot start a second active build.
    uniqueIndex("deployments_active_webhook_commit_idx")
      .on(t.projectId, t.branch, t.commitSha)
      .where(
        sql`${t.source} = 'webhook' and ${t.commitSha} is not null and ${t.state} in ('queued', 'building', 'deploying')`
      ),
    // Closes the same race for deploy hooks: one active hook deployment per project.
    uniqueIndex("deployments_active_hook_idx")
      .on(t.projectId)
      .where(
        sql`${t.source} = 'hook' and ${t.state} in ('queued', 'building', 'deploying')`
      ),
  ]
);

/** Short-lived, operation-scoped credentials for an external GitHub Actions build. */
export const buildCredentials = sqliteTable(
  "build_credentials",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: ["upload_preview", "upload_production", "env_preview", "env_production"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: ts("created_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("build_credentials_project_scope_idx").on(t.projectId, t.scope),
    index("build_credentials_expiry_idx").on(t.expiresAt),
  ]
);

export const deploymentLogs = sqliteTable(
  "deployment_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    at: ts("at").notNull(),
    level: text("level", { enum: ["info", "warn", "error"] })
      .notNull()
      .default("info"),
    message: text("message").notNull(),
  },
  (t) => [index("logs_deployment_idx").on(t.deploymentId, t.id), index("logs_retention_at_idx").on(t.at)]
);

export const domains = sqliteTable(
  "domains",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    domain: text("domain").notNull(),
    port: integer("port").notNull(),
    status: text("status", { enum: ["pending", "valid", "invalid"] })
      .notNull()
      .default("pending"),
    lastCheckedAt: ts("last_checked_at"),
    createdAt: ts("created_at").notNull(),
    /** The last owner action on this domain (added, re-pointed, re-verified). The reclaim
     *  window for an abandoned pending claim runs from this, not from the add date. */
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [uniqueIndex("domains_domain_idx").on(t.domain)]
);

export const JOB_TYPES = ["deploy", "rollback"] as const;

/** A simple durable queue. The worker claims rows with an UPDATE. */
export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: JOB_TYPES }).notNull(),
    /** Deployment the job acts on. */
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    /**
     * The deployment's project, copied here so the database itself can refuse a second
     * running job for one project (`jobs_running_project_idx`). Set when the job is queued
     * and again when it is claimed; null on rows from before migration 0042.
     */
    projectId: text("project_id"),
    state: text("state", {
      enum: ["queued", "running", "done", "failed"],
    })
      .notNull()
      .default("queued"),
    attempts: integer("attempts").notNull().default(0),
    lockedBy: text("locked_by"),
    lockedAt: ts("locked_at"),
    error: text("error"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("jobs_state_idx").on(t.state, t.createdAt),
    // One live job per deployment, so a double enqueue cannot run it twice.
    uniqueIndex("jobs_active_deployment_idx")
      .on(t.deploymentId)
      .where(sql`${t.state} in ('queued', 'running')`),
    // One running job per project, enforced by the database. The claim query already checks
    // this; the index catches anything that gets past it (a second process, a bug).
    uniqueIndex("jobs_running_project_idx")
      .on(t.projectId)
      .where(sql`${t.state} = 'running' and ${t.projectId} is not null`),
  ]
);

/** Durable, explicitly requested cleanup. Remote failure keeps these rows for retry. */
export const cleanupJobs = sqliteTable(
  "cleanup_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope", { enum: ["account", "project"] }).notNull(),
    /** Snapshot id only; the project row is deleted only after remote cleanup succeeds. */
    projectId: text("project_id"),
    state: text("state", { enum: ["draining", "running", "failed", "done"] }).notNull().default("draining"),
    requestedAt: ts("requested_at").notNull(),
    notBefore: ts("not_before").notNull(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    attempts: integer("attempts").notNull().default(0),
    step: text("step").notNull().default("draining"),
    leaseOwner: text("lease_owner"),
    leaseUntil: ts("lease_until"),
    error: text("error"),
    warnings: text("warnings"),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    index("cleanup_jobs_queue_idx").on(t.state, t.notBefore),
    uniqueIndex("cleanup_jobs_active_account_idx")
      .on(t.userId)
      .where(sql`${t.scope} = 'account' and ${t.state} in ('draining', 'running', 'failed')`),
    uniqueIndex("cleanup_jobs_active_project_idx")
      .on(t.userId, t.projectId)
      .where(sql`${t.scope} = 'project' and ${t.state} in ('draining', 'running', 'failed')`),
  ]
);

/** Per-project progress retained until the whole account cleanup is complete. */
export const cleanupItems = sqliteTable(
  "cleanup_items",
  {
    id: text("id").primaryKey(),
    cleanupJobId: text("cleanup_job_id")
      .notNull()
      .references(() => cleanupJobs.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    serverId: text("server_id").notNull(),
    projectName: text("project_name").notNull(),
    projectSlug: text("project_slug").notNull(),
    serverLabel: text("server_label").notNull(),
    state: text("state", { enum: ["pending", "running", "failed", "done"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    step: text("step").notNull().default("pending"),
    error: text("error"),
    warnings: text("warnings"),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    index("cleanup_items_job_idx").on(t.cleanupJobId, t.state),
    uniqueIndex("cleanup_items_job_project_idx").on(t.cleanupJobId, t.projectId),
  ]
);

/** Active SSH sessions opened by Egg. Cleanup waits for them to close. */
export const cleanupOperations = sqliteTable(
  "cleanup_operations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
    openedAt: ts("opened_at").notNull(),
  },
  (t) => [index("cleanup_operations_server_idx").on(t.serverId, t.openedAt)]
);

/** Display and interface choices, one row per user. Values are validated in code, not in SQL. */
export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * Legacy: "light" | "dark" | "system" from before themes were light or dark only. A row that still
   * says light or dark has not been converted; the next save writes "system" and the columns below.
   */
  theme: text("theme").notNull().default("system"),
  /** The fixed theme used when matching the device is off (a theme id; older rows hold an accent name). */
  accent: text("accent").notNull().default("default"),
  /** Use `lightPreset` when the device is light and `darkPreset` when it is dark. */
  matchDevice: integer("match_device", { mode: "boolean" }).notNull().default(true),
  /** The light theme used while matching the device. */
  lightPreset: text("light_preset").notNull().default("egg-light"),
  /** The dark theme used while matching the device. */
  darkPreset: text("dark_preset").notNull().default("egg-dark"),
  /** "comfortable" | "compact". */
  density: text("density").notNull().default("comfortable"),
  /** "system" | "reduce" | "no-preference". */
  reducedMotion: text("reduced_motion").notNull().default("system"),
  defaultBranch: text("default_branch"),
  displayName: text("display_name"),
  avatar: text("avatar").notNull().default("pixel-01"),
  /** JSON object of the analytics features a new project starts with. `{}` means every one is off. */
  analyticsDefaults: text("analytics_defaults").notNull().default("{}"),
  /** JSON object of per-chapter marks, see src/lib/onboarding-marks.ts */
  onboarding: text("onboarding").notNull().default("{}"),
  /** Show the display name on public status pages and the homepage feed. Off shows "Someone". */
  showNamePublic: integer("show_name_public", { mode: "boolean" }).notNull().default(true),
  updatedAt: ts("updated_at").notNull(),
});

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;

/**
 * A person's own colour themes. Private to the owner: every read and write is
 * by (id, user_id). `tokens` is a JSON object of hex colours for the names in
 * THEME_TOKENS (src/lib/custom-theme.ts), checked on the way in and again on
 * the way out. At most 20 per account (CUSTOM_THEME_LIMIT).
 */
export const userThemes = sqliteTable(
  "user_themes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "light" | "dark". */
    scheme: text("scheme").notNull(),
    tokens: text("tokens").notNull(),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("user_themes_user_idx").on(t.userId)]
);

export type UserTheme = typeof userThemes.$inferSelect;

/**
 * Who did what. `level` says which scope the entry belongs to: an app event, an
 * organization event (then `orgId` is set) or an instance-wide admin event. Kept
 * for 180 days (see cleanup-audit.ts).
 */
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id"),
  action: text("action").notNull(),
  target: text("target"),
  meta: text("meta"),
  level: text("level", { enum: ["app", "organization", "instance"] }).notNull().default("app"),
  orgId: text("org_id"),
  at: ts("at").notNull(),
}, (t) => [index("audit_log_action_at_idx").on(t.action, t.at), index("audit_log_at_idx").on(t.at), index("audit_log_org_idx").on(t.orgId, t.at)]);

/** Server load, memory and disk, sampled by the worker so the dashboard can show trends. */
export const usageSamples = sqliteTable(
  "usage_samples",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    at: ts("at").notNull(),
    cpuLoad: real("cpu_load"),
    cpus: integer("cpus"),
    memUsedMb: integer("mem_used_mb"),
    memTotalMb: integer("mem_total_mb"),
    diskUsedMb: integer("disk_used_mb"),
    diskTotalMb: integer("disk_total_mb"),
  },
  (t) => [index("usage_server_at_idx").on(t.serverId, t.at)]
);

/**
 * One row per page view reported by the analytics snippet. There is no IP, no
 * cookie and no user agent here. `visitor` is a hash that changes every day,
 * so it can count a day's visitors but cannot follow anyone across days.
 */
export const pageviews = sqliteTable(
  "pageviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    at: ts("at").notNull(),
    path: text("path").notNull(),
    /** The referring site's host, only when the project records referrers. */
    referrer: text("referrer"),
    visitor: text("visitor").notNull(),
    /** The campaign values from the address, only when the project records referrers. At most 80 characters each. */
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    /** Salted HMAC of the random id in the visitor's browser, only when the project records retention. */
    vid: text("vid"),
    /** Two-letter country code (ISO 3166-1 alpha-2), only when the project records visitor countries. Never an IP address, city or region. */
    country: text("country"),
  },
  (t) => [index("pageviews_project_at_idx").on(t.projectId, t.at)]
);

/**
 * Which extra things a project's analytics script may record. Every switch is
 * off until the owner turns it on, and a project with no row here has them all
 * off. `funnelSteps` is a JSON array of { kind: "page" | "track", value }.
 */
export const analyticsSettings = sqliteTable("analytics_settings", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  clicks: integer("clicks", { mode: "boolean" }).notNull().default(false),
  time: integer("time", { mode: "boolean" }).notNull().default(false),
  funnel: integer("funnel", { mode: "boolean" }).notNull().default(false),
  funnelSteps: text("funnel_steps"),
  /** Referring site and campaign values on page views. */
  referrers: integer("referrers", { mode: "boolean" }).notNull().default(false),
  /** Raw UTM values are never collected unless this additional opt-in is enabled. */
  campaigns: integer("campaigns", { mode: "boolean" }).notNull().default(false),
  /** JSON allowlists keyed by source/medium/campaign; only exact listed labels are transmitted. */
  utmAllowlist: text("utm_allowlist").notNull().default("{}"),
  /** Per-project analytics retention. 90 preserves the legacy behavior. */
  retentionDays: integer("retention_days").notNull().default(90),
  /** Web vitals and script errors. */
  vitals: integer("vitals", { mode: "boolean" }).notNull().default(false),
  /** Custom events (data-egg-track with an optional data-egg-value). */
  events: integer("events", { mode: "boolean" }).notNull().default(false),
  /** The "on the site now" view. */
  live: integer("live", { mode: "boolean" }).notNull().default(false),
  /** A random id in the visitor's browser, to tell new visitors from returning ones. */
  retention: integer("retention", { mode: "boolean" }).notNull().default(false),
  /** The visitor's country (two letters, from a bundled offline database) on page views. Off by default. */
  locations: integer("locations", { mode: "boolean" }).notNull().default(false),
  updatedAt: ts("updated_at").notNull(),
});

/**
 * Opt-in analytics events other than page views. `kind` is "click" (`label` is
 * a short element label), "time" (`bucket` is a time-on-page bucket) or
 * "goal" (`label` is a funnel step name). Click and time rows carry no visitor
 * id and no timestamp, only the UTC `day` and the project. A goal row also
 * carries the same daily salted `visitor` hash as a page view and the time
 * (`at`), because a funnel has to count a visitor once and in order.
 */
export const analyticsEvents = sqliteTable(
  "analytics_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    kind: text("kind").notNull(),
    label: text("label"),
    bucket: text("bucket"),
    visitor: text("visitor"),
    at: ts("at"),
    /** For kind "track": the optional data-egg-value (at most 40 plain characters). */
    value: text("value"),
  },
  (t) => [index("analytics_events_project_day_idx").on(t.projectId, t.day, t.kind)]
);

/**
 * One speed summary per page view, sent when the page is hidden. Each metric is
 * rounded and null when the browser did not report it. Milliseconds, except
 * `cls`, which is a unitless score. No visitor id.
 */
export const analyticsVitals = sqliteTable(
  "analytics_vitals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    at: ts("at").notNull(),
    path: text("path").notNull(),
    lcp: integer("lcp"),
    cls: real("cls"),
    inp: integer("inp"),
    fcp: integer("fcp"),
    ttfb: integer("ttfb"),
  },
  (t) => [index("analytics_vitals_project_at_idx").on(t.projectId, t.at)]
);

/**
 * A JavaScript error reported by the page: the message (at most 200
 * characters), the script's file name without its address, and the line.
 * No stack, no address, no visitor id.
 */
export const analyticsErrors = sqliteTable(
  "analytics_errors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    at: ts("at").notNull(),
    message: text("message").notNull(),
    file: text("file"),
    line: integer("line"),
  },
  (t) => [index("analytics_errors_project_at_idx").on(t.projectId, t.at)]
);

/**
 * Triage state of an error group. Groups are computed from `analytics_errors`
 * by fingerprint (see server/error-fingerprint.ts); this row only holds what a
 * person decided. No message or query string is stored here. A group with no
 * row is open and unassigned.
 */
export const analyticsErrorGroups = sqliteTable(
  "analytics_error_groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    status: text("status", { enum: ["open", "resolved", "ignored"] }).notNull().default("open"),
    /** The project member this group is assigned to, or null. */
    assigneeId: text("assignee_id"),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [uniqueIndex("analytics_error_groups_project_fp_idx").on(t.projectId, t.fingerprint)]
);

/**
 * Heartbeats for the live view: one row a minute from each open, visible page,
 * with the salted retention code. Deleted after an hour.
 */
export const analyticsLive = sqliteTable(
  "analytics_live",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    at: ts("at").notNull(),
    vid: text("vid").notNull(),
  },
  (t) => [index("analytics_live_project_at_idx").on(t.projectId, t.at)]
);

/** Memory, CPU and restarts of one project's service, sampled by the worker. */
export const projectSamples = sqliteTable(
  "project_samples",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    at: ts("at").notNull(),
    memMb: real("mem_mb"),
    /** Share of one CPU core used since the previous sample, in percent. */
    cpuPercent: real("cpu_percent"),
    /** Total CPU time the service has used, in nanoseconds. Used to work out cpuPercent. */
    cpuNs: real("cpu_ns"),
    restarts: integer("restarts"),
    /**
     * Exit status and systemd's reason (exit-code, signal, oom-kill, ...) of the
     * service's last main process, kept when it was not a clean exit. Only the
     * status and the reason are kept, never the program's output.
     */
    exitCode: integer("exit_code"),
    exitReason: text("exit_reason"),
    /** Time the health path took, in milliseconds. Null when nothing answered or it was not checked. */
    healthMs: integer("health_ms"),
    /** Whether the health path answered below a server error. Null when the service was not checked. */
    healthOk: integer("health_ok", { mode: "boolean" }),
  },
  (t) => [index("project_samples_idx").on(t.projectId, t.at)]
);

export const ALERT_RULE_METRICS = ["cpu_percent", "memory_mb", "latency_ms"] as const;
export type AlertRuleMetric = (typeof ALERT_RULE_METRICS)[number];
export const ALERT_RULE_STATUSES = ["ok", "over", "firing", "recovering", "no_data"] as const;
export type AlertRuleStatus = (typeof ALERT_RULE_STATUSES)[number];

/**
 * A threshold rule on one app metric. `status` is the last evaluated state; the
 * time fields say when the metric first crossed the line and when it came back.
 */
export const alertRules = sqliteTable(
  "alert_rules",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    metric: text("metric", { enum: ALERT_RULE_METRICS }).notNull(),
    comparison: text("comparison", { enum: ["above", "below"] }).notNull(),
    threshold: real("threshold").notNull(),
    /** Minutes the metric must stay past the threshold before the rule fires. */
    durationMinutes: integer("duration_minutes").notNull(),
    paused: integer("paused", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ALERT_RULE_STATUSES }).notNull().default("ok"),
    breachSince: ts("breach_since"),
    recoverSince: ts("recover_since"),
    lastValue: real("last_value"),
    evaluatedAt: ts("evaluated_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("alert_rules_project_idx").on(t.projectId)]
);

/**
 * A deleted app, kept for 30 days. `payload` is a snapshot of its rows (sealed
 * fields stay sealed); restoring puts them back under the same ids.
 */
export const projectTrash = sqliteTable(
  "project_trash",
  {
    projectId: text("project_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    serverId: text("server_id").notNull(),
    payload: text("payload").notNull(),
    deletedAt: ts("deleted_at").notNull(),
    purgeAt: ts("purge_at").notNull(),
  },
  (t) => [index("project_trash_user_idx").on(t.userId), index("project_trash_purge_idx").on(t.purgeAt)]
);

export const ALERT_TYPES = ["down", "disk", "memory", "cpu", "deploy"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/**
 * Alerts that fired, kept for 90 days. A row stays open (no `resolvedAt`)
 * while the problem lasts, so one crossing fires once. Deploy results are
 * single events and never resolve.
 */
export const alertEvents = sqliteTable(
  "alert_events",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type", { enum: ALERT_TYPES }).notNull(),
    message: text("message").notNull(),
    firedAt: ts("fired_at").notNull(),
    resolvedAt: ts("resolved_at"),
    /** True when alerts were muted as it fired, so nothing was sent. */
    muted: integer("muted", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("alert_events_project_idx").on(t.projectId, t.firedAt)]
);

// --- outbound webhooks (webhooks-anchor) ---

export const WEBHOOK_EVENTS = [
  "deployment.started",
  "deployment.succeeded",
  "deployment.failed",
  "deploy.regressed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/**
 * An address the owner wants told about deployments. The secret is sealed
 * (never stored in the clear) and shown once. `projectId` null means every
 * project the owner has; `events` is a JSON array of WEBHOOK_EVENTS.
 */
export const webhooks = sqliteTable(
  "webhooks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secretEnc: text("secret_enc").notNull(),
    events: text("events").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
    secretRotatedAt: ts("secret_rotated_at"),
  },
  (t) => [index("webhooks_user_idx").on(t.userId)]
);

/** One delivery of one event to one webhook, kept for 30 days. */
export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    deploymentId: text("deployment_id"),
    status: text("status", { enum: ["pending", "success", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Short code only (for example http_500, timeout, blocked_address), never a response body. */
    lastErrorCode: text("last_error_code"),
    createdAt: ts("created_at").notNull(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt),
    index("webhook_deliveries_created_idx").on(t.createdAt),
  ]
);

/** Hashes of authenticated inbound GitHub payloads, retained to reject replays across restarts. */
export const githubWebhookEvents = sqliteTable("github_webhook_events", {
  /** Legacy SQL column name; now stores the digest of event type plus signed body. */
  eventHash: text("body_hash").primaryKey(),
  receivedAt: ts("received_at").notNull(),
});

/**
 * Every pull_request webhook event for a project, recorded from the day this
 * shipped (GitHub is not backfilled). `action` is the GitHub action as sent;
 * the activity heatmap counts "opened". Kept apart from deployments so a PR
 * that never builds still shows up.
 */
export const pullRequestEvents = sqliteTable("pull_request_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  number: integer("number").notNull(),
  createdAt: ts("created_at").notNull(),
}, (t) => [index("pull_request_events_project_idx").on(t.projectId, t.createdAt)]);

/**
 * Per-project switches for the statistics section. Every switch defaults to off;
 * a project with no row has everything off. Visitors is the same data as the
 * analytics pages, shown on the statistics section only when this is on.
 */
export const projectStatistics = sqliteTable("project_statistics", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  deployCount: integer("deploy_count", { mode: "boolean" }).notNull().default(false),
  deploySuccess: integer("deploy_success", { mode: "boolean" }).notNull().default(false),
  buildTime: integer("build_time", { mode: "boolean" }).notNull().default(false),
  visitors: integer("visitors", { mode: "boolean" }).notNull().default(false),
  updatedAt: ts("updated_at").notNull(),
});

/** Local-mode credential hash; the recovery secret remains in the owner's private environment. */
export const localAuthCredentials = sqliteTable("local_auth_credentials", {
  id: text("id").primaryKey(),
  /** Null for the local-mode owner row; set for a person who turned on password sign-in. A row is the switch: no row, no password. */
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  /** Scrypt hash of the recovery key; the key itself is shown once and never stored. */
  recoveryKeyHash: text("recovery_key_hash"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
}, (t) => [uniqueIndex("local_auth_credentials_user_idx").on(t.userId)]);

/** Private vulnerability reports; report text, identity and evidence are sealed together. */
export const securityReports = sqliteTable("security_reports", {
  id: text("id").primaryKey(),
  payloadEnc: text("payload_enc").notNull(),
  storedBytes: integer("stored_bytes").notNull(),
  status: text("status", { enum: ["new", "reviewing", "resolved"] }).notNull().default("new"),
  createdAt: ts("created_at").notNull(),
}, (t) => [index("security_reports_created_idx").on(t.createdAt)]);

/** Instance-wide operational settings. Only the explicitly configured administrator may change them. */
export const instanceSettings = sqliteTable("instance_settings", {
  id: text("id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  message: text("message").notNull().default(""),
  startsAt: ts("starts_at"),
  endsAt: ts("ends_at"),
  updatedAt: ts("updated_at").notNull(),
  updatedBy: text("updated_by").notNull(),
});

/**
 * Accounts that administer the instance, granted by an existing administrator. The account named in
 * SECURITY_REPORT_ADMIN_ID is always an administrator and cannot be removed here.
 */
export const instanceAdmins = sqliteTable("instance_admins", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  grantedBy: text("granted_by").references(() => users.id, { onDelete: "set null" }),
  grantedAt: ts("granted_at").notNull(),
});

/**
 * One reachability check of Nest or of Egg itself, once a minute. Public figures
 * only: no user, project or visitor is stored. `latencyMs` is null when nothing
 * answered. Kept for 90 days.
 */
export const statusProbes = sqliteTable(
  "status_probes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    target: text("target", { enum: ["nest-site", "nest-app", "egg"] }).notNull(),
    checkedAt: ts("checked_at").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    httpStatus: integer("http_status"),
    latencyMs: integer("latency_ms"),
  },
  (t) => [index("status_probes_target_at_idx").on(t.target, t.checkedAt)]
);

/**
 * A command that runs on a schedule inside the project's current release, as a
 * systemd timer on the container. What the container knows (the last run, its
 * result) is read live and not stored here, so it can never be stale.
 */
export const scheduledJobs = sqliteTable(
  "scheduled_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Five-field cron expression, normalised. Times are UTC. */
    schedule: text("schedule").notNull(),
    command: text("command").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("scheduled_jobs_project_idx").on(t.projectId)]
);

/** Completed backend deployment stages. Metadata contains only allowlisted measurements. */
export const deployStageMetrics = sqliteTable("deploy_stage_metrics", {
  id: text("id").primaryKey(),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  startedAt: ts("started_at").notNull(),
  finishedAt: ts("finished_at").notNull(),
  durationMs: integer("duration_ms").notNull(),
  bytes: integer("bytes"),
  metadata: text("metadata"),
}, (t) => [index("deploy_stage_metrics_deployment_idx").on(t.deploymentId)]);

/** Shared coordination for periodic, idempotent control-plane maintenance. */
export const maintenanceLeases = sqliteTable("maintenance_leases", {
  name: text("name").primaryKey(), owner: text("owner").notNull(),
  expiresAt: ts("expires_at").notNull(), updatedAt: ts("updated_at").notNull(),
});

/** Expiring encrypted import plans; only the server owner may confirm a cutover. */
export const adoptionPlans = sqliteTable("adoption_plans", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  payloadEnc: text("payload_enc").notNull(), state: text("state").notNull().default("planned"),
  createdAt: ts("created_at").notNull(), expiresAt: ts("expires_at").notNull(),
  confirmedAt: ts("confirmed_at"), error: text("error"),
});

// --- OAuth 2.1 / PKCE (oauth-anchor) ---

/**
 * A registered OAuth client. `client_id` is the public identifier (prefixed
 * `eggcli_`) and is safe to store in the clear; `client_secret_hash` is a
 * SHA-256 hash, so the secret is shown only once at registration.
 * `redirect_uris` and `scopes` are JSON arrays.
 */
export const oauthClients = sqliteTable(
  "oauth_clients",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    clientId: text("client_id").notNull().unique(),
    clientSecretHash: text("client_secret_hash").notNull(),
    /** JSON array of exact redirect URIs, matched literally at token time. */
    redirectUris: text("redirect_uris").notNull(),
    /** JSON array of scope strings this client may request. */
    scopes: text("scopes").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("oauth_clients_user_idx").on(t.userId)]
);

/**
 * A short-lived, single-use authorization code (10 minutes). Only the SHA-256
 * hash of the code is stored; `code_challenge` is the PKCE S256 challenge.
 */
export const oauthGrants = sqliteTable(
  "oauth_grants",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    scopes: text("scopes").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
  },
  (t) => [index("oauth_grants_user_idx").on(t.userId)]
);

/**
 * An issued access token (1 day). Only its SHA-256 hash is stored and looked
 * up; the raw token (prefixed `egg_oauth_`) is shown only once.
 */
export const oauthTokens = sqliteTable(
  "oauth_tokens",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    scopes: text("scopes").notNull(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull(),
    /** The refresh-token family this access token belongs to, so revoking the family revokes it too. */
    familyId: text("family_id"),
  },
  (t) => [index("oauth_tokens_user_idx").on(t.userId), index("oauth_tokens_family_idx").on(t.familyId)]
);

/**
 * A refresh token (30 days from the first grant of its family). Only the hash
 * is stored. Every use rotates it: the presented row gets `used_at` and a new
 * row joins the same family. Presenting a row that is already used means the
 * token leaked, so the whole family and its access tokens are revoked.
 */
export const oauthRefreshTokens = sqliteTable(
  "oauth_refresh_tokens",
  {
    id: text("id").primaryKey(),
    familyId: text("family_id").notNull(),
    clientId: text("client_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    scopes: text("scopes").notNull(),
    /** Absolute: rotation carries this forward, so a family cannot be kept alive forever. */
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("oauth_refresh_tokens_family_idx").on(t.familyId), index("oauth_refresh_tokens_user_idx").on(t.userId)]
);

/**
 * One Idempotency-Key answer, per (token, key). A row is a claim while `state` is
 * pending, then holds the first answer for replay. A sensitive answer is stored
 * with an empty body, so a repeat is refused and no secret is kept. A row expires
 * 24 hours after it was claimed. `claimId` lets only the request that made the
 * claim finish or release it.
 */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    /** The token id that made the first request, so one token never replays another's answer. */
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    claimId: text("claim_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    state: text("state", { enum: ["pending", "done"] }).notNull(),
    status: integer("status"),
    body: text("body").notNull().default(""),
    headers: text("headers").notNull().default("[]"),
    sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false),
    createdAt: ts("created_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] }), index("idempotency_keys_expires_idx").on(t.expiresAt)]
);

/** Installed first-party grafts are selected from the static Egg registry. */
export const graftInstallations = sqliteTable("graft_installations", {
  graftId: text("graft_id").primaryKey(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  changedBy: text("changed_by").references(() => users.id, { onDelete: "set null" }),
  changedAt: ts("changed_at").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const graftAnnouncements = sqliteTable(
  "graft_announcements",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    publishedAt: ts("published_at"),
    expiresAt: ts("expires_at"),
    createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("graft_announcements_feed_idx").on(t.status, t.pinned, t.publishedAt)]
);

export const graftAnnouncementDismissals = sqliteTable(
  "graft_announcement_dismissals",
  {
    announcementId: text("announcement_id")
      .notNull()
      .references(() => graftAnnouncements.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dismissedAt: ts("dismissed_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.announcementId, t.userId] }),
    index("graft_announcement_dismissals_user_idx").on(t.userId),
  ]
);

export const GRAFT_FORUM_CATEGORIES = ["bug", "feature", "question", "discussion"] as const;
export const GRAFT_FORUM_STATUSES = ["open", "planned", "in_progress", "complete", "declined"] as const;
export const GRAFT_FORUM_PRIORITIES = ["normal", "high", "low"] as const;

export const graftForumThreads = sqliteTable(
  "graft_forum_threads",
  {
    id: text("id").primaryKey(),
    category: text("category", { enum: GRAFT_FORUM_CATEGORIES }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: GRAFT_FORUM_STATUSES }).notNull().default("open"),
    priority: text("priority", { enum: GRAFT_FORUM_PRIORITIES }).notNull().default("normal"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("graft_forum_threads_feed_idx").on(t.pinned, t.updatedAt)]
);

export const graftForumReplies = sqliteTable(
  "graft_forum_replies",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => graftForumThreads.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("graft_forum_replies_thread_idx").on(t.threadId, t.createdAt)]
);

export const graftForumVotes = sqliteTable(
  "graft_forum_votes",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => graftForumThreads.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.threadId, t.userId] }),
    index("graft_forum_votes_user_idx").on(t.userId),
  ]
);

export const GRAFT_GREENHOUSE_STATUSES = ["draft", "active", "review", "complete"] as const;

export const graftGreenhouseWorkspaces = sqliteTable(
  "graft_greenhouse_workspaces",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    goal: text("goal").notNull(),
    branch: text("branch"),
    status: text("status", { enum: GRAFT_GREENHOUSE_STATUSES }).notNull().default("draft"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("graft_greenhouse_user_idx").on(t.userId, t.updatedAt), index("graft_greenhouse_project_idx").on(t.projectId)]
);

export const graftGreenhouseNotes = sqliteTable(
  "graft_greenhouse_notes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => graftGreenhouseWorkspaces.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("graft_greenhouse_notes_workspace_idx").on(t.workspaceId, t.createdAt)]
);
