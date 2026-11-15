# Node: list projects and follow a build log

`tail-logs.mjs` lists your projects, then prints the build log of a project's latest deployment and keeps following it until the build finishes.

**Token scopes:** `projects:read`, `deployments:read`.

```sh
NEST_URL=https://your-nest-deploy NEST_TOKEN=ndp_... node tail-logs.mjs [project-id]
```

Needs Node 20 or newer. No packages. Reading build logs shares a small allowance of 10 requests a minute per token, so the script polls every 8 seconds and waits when the server answers 429.
