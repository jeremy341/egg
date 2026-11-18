# Testing Egg on a real Nest container

Work through this list in order on the Nest machine. Write down anything that does not match the expected result, with the page and the exact message.

## Before you start

- [ ] Use the feature branch build (`feature/build-actions-and-audit-fixes`), not an older copy.
- [ ] Run the database migrations on a new database. The admin table is migration `0048`.
- [ ] Set `SECURITY_REPORT_ADMIN_ID` to your account id, so you have an administrator from the start.
- [ ] Run `pnpm run doctor`. Expect the rate-limit warning (`TRUST_PROXY` is off). That is correct unless a reverse proxy sets `X-Forwarded-For`.
- [ ] Note your Nest username, the server host, and the domain you plan to use.

## 1. Sign in and connect a server

- [ ] Sign in with Hack Club. The Projects page loads.
- [ ] Add a server with your Nest username. Confirm it shows as not connected yet.
- [ ] Connect it. The status becomes connected and the host key is recorded.
- [ ] Try to add your Nest name as a domain **before** connecting a second server. It should be refused with "Connect this server before adding its Nest name."

## 2. Import and deploy a project

- [ ] Import a public repository with a small Node app that listens on `PORT`.
- [ ] On the new project page, check the basic settings are visible, and the advanced section opens for the port.
- [ ] Try port `20000`. It should be refused and the field should be marked.
- [ ] Deploy. Watch the timeline: queued, cloning, building, deploying, ready.
- [ ] Open the app at its port on the Nest machine. It answers.
- [ ] Open the deployment log. It shows the build and runtime output, and secret values appear masked.

## 3. Environment variables

- [ ] Add a variable with a value. Deploy. The app reads it.
- [ ] Add a variable with an **empty** value. Deploy. The deploy should still succeed.
- [ ] Edit a variable. Update is disabled until you type a new value. Typing a value and saving updates it.

## 4. Domains

- [ ] Add your Nest name (`<username>.hackclub.app`) to the server. It should be accepted and active with no DNS step.
- [ ] Add a custom domain. It stays pending, with the CNAME and TXT records shown.
- [ ] Remove a domain. It disappears from the list.

## 5. Rollback and redeploy

- [ ] Push a change that breaks the app. The deploy should fail, and the previous release should keep serving. The log should say it reverted.
- [ ] Roll back to the previous release from the Deployments tab. The app serves the old version again.
- [ ] Redeploy one commit. It rebuilds that commit.

## 6. Team access

- [ ] Invite a second account by email as viewer. Accept the invite on that account.
- [ ] The viewer sees the project and its deployments, without a 404 on the deployment detail page.
- [ ] The viewer opens Settings and sees the owner-only note, not an error page.
- [ ] Change the role to developer. The developer can deploy but not change settings.

## 7. Deploy hook and notifications

- [ ] Create a deploy hook. Confirm the dialog before making a new URL and before revoking.
- [ ] Set a Discord or Slack notification. Send a test message and check it arrives.

## 8. Administrators

- [ ] Open `/admin`. The dashboard and the Administrators card show.
- [ ] Grant administration to a second account by its **verified** email. The first attempt asks you to sign in again.
- [ ] Sign in with the second account. It opens `/admin` and the security inbox.
- [ ] Remove the second account. The configured account cannot be removed.

## 9. Security checks

- [ ] Sign in from a second browser and sign out the first one from Account. The first browser is logged out.
- [ ] Open another user's project URL. You get a 404, not their data.
- [ ] Call the API with a token that has only read scope. A deploy is refused.

## 10. Layout on a real device

- [ ] Phone (about 390 px): the dock, the deployment list, Settings and the new-project form all fit with no sideways scrolling.
- [ ] Tablet (about 1024 px): the Files list keeps the file names readable.
- [ ] Laptop (about 1440 px): the deployment row shows the commit and actions.
- [ ] Dark mode: text is readable on the Settings and Admin pages.

## Report

For each failure, write down:
- the page or command
- what you did
- what you expected
- what happened, with the exact text on screen or in the log
