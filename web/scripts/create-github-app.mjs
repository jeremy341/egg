// Create the Egg GitHub App for this machine, without copying secrets by hand.
//
//   node scripts/create-github-app.mjs
//
// GitHub only lets an app be created from a browser form, so this runs a tiny
// local page that submits the app's settings (a "manifest") to GitHub. You click
// one button on GitHub. GitHub then sends the browser back here with a one-time
// code, which this script exchanges for the app's credentials and writes them
// into web/.env.local. Secrets are never printed.
//
// Requires: the gh CLI is not needed; only a browser and this machine's network.
//
//   node scripts/create-github-app.mjs --self-check   (run the built-in checks)

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile } from "./doctor-checks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, "..", ".env.local");
const PORT = 4123;
// The shell variable wins. Otherwise use the APP_URL that setup wrote to web/.env.local.
if (!process.env.APP_URL && existsSync(envPath)) {
  const fromFile = parseEnvFile(readFileSync(envPath, "utf8")).APP_URL;
  if (fromFile) process.env.APP_URL = fromFile;
}
const APP_URL = process.env.APP_URL ?? "http://localhost:3100";
const STATE = randomBytes(16).toString("hex");

// Only the address this server is actually reachable on may drive it. Anything
// else (an attacker-controlled host that DNS-rebinds to 127.0.0.1) is refused.
const ALLOWED_HOSTS = new Set(["localhost:4123", "127.0.0.1:4123"]);
const ALLOWED_ORIGINS = new Set(["http://localhost:4123", "http://127.0.0.1:4123"]);

const manifest = {
  name: `Egg (${process.env.USER ?? process.env.USERNAME ?? "local"}-${STATE.slice(0, 4)})`,
  url: APP_URL,
  description: "Deploys GitHub repositories to a Hack Club Nest container.",
  public: false,
  // No hook_attributes: GitHub refuses localhost hook URLs, so the webhook is set up later.
  redirect_url: `http://localhost:${PORT}/callback`,
  callback_urls: [`${APP_URL}/api/github/callback`],
  setup_url: `${APP_URL}/api/github/callback`,
  setup_on_update: true,
  request_oauth_on_install: true,
  default_permissions: {
    contents: "read",
    metadata: "read",
    pull_requests: "write",
  },
  default_events: ["push", "pull_request"],
};

// ------------------------------------------------------------ input validation

/** The Host header must name this loopback service on this exact port. */
export function isAllowedHost(host) {
  return ALLOWED_HOSTS.has(String(host ?? "").trim().toLowerCase());
}

/**
 * Gate every request. Host is the defence against DNS rebinding: a rebound page
 * reaches 127.0.0.1 but still sends its own host, so it fails the check. An
 * Origin, when a browser sends one, must match this origin too. The page that
 * carries STATE additionally refuses cross-site fetches; /callback is left
 * alone because a GitHub redirect is a legitimate cross-site navigation there.
 */
export function requestAllowed(req, pathname) {
  const headers = req?.headers ?? {};
  if (!isAllowedHost(headers.host)) return false;
  const origin = headers.origin;
  if (origin !== undefined && origin !== null && !ALLOWED_ORIGINS.has(String(origin).trim().toLowerCase())) return false;
  if (pathname === "/" && String(headers["sec-fetch-site"] ?? "").trim().toLowerCase() === "cross-site") return false;
  return true;
}

/** Escape a value before it goes into an HTML attribute or text node. */
export function escapeHtml(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, (c) => entities[c]);
}

/**
 * Return the canonical https://github.com/<path> URL, or null when the value is
 * not one. Never accept javascript:, plain http:, lookalike hosts, credentials
 * or a non-default port; the caller only interpolates a non-null result.
 */
export function safeGithubUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname.toLowerCase() !== "github.com") return null;
  if (url.username || url.password || (url.port && url.port !== "443")) return null;
  if (!url.pathname.startsWith("/") || url.pathname === "/") return null;
  return `https://github.com${url.pathname.replace(/\/+$/, "")}`;
}

// ------------------------------------------------------------------- env file

/**
 * Merge values into a .env.local file. Secrets are only ever written with
 * owner-only permissions: a new file is created 0600 and an existing one is
 * chmodded to 0600 before the new values land in it.
 */
export function writeEnv(values, target = envPath, fs = { existsSync, readFileSync, writeFileSync, chmodSync }) {
  const existed = fs.existsSync(target);
  const lines = existed ? fs.readFileSync(target, "utf8").split(/\r?\n/) : [];
  const keys = Object.keys(values);
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const key = keys.find((k) => line.startsWith(`${k}=`));
    if (key) {
      out.push(`${key}=${values[key]}`);
      seen.add(key);
    } else {
      out.push(line);
    }
  }
  for (const k of keys) if (!seen.has(k)) out.push(`${k}=${values[k]}`);
  while (out.length && out[out.length - 1] === "") out.pop();
  if (existed) {
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // Some platforms (Windows) do not support chmod; writing still proceeds.
    }
  }
  fs.writeFileSync(target, out.join("\n") + "\n", { mode: 0o600 });
}

// --------------------------------------------------------------------- pages

function page() {
  const body = JSON.stringify(manifest).replace(/</g, "\\u003c");
  return `<!doctype html>
<meta charset="utf-8">
<title>Create the Egg GitHub App</title>
<body style="font-family: system-ui; max-width: 36rem; margin: 3rem auto; line-height: 1.5">
<h1>Create the GitHub App</h1>
<p>This sends the Egg app settings to GitHub. You will see GitHub's own page with the name and permissions. Press <b>Create GitHub App</b> there.</p>
<form id="f" method="post" action="https://github.com/settings/apps/new?state=${STATE}">
  <input type="hidden" name="manifest" value="">
  <button type="submit" style="font-size: 1rem; padding: 0.5rem 1rem">Continue to GitHub</button>
</form>
<script>
  const manifest = ${body};
  const f = document.getElementById("f");
  f.elements.manifest.value = JSON.stringify(manifest);
  f.submit();
</script>
</body>`;
}

// --------------------------------------------------------------------- server

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (!requestAllowed(req, url.pathname)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("This request did not come from this machine's callback page.");
    return;
  }

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page());
    return;
  }

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || state !== STATE) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("That link is not valid. Run the script again.");
      return;
    }
    try {
      const r = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
        method: "POST",
        headers: { accept: "application/vnd.github+json", "user-agent": "egg-setup" },
      });
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
      const app = await r.json();

      // GitHub will not configure the webhook while the app points at localhost,
      // so no webhook_secret comes back. Generate one and store it ourselves.
      const webhookSecret = randomBytes(32).toString("hex");
      writeEnv({
        GITHUB_APP_ID: String(app.id),
        GITHUB_APP_SLUG: app.slug,
        GITHUB_APP_CLIENT_ID: app.client_id,
        GITHUB_APP_CLIENT_SECRET: app.client_secret,
        GITHUB_APP_PRIVATE_KEY: String(app.pem).replace(/\r?\n/g, "\\n"),
        GITHUB_WEBHOOK_SECRET: String(app.webhook_secret || webhookSecret),
      });
      console.log(`Created app ${app.slug} (id ${app.id}). Credentials written to web/.env.local.`);

      // Never interpolate an unvalidated URL from the API into an attribute.
      const installUrl = safeGithubUrl(app.html_url);
      const installHref = installUrl ? escapeHtml(`${installUrl}/installations/new`) : null;
      console.log(
        installUrl
          ? `Next: install it on your account and choose the egg repo: ${installUrl}/installations/new`
          : `Next: install it on your account at https://github.com/apps`
      );

      const installLink = installHref
        ? `<p><a href="${installHref}">Install it on your account</a></p>`
        : `<p>Open your new app on GitHub to install it on your account.</p>`;
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<body style="font-family: system-ui; max-width: 36rem; margin: 3rem auto"><h1>Done</h1><p>The app was created and its credentials were saved. You can close this tab and go back to the terminal.</p>${installLink}</body>`);
      setTimeout(() => server.close(() => process.exit(0)), 300);
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("GitHub did not return the app. Check the terminal and try again.");
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

// A busy port (or any other listen failure) should give a one-line explanation,
// not an unhandled EADDRINUSE stack trace.
server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Close the other program and run this again.`);
  } else {
    console.error(`Could not start the callback server on 127.0.0.1:${PORT}: ${err instanceof Error ? err.message : err}`);
  }
  process.exit(1);
});

// ----------------------------------------------------------------- self-check

function selfCheck() {
  assert.equal(isAllowedHost("localhost:4123"), true);
  assert.equal(isAllowedHost("127.0.0.1:4123"), true);
  assert.equal(isAllowedHost("evil.example:4123"), false);
  assert.equal(isAllowedHost("localhost:4124"), false);
  assert.equal(isAllowedHost(undefined), false);

  const req = (headers) => ({ headers });
  assert.equal(requestAllowed(req({ host: "localhost:4123" }), "/"), true);
  assert.equal(requestAllowed(req({ host: "evil.example:4123" }), "/"), false);
  assert.equal(requestAllowed(req({ host: "localhost:4123", "sec-fetch-site": "cross-site" }), "/"), false);
  assert.equal(requestAllowed(req({ host: "localhost:4123", "sec-fetch-site": "same-origin" }), "/"), true);
  assert.equal(requestAllowed(req({ host: "localhost:4123", origin: "http://evil.example" }), "/"), false);
  assert.equal(requestAllowed(req({ host: "localhost:4123", origin: "http://localhost:4123" }), "/"), true);
  // A GitHub redirect to /callback is a cross-site navigation with no Origin.
  assert.equal(requestAllowed(req({ host: "localhost:4123", "sec-fetch-site": "cross-site" }), "/callback"), true);

  assert.equal(escapeHtml(`a"b<c>d&e'f`), "a&quot;b&lt;c&gt;d&amp;e&#39;f");
  assert.equal(safeGithubUrl("https://github.com/apps/egg-abc"), "https://github.com/apps/egg-abc");
  assert.equal(safeGithubUrl("http://github.com/apps/egg-abc"), null);
  assert.equal(safeGithubUrl("https://github.com.evil.test/apps/egg"), null);
  assert.equal(safeGithubUrl("https://evil.test/https://github.com/apps/egg"), null);
  assert.equal(safeGithubUrl("javascript:alert(1)"), null);
  assert.equal(safeGithubUrl(undefined), null);

  const dir = mkdtempSync(path.join(tmpdir(), "egg-app-env-"));
  try {
    const target = path.join(dir, ".env.local");
    writeFileSync(target, "OLD=1\n", { mode: 0o644 });
    if (process.platform !== "win32") chmodSync(target, 0o644);
    writeEnv({ GITHUB_WEBHOOK_SECRET: "a".repeat(64) }, target);
    const text = readFileSync(target, "utf8");
    assert.match(text, /GITHUB_WEBHOOK_SECRET=a{64}/);
    assert.match(text, /OLD=1/);
    if (process.platform !== "win32") assert.equal(statSync(target).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("create-github-app self-check passed.");
}

if (process.argv.includes("--self-check")) {
  selfCheck();
} else {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Open http://localhost:${PORT} in your browser and press Continue to GitHub.`);
  });
}
