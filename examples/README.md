# Nest Deploy examples

Small, copyable starting points for building on the Nest Deploy API. Every example uses a placeholder like `ndp_...`: create a real token on the Developer page, keep it in an environment variable or a secret store, and never commit it.

| Example | What it does | Token scopes it needs |
| --- | --- | --- |
| [node/tail-logs.mjs](node/README.md) | Lists projects and follows a build log (Node 20+, no packages) | `projects:read`, `deployments:read` |
| [python/tail_logs.py](python/README.md) | The same, with only the Python standard library | `projects:read`, `deployments:read` |
| [dashboard/index.html](dashboard/README.md) | A static, read-only dashboard; the token is pasted in and kept in memory only | `projects:read`, optionally `analytics:read` |
| [github-actions/deploy-on-release.yml](github-actions/README.md) | Deploys when you publish a GitHub release, through a deploy hook | None. Uses the deploy hook URL |
| [mcp/](mcp/README.md) | Connect Claude Desktop, Cursor or Claude Code to your projects | Whatever you want the agent to do. `get_me` needs none |

A typed client for TypeScript lives in `web/src/lib/sdk/nest-deploy.ts`. It is one file with no dependencies: copy it into your project. The machine-readable description of every call is at `/api/v1/openapi.json` on your Nest Deploy address.

Start any script with `GET /api/v1/me`. It needs no scope and tells you who the token belongs to, which scopes it has and when it expires.
