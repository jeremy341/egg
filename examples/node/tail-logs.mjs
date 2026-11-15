#!/usr/bin/env node
// List your projects, then follow the build log of a project's latest deployment.
// Needs Node 20+ and no packages. Token scopes: projects:read, deployments:read.
//
//   NEST_URL=https://your-egg NEST_TOKEN=egg_... node tail-logs.mjs [project-id]
//
// The token is read from the environment so it never ends up in your shell history
// or in the file. Do not paste a real token into this script.

const base = (process.env.NEST_URL ?? "").replace(/\/+$/, "");
const token = process.env.NEST_TOKEN ?? "";
if (!base || !token.startsWith("egg_")) {
  console.error("Set NEST_URL (your Egg address) and NEST_TOKEN (a token that starts with egg_).");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path) {
  const res = await fetch(`${base}/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) {
    // Build logs share a small allowance. Wait as long as the server asks, then try again.
    const wait = Number(res.headers.get("retry-after")) || 10;
    await sleep(wait * 1000);
    return api(path);
  }
  if (!res.ok) {
    const e = body.error ?? {};
    throw new Error(`${res.status} ${e.code ?? "error"}: ${e.message ?? "request failed"}`);
  }
  return body;
}

const RUNNING = new Set(["queued", "building", "deploying"]);

const { projects } = await api("/projects");
if (projects.length === 0) {
  console.log("You have no projects yet.");
  process.exit(0);
}
console.log("Projects:");
for (const p of projects) console.log(`  ${p.id}  ${p.name.padEnd(24)} ${p.state ?? "never deployed"}`);

const project = process.argv[2] ? projects.find((p) => p.id === process.argv[2]) : projects[0];
if (!project) {
  console.error(`No project with id ${process.argv[2]}.`);
  process.exit(1);
}

const { deployments } = await api(`/projects/${encodeURIComponent(project.id)}/deployments?limit=1`);
if (deployments.length === 0) {
  console.log(`\n${project.name} has not been deployed yet.`);
  process.exit(0);
}
const deployment = deployments[0];
console.log(`\nBuild log for ${project.name}, deployment ${deployment.id} (${deployment.branch}):\n`);

let after = 0;
for (;;) {
  const page = await api(`/deployments/${encodeURIComponent(deployment.id)}/logs?after=${after}`);
  // Log text comes from the build, so print it as text and never act on it.
  for (const line of page.lines) console.log(`${line.at.slice(11, 19)} ${line.level.padEnd(5)} ${line.message}`);
  after = page.nextAfter;
  if (page.more) continue; // a full page: ask again straight away

  const { deployment: now } = await api(`/deployments/${encodeURIComponent(deployment.id)}`);
  if (!RUNNING.has(now.state)) {
    console.log(`\nFinished: ${now.state}${now.error ? ` (${now.error})` : ""}`);
    process.exit(now.state === "ready" ? 0 : 1);
  }
  // Reading logs shares a small allowance of 10 a minute per token, so poll gently.
  await sleep(8000);
}
