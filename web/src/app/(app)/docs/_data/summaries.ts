/**
 * One sentence per docs page, for the docs home and each page's description.
 * Keyed by the section id in `nav.ts`; a test fails if a page has none.
 */
export const SUMMARIES: Record<string, string> = {
  overview: "What Nest Deploy is, and the steps it takes every time you push.",
  quickstart: "From a new account to a deployed app in four steps.",
  servers: "Connect a Nest account with its own SSH key, then test, rotate or remove it.",
  projects: "Tie a repository to an app, choose a runtime and see what every app can rely on.",
  deployments: "The states a build goes through, what you can do to it and how branch previews work.",
  env: "Encrypted variables per project and environment, masked in logs.",
  logs: "Build logs and runtime logs, with search.",
  domains: "Point your own domain at a port on your container, and how DNS is checked.",
  github: "Deploy on every push, and get a preview with each pull request.",
  hooks: "A private URL that starts a deployment from CI, a cron job or a script.",
  notifications: "Discord and Slack messages when a deploy finishes or an app goes down.",
  api: "Make an access token, pick its permissions and call the API from scripts and agents.",
  monitoring: "Whether the service is running, memory and CPU over time, and uptime checks with alerts.",
  "status-page": "A public page that says whether an app is answering, with a 30-day outage strip.",
  analytics: "Cookie-free page views for your site, counted by a small script.",
  container: "The three switches for the terminal, file changes and leftovers, and the pages they unlock.",
  activity: "A newest-first log of what you changed, with a search and filters.",
  account: "Your Hack Club sign-in, signed-in browsers and how to delete your account.",
  security: "How your key, your builds and your secrets are handled, and who can see what.",
  selfhost: "Run your own copy of Nest Deploy instead of the hosted one.",
  limits: "Every number Nest Deploy enforces, grouped by what it limits.",
  troubleshooting: "What to check when a connection, build, domain, hook or alert goes wrong.",
};
