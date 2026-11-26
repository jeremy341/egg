// Every CLI group module. Add a group here only in the scaffold; children edit their own module.
import * as projects from "./projects.mjs";
import * as deployCore from "./deploy-core.mjs";
import * as deployReleases from "./deploy-releases.mjs";
import * as deployConfig from "./deploy-config.mjs";
import * as bindingsEnv from "./bindings-env.mjs";
import * as jobs from "./jobs.mjs";
import * as servicesCompose from "./services-compose.mjs";
import * as podsConsole from "./pods-console.mjs";
import * as githubGit from "./github-git.mjs";
import * as domainsStatus from "./domains-status.mjs";
import * as alertsNotify from "./alerts-notify.mjs";
import * as observeEvents from "./observe-events.mjs";
import * as useClaudeApi from "./use-claude-api.mjs";
import * as orgs from "./orgs.mjs";
import * as projectRegistry from "./project-registry.mjs";
import * as accounts from "./accounts.mjs";
import * as membersInvites from "./members-invites.mjs";
import * as sshIdentity from "./ssh-identity.mjs";
import * as meta from "./meta.mjs";
import * as eggOnlyGaps from "./egg-only-gaps.mjs";

export const GROUPS = [projects, deployCore, deployReleases, deployConfig, bindingsEnv, jobs, servicesCompose, podsConsole, githubGit, domainsStatus, alertsNotify, observeEvents, useClaudeApi, orgs, projectRegistry, accounts, membersInvites, sshIdentity, meta, eggOnlyGaps];
