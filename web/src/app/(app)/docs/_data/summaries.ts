/**
 * One sentence per docs page, for the docs home and each page's description.
 * Keyed by the section id in `nav.ts`; a test fails if a page has none.
 */
export const SUMMARIES: Record<string, string> = {
  overview: "What Egg does, what it needs from you and the steps it takes on every push.",
  quickstart: "From a new account to a deployed app in four steps, with a sample repository to follow.",
  servers: "Connect your Nest account with its own SSH key, test the link, replace the key or disconnect.",
  projects: "Link a repository, choose a runtime, set the build and run commands, and see what every app can rely on.",
  deployments: "Deployment states, redeploy, rollback, cancel and restart, paging through a long history, how many releases are kept and how branch previews work.",
  env: "Add environment variables for production or previews, import a .env file, and how values are stored and masked.",
  logs: "Build logs for each deployment and runtime logs for the running app, with a time range, level filter, search, older lines and download.",
  domains: "Add your own domain, point its DNS at your container and read the DNS and app checks.",
  github: "Install the GitHub app, deploy on every push to the production branch and get a preview for each pull request.",
  hooks: "A private URL that starts a deployment from CI, a cron job or a script.",
  notifications: "Discord and Slack messages when a deploy finishes or an app goes down.",
  api: "Make an access token, pick its permissions and call the API or the MCP endpoint from scripts and agents.",
  monitoring: "Whether the service is running, memory and CPU over time, and uptime checks with alerts.",
  "status-page": "A public page that says whether an app is answering, with a 30-day outage strip.",
  analytics: "Cookie-free page views for your site, counted by a small script you paste in, with opt-in referrers, speed, events and returning visitors.",
  container: "The three switches for the terminal, file changes and leftovers, plus the Container page, terminal and Files tab.",
  activity: "A newest-first log of what you changed, with a search, filters and a CSV export.",
  account: "Your Hack Club sign-in, the Settings page, signed-in browsers, container permissions and how to delete your account.",
  security: "How your key, your builds and your secrets are handled, and who can see what.",
  selfhost: "Run your own copy of Egg instead of the hosted one.",
  limits: "Every number Egg enforces, grouped by what it limits.",
  troubleshooting: "What to check when a connection, build, domain, hook, alert or token call goes wrong.",
};
