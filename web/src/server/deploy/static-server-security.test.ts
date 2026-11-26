import { afterEach, describe, expect, it } from "vitest";
import { NestSession, shellQuote } from "@/server/ssh/connection";
import { generateServerKey } from "@/server/ssh/keys";
import { freePort } from "@/server/test/fake-nest";
import { linuxTestHostAvailable, startMockSsh, type MockSsh } from "@/server/test/mock-ssh";
import { STATIC_NODE_SCRIPT, STATIC_PYTHON_SCRIPT } from "./runtime";

let mock: MockSsh | undefined;
let session: NestSession | undefined;
let serverPid: number | undefined;

afterEach(async () => {
  if (serverPid) await session?.exec(`kill ${serverPid} 2>/dev/null || true`);
  serverPid = undefined;
  session?.close();
  session = undefined;
  await mock?.stop();
  mock = undefined;
});

const suites = [
  { name: "Node", script: STATIC_NODE_SCRIPT, command: (port: number, script: string) => `env PORT=${port} node -e ${shellQuote(script)}` },
  { name: "Python", script: STATIC_PYTHON_SCRIPT, command: (port: number, script: string) => `env PORT=${port} python3 -c ${shellQuote(script)} ${port}` },
];

describe.each(suites)("$name static server", ({ script, command }) => {
  it.skipIf(!linuxTestHostAvailable())("serves public files and refuses secrets, escapes, malformed paths, and listings", async () => {
    const key = generateServerKey("static-security-test");
    mock = await startMockSsh({ authorizedKeys: [key.publicKey] });
    session = await NestSession.connect({ host: "127.0.0.1", port: mock.port, username: "test", privateKey: key.privateKey });

    const root = `${mock.home}/release`;
    const port = await freePort();
    const init = await session.script(`set -e
mkdir -p '${root}/assets' '${root}/.git' '${mock.home}/outside' '${root}/loop'
printf 'home page' > '${root}/index.html'
printf 'asset' > '${root}/assets/app.js'
printf 'runtime-secret' > '${root}/.env'
printf 'private-key' > '${root}/.git/config'
printf 'outside-secret' > '${mock.home}/outside/secret.txt'
ln -s '${mock.home}/outside/secret.txt' '${root}/escape.txt'
ln -s '${root}/.env' '${root}/secret-link'
ln -s '${root}/loop' '${root}/loop/index.html'
cd '${root}'
setsid nohup ${command(port, script)} > '${mock.home}/static-server.log' 2>&1 < /dev/null &
server_pid=$!
sleep 1
echo "$server_pid"`);
    expect(init.code).toBe(0);
    serverPid = Number(init.stdout.trim());

    const until = Date.now() + 8000;
    let ready = false;
    while (Date.now() < until) {
      const probe = await session.exec(`curl -sS --max-time 1 -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}/ || true`);
      if (probe.stdout.trim() === "200") { ready = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(ready).toBe(true);

    const request = async (path: string, args = "") => {
      const result = await session!.exec(`curl --path-as-is -sS --max-time 3 ${args} -w '\\n%{http_code}' 'http://127.0.0.1:${port}${path}'`);
      expect(result.code, result.stderr).toBe(0);
      const split = result.stdout.lastIndexOf("\n");
      return { body: result.stdout.slice(0, split), status: result.stdout.slice(split + 1) };
    };

    expect(await request("/")).toEqual({ body: "home page", status: "200" });
    expect(await request("/assets/app.js")).toEqual({ body: "asset", status: "200" });
    expect(await request("/.env")).toMatchObject({ status: "404" });
    expect(await request("/.git/config")).toMatchObject({ status: "404" });
    expect(await request("/secret-link")).toMatchObject({ status: "404" });
    expect(await request("/escape.txt")).toMatchObject({ status: "404" });
    expect(await request("/%2eenv")).toMatchObject({ status: "404" });
    expect(await request("/..%2f")).toMatchObject({ status: "404" });
    expect(await request("/..%2f..%2fetc/passwd")).toMatchObject({ status: "404" });
    expect(await request("/%2e%2e/%2e%2e/etc/passwd")).toMatchObject({ status: "404" });
    expect(await request("/%2e%65nv")).toMatchObject({ status: "404" });
    expect(await request("/assets/..%2f.env")).toMatchObject({ status: "404" });
    // An encoded trailing slash is the folder too: its index is served, never a redirect loop.
    expect(await request("/%2f")).toEqual({ body: "home page", status: "200" });
    expect(await request("/assets%2f")).toMatchObject({ status: "404" });
    expect(await request("/%252f")).toMatchObject({ status: "404" });
    // A malformed escape is a 400, and the server is still there for the next request.
    expect(await request("/%E0%A4%A")).toMatchObject({ status: "400" });
    expect(await request("/%")).toMatchObject({ status: "400" });
    expect(await request("/%zz")).toMatchObject({ status: "400" });
    expect(await request("/assets/app.js")).toEqual({ body: "asset", status: "200" });
    expect(await request("/%00")).toMatchObject({ status: "400" });
    expect(await request("/loop/")).toMatchObject({ status: "404" });
    const head = await request("/assets/app.js", "-I");
    expect(head.status).toBe("200");
    expect(head.body).toContain("200 OK");
    expect(head.body).not.toContain("asset");
    expect(Number((await request("/assets/app.js", "-X POST")).status)).toBeGreaterThanOrEqual(400);
    expect(await request("/assets/")).toMatchObject({ status: "404" });
    expect(await request("/assets/app.js")).toEqual({ body: "asset", status: "200" });
  }, 30000);
});
