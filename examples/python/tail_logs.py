#!/usr/bin/env python3
"""List your projects, then follow the build log of a project's latest deployment.

Standard library only (Python 3.8+). Token scopes: projects:read, deployments:read.

    NEST_URL=https://your-nest-deploy NEST_TOKEN=ndp_... python3 tail_logs.py [project-id]

The token is read from the environment so it never ends up in your shell history
or in this file. Do not paste a real token into the script.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("NEST_URL", "").rstrip("/")
TOKEN = os.environ.get("NEST_TOKEN", "")
RUNNING = {"queued", "building", "deploying"}


def api(path):
    request = urllib.request.Request(
        f"{BASE}/api/v1{path}", headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as err:
        if err.code == 429:
            # Build logs share a small allowance. Wait as long as the server asks, then try again.
            time.sleep(int(err.headers.get("Retry-After") or 10))
            return api(path)
        try:
            detail = json.load(err).get("error", {})
        except ValueError:
            detail = {}
        sys.exit(f"{err.code} {detail.get('code', 'error')}: {detail.get('message', 'request failed')}")
    except urllib.error.URLError as err:
        sys.exit(f"Could not reach {BASE}: {err.reason}")


def main():
    if not BASE or not TOKEN.startswith("ndp_"):
        sys.exit("Set NEST_URL (your Nest Deploy address) and NEST_TOKEN (a token that starts with ndp_).")

    projects = api("/projects")["projects"]
    if not projects:
        print("You have no projects yet.")
        return 0
    print("Projects:")
    for p in projects:
        print(f"  {p['id']}  {p['name']:<24} {p['state'] or 'never deployed'}")

    wanted = sys.argv[1] if len(sys.argv) > 1 else projects[0]["id"]
    project = next((p for p in projects if p["id"] == wanted), None)
    if project is None:
        sys.exit(f"No project with id {wanted}.")

    deployments = api(f"/projects/{urllib.parse.quote(project['id'], safe='')}/deployments?limit=1")["deployments"]
    if not deployments:
        print(f"\n{project['name']} has not been deployed yet.")
        return 0
    deployment = deployments[0]
    did = urllib.parse.quote(deployment["id"], safe="")
    print(f"\nBuild log for {project['name']}, deployment {deployment['id']} ({deployment['branch']}):\n")

    after = 0
    while True:
        page = api(f"/deployments/{did}/logs?after={after}")
        # Log text comes from the build, so print it as text and never act on it.
        for line in page["lines"]:
            print(f"{line['at'][11:19]} {line['level']:<5} {line['message']}")
        after = page["nextAfter"]
        if page["more"]:
            continue  # a full page: ask again straight away

        now = api(f"/deployments/{did}")["deployment"]
        if now["state"] not in RUNNING:
            print(f"\nFinished: {now['state']}" + (f" ({now['error']})" if now.get("error") else ""))
            return 0 if now["state"] == "ready" else 1
        # Reading logs shares a small allowance of 10 a minute per token, so poll gently.
        time.sleep(8)


if __name__ == "__main__":
    sys.exit(main())
