/**
 * The numbers the Security page states. Each one is checked against the code
 * that enforces it in security-facts.test.ts, so the page cannot drift from the
 * product without a failing test. The numbers that are shared with the homepage
 * (sign-in window, terminal times, token expiry) stay in home-facts.ts.
 */
export const SECURITY_FACTS = {
  /** Sign-in requests from one address, per minute (RATE_LIMITS.signIn). */
  signInPerMinute: 20,
  /** Unrecognised access tokens from one address, per minute (RATE_LIMITS.badToken). */
  badTokenPerMinute: 60,
  /** Terminal keystrokes sent by one account, per minute (RATE_LIMITS.terminalInput). */
  terminalInputPerMinute: 300,
  /** File changes by one account, per minute (RATE_LIMITS.fileWrite). */
  fileChangesPerMinute: 60,
  /** Listing, reading and downloading files, per account per minute (FILE_READ_LIMIT). */
  fileReadsPerMinute: 120,
  /** Leftover removals by one account, per minute (RATE_LIMITS.orphanRemoval). */
  leftoverRemovalsPerMinute: 10,
  /** Terminals one account can have open at once (TERMINAL_LIMITS.maxSessionsPerUser). */
  terminalsPerAccount: 5,
  /** Most requests made with an access token, in KB (DEFAULT_MAX_BODY_BYTES). */
  apiBodyKb: 16,
  /** JSON requests from a signed-in browser, in KB (JSON_BODY_LIMIT). */
  dashboardBodyKb: 256,
  /** Public analytics collector request bodies, in bytes. */
  analyticsCollectBodyBytes: 5000,
  /** A deploy hook request body, in KB. */
  deployHookBodyKb: 4,
  /** An MCP request body, in KB. */
  mcpBodyKb: 64,
  /** A GitHub delivery body, in MB. */
  githubBodyMb: 5,
  /** A file upload, in MB (UPLOAD_LIMIT). */
  uploadMb: 50,
  /** How long an authenticated GitHub body digest is retained for replay prevention. */
  deliveryDigestRetention: "indefinitely",
  /** Most build log lines stored for one deployment. */
  buildLogLines: 20_000,
  /** Memory cap of a build on a new server, in MB (DEFAULT_CONTAINER_BUILD_MEMORY_MB). */
  buildMemoryMb: 512,
  /** A project with a build step gets at least this much while it builds, if the container has room, in MB (BUILD_STEP_FLOOR_MB). */
  buildStepFloorMb: 1024,
  /** Memory a build never takes from the container, kept for the app, in MB (CONTAINER_RESERVE_MB). */
  buildReserveMb: 512,
  /** A build does not start when its cap would be under this, in MB (MIN_CONTAINER_CAP_MB). */
  buildMinCapMb: 256,
  /** Free disk a build needs on the container, in MB (MIN_FREE_DISK_MB). */
  buildMinFreeDiskMb: 2048,
  /** A build is stopped after this long, in minutes (BUILD_TIMEOUT_SECONDS). */
  buildMinutes: 15,
  /** Default CPU cap of one build, in cores. */
  buildCpuDefault: 2,
  /** Smallest configurable build CPU cap, in cores. */
  buildCpuMin: 0.5,
  /** CPU setting increment, in cores. */
  buildCpuStep: 0.25,
  /** Most processes a build may run at once (TasksMax in systemdRunArgs). */
  buildProcesses: 4096,
  /** Most allowed values in each of the three campaign lists (UTM_ALLOWLIST_MAX). */
  utmAllowlistMax: 20,
  /** Longest allowed campaign value, in characters (UTM_ALLOWLIST_VALUE). */
  utmValueChars: 40,
  /** The days a project can choose to keep page views and events (featuresPatch.retentionDays). */
  analyticsKeepDays: [30, 60, 90],
  /** The days a project keeps them until it chooses (NO_FEATURES.retentionDays, PAGEVIEW_KEEP_MS). */
  analyticsKeepDefaultDays: 90,
  /** How often the key behind the returning-visitor code changes, in days (RETENTION_PERIOD_MS). */
  retentionRotationDays: 90,
} as const;
