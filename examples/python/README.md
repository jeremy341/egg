# Python: list projects and follow a build log

`tail_logs.py` does the same as the Node example, using only the Python standard library.

**Token scopes:** `projects:read`, `deployments:read`.

```sh
NEST_URL=https://your-egg NEST_TOKEN=egg_... python3 tail_logs.py [project-id]
```

Needs Python 3.8 or newer. Reading build logs shares a small allowance of 10 requests a minute per token, so the script polls every 8 seconds and waits when the server answers 429.
