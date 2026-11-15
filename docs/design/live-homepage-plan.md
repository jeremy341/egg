# Live homepage and Egg on Egg (idea, not built)

Status: idea recorded on 2026-11-13. Nothing here is built or decided. Items marked **verify** were not checked against the code when this was written.

## The idea

Two linked ideas from the owner:

1. The deployments list on the homepage stops being sample data. It shows real deployments of real projects that run through Egg (the Egg repository itself, and some of the owner's own repositories), and a visitor can interact with it.
2. Egg is deployed by Egg, so the first real project in that list is Egg.

## Verdict

- **Real, interactive list: yes.** It is the strongest fix for the homepage's main weakness. Sample data labelled "Sample data" proves nothing; a list of real pushes, including the failed ones, does. It also removes the last made-up content from the page.
- **Egg on Egg: yes for the web app, with one hard limit.** An Egg instance cannot safely deploy itself, because the deploy would restart the worker that is running the deploy. A second instance has to do it. Details below.

## Part 1: real deployments on the homepage

### What a visitor sees

The same list as today (commit message, state, production or preview, short commit, branch, age), filled from real projects. "Sample data" becomes a line that says what it is, for example "Live: deployments of Egg and two of its author's projects". Failed deployments stay in the list. Hiding them would make the list an advert instead of evidence.

Interaction, smallest first:

1. The state filter (All, Ready, Building, Error) works. It was hidden on the homepage because it did nothing useful with five sample rows.
2. A row opens the commit on GitHub (public repositories only).
3. Later, and only if it is safe: a row opens a read-only view of that deployment's build log.

### What it needs

- **A per-project opt-in setting**, off by default, for example "Show this project's deployments on the Egg homepage". Only the owner of the Egg instance's own projects need it at first. It must be separate from the public status page setting, which promises to show no repository, port, server or commit (`web/src/server/status-page.ts`).
- **Public repositories only.** A commit message from a private repository must never reach the homepage. Enforce it on the server, not by convention. **Verify** how the GitHub integration knows a repository's visibility, and what happens when a public repository is made private later.
- **A narrow public feed.** One read-only endpoint that returns only the fields the list shows: commit message, short commit, branch, state, environment, time, and the repository's public name. Never the server name, the port, the user, environment variables, or the log.
- **Caching and limits.** The homepage is public and unauthenticated. The feed should be cached (a minute is enough) and rate limited, so the homepage cannot be used to load the database.
- **A fallback.** If the feed is empty or fails, the page shows the current sample list with its "Sample data" label. The homepage must never render an empty or broken cell.
- **Privacy and security pages updated** to say what the opt-in publishes, before it ships.

### Risks

- **Build logs.** Logs can contain paths, package names and the output of a user's own build scripts. Secrets are masked today, but masking is a safety net, not a guarantee. Do not publish logs in the first version.
- **Commit messages are permanent publicity.** For a public repository they are public already, but the homepage puts them in front of more people. The opt-in text should say so.
- **Avatars and names.** The list shows the author's initials. For the owner's own projects this is fine. If other users can ever opt in, they must agree to their name being shown.
- **A quiet week looks dead.** If nothing was pushed for a month, the newest row says "1mo ago". That is honest, but worth knowing before relying on the list as the page's centrepiece.

## Part 2: running Egg through Egg

### What Egg is, as a thing to deploy

From `compose.yaml` and `deploy/Dockerfile`, a running Egg is three parts: the Next.js web app, a separate worker process (`worker/index.ts`) that runs deployments and uptime checks, and Caddy in front. It also has a database and encryption secrets that must outlive any single release.

### What works

- The web app is a Node.js project with a build step and a start command, which is what Egg deploys. Putting the public Egg site on a Nest container through Egg should be possible. **Verify** that a Next.js build fits in the build memory cap on a default Nest container (2 GB memory).

### What does not work as it stands

- **Self-deployment.** If instance A deploys instance A, the step "switched to the new release and restarted" restarts the worker that is running that deployment. The health check and the automatic revert that follow would never run, so a broken release of Egg would stay broken with nobody left to put the old one back. This is the one case where Egg's main safety promise fails.
- **Two processes.** Egg runs one service per project. Egg itself needs the web app and the worker. **Verify** whether one project can run two processes, or whether this needs two projects from the same repository.
- **Database and migrations.** Releases are swapped by switching folders, and a rollback switches back. The database must live outside the release folders, and a rollback after a schema migration is not safe by default. **Verify** where the database file lives in a container deploy and when migrations run.
- **Circular trust.** The Egg instance holds the SSH key for the container it runs on. Anyone who takes over the app holds root on its own host. This is true of any self-hosted setup, but it should be written on the security page if the public instance works this way.

### A workable shape

- A small second Egg instance (for example the owner's local one, or a separate container) deploys the public Egg. The public Egg never deploys itself.
- The public Egg's own project, in that second instance, is the first project opted in to the homepage feed. So the homepage of Egg shows the deployments of Egg, honestly, with the failed ones.
- The worker either stays outside Egg's control and is restarted by the upgrade script (`deploy/upgrade.sh`), or becomes a second project once two processes are sorted out.

## Suggested order

1. The opt-in setting and the public feed, for the owner's public repositories only, with the sample-data fallback.
2. The homepage list reads the feed; the filter is switched back on; rows link to the commit on GitHub.
3. Opt in one of the owner's own public repositories that already deploys through Egg. This is the first real content for the list, and it needs no self-deployment (decided 2026-11-13: start with a personal repo, not Egg itself).
4. Later, deploy the public Egg web app from a second Egg instance and opt that project in too, once the open questions below are answered.
5. Decide about logs and about letting other users opt in, after the first steps have run for a while.

## Not verified when this was written

- Where the public Egg instance runs today, and how it is deployed.
- Whether one project can run more than one process.
- Where the database lives in a container deployment and how migrations run on deploy.
- How repository visibility is stored and kept up to date.
- Whether a Next.js build of Egg fits in the build memory cap on Nest.
