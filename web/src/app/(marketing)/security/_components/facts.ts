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
  /** Most API requests, in KB (DEFAULT_MAX_BODY_BYTES). */
  apiBodyKb: 16,
  /** A deploy hook request body, in KB. */
  deployHookBodyKb: 4,
  /** An MCP request body, in KB. */
  mcpBodyKb: 64,
  /** A GitHub delivery body, in MB. */
  githubBodyMb: 25,
  /** A file upload, in MB (UPLOAD_LIMIT). */
  uploadMb: 50,
  /** How long a GitHub delivery id is remembered, in hours. */
  deliveryHours: 1,
  /** Most build log lines stored for one deployment. */
  buildLogLines: 20_000,
  /** CPUs a build may use. */
  buildCpus: 2,
  /** Most processes a build may run at once. */
  buildProcesses: 2048,
} as const;
