# First-party grafts

Egg's grafts are compiled first-party features selected by a static registry. The registry contains exactly Announcements, Forum, and Greenhouse. An installation row stores only the enabled state and audit attribution; it never stores a module name, import path, route list, executable setting, or uploaded code. Each API route imports its feature service directly, and each request checks both the signed-in session and the enabled state.

## Setup

1. Deploy this Egg version. Migration `0075_grafts` creates the installation, announcement, forum, and workspace tables during normal database startup.
2. Sign in with an account that has instance-administrator access.
3. Open **Account menu → Instance administration → First-party apps** (`/admin/grafts`).
4. Enable an app. It then appears under **Apps** in the signed-in navigation and on `/grafts`.
5. To make an app unavailable, turn it off from the same page. Its records remain in the database and become available again if it is re-enabled.

Only the instance administrator can change app availability. The APIs repeat the administrator check and audit each change at instance scope. Hidden pages and APIs also check the enabled state on every request; hiding a link is not the access control.

## App flows and permissions

| App | Signed-in user flow | Instance-administrator flow | Data and access |
| --- | --- | --- | --- |
| Announcements | Read active notices in the app shell or on the Announcements page; dismiss a notice for the current account. | Create drafts, edit, publish or unpublish, pin, and delete notices. | SQLite; dismissal is per user. Notice bodies render as text. |
| Forum | Start a bug report, feature idea, question, or discussion; reply, vote, and remove your own topics or replies. | Set status and priority, pin or lock topics, and remove topics or replies. | SQLite; every author is the signed-in Egg user. Posts are plain text; this release has no image upload. |
| Greenhouse | Create a private workspace linked to an Egg project you own; record a goal, optional branch reference, status, and review notes; open the linked project. | See workspace owner/project/title/status and remove a workspace record for cleanup. | SQLite; project operations check Egg's project access rules. Workspace notes are visible to the workspace owner. |

Greenhouse is a project work organizer in this release. It does not provision a separate machine or worktree, execute user code, launch a coding agent, or share a terminal. Branch references are descriptive text and do not cause a checkout. The linked Egg project's terminal and file permissions continue to apply to their own routes.

## Security boundaries

- Pages use Egg's session-based `requireUser`; API handlers use `authed` and the shared same-origin/error wrapper.
- Instance-wide actions call `isInstanceAdmin` on the server. Client controls are convenience only.
- User-owned forum deletions and workspaces check the stored author/owner. Greenhouse creation and updates additionally use `assertProjectAccess`.
- App APIs return not found while their app is disabled. Turning an app off does not delete content.
- The registry is a TypeScript allowlist. There is no runtime code loader, plugin archive, `eval`, or database-selected import.
- User content is length-limited, stored as text, and rendered by React as text rather than HTML.
