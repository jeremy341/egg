import { devNull } from "node:os";
import { isIP } from "node:net";
import { validateCloneUrl } from "./index";
import { resolvePublicHost, type ProviderResolver } from "./api";

export function validateGitVersion(version: string): void {
  const m = /^git version (\d+)\.(\d+)(?:\.|\s|$)/.exec(version);
  if (!m || Number(m[1]) < 2 || (Number(m[1]) === 2 && Number(m[2]) < 37)) throw new Error("Generic Git requires Git 2.37 or newer for safe address pinning.");
}
/** Only public HTTPS, with no inherited Git configuration, credential helpers, proxies or redirects. */
export async function genericGitEnvironment(input: string, resolver?: ProviderResolver): Promise<NodeJS.ProcessEnv> {
  const normalized = validateCloneUrl("git", input);
  const url = new URL(normalized);
  if (url.protocol !== "https:") throw new Error("Only public HTTPS Git repositories are supported.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([resolvePublicHost(url.hostname, resolver), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Git host lookup timed out")), 10_000); })]).finally(() => { if (timer) clearTimeout(timer); });
  const address = addresses[0];
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (/^(?:git_|.*proxy$|curl_)/i.test(key)) delete env[key];
  const settings = [
    ["http.curloptResolve", `${url.hostname}:${url.port || "443"}:${isIP(address) === 6 ? `[${address}]` : address}`],
    ["http.followRedirects", "false"], ["http.proxy", ""], ["credential.helper", ""], ["http.extraHeader", ""], ["http.sslVerify", "true"],
  ];
  env.GIT_CONFIG_NOSYSTEM = "1"; env.GIT_CONFIG_GLOBAL = devNull;
  env.GIT_TERMINAL_PROMPT = "0"; env.GIT_ASKPASS = "echo"; env.GIT_ALLOW_PROTOCOL = "https";
  env.GIT_CONFIG_COUNT = String(settings.length);
  settings.forEach(([key, value], i) => { env[`GIT_CONFIG_KEY_${i}`] = key; env[`GIT_CONFIG_VALUE_${i}`] = value; });
  return env;
}
