import type { ReactNode } from "react";
import { B, C, Callout, H2, InternalLink, List, P, Section, Table } from "../_components/prose";
import { docsHref } from "../_data/nav";

/**
 * Two pages about where a build runs: GitHub Actions (the recommended choice) and Nest (the container).
 * The numbers and names here are pinned to the code in `docs-facts.test.ts`.
 * The copy follows Orchard's docs style: short declarative sentences, a cause for each rule,
 * numbered steps, one consequence per caution, and a Related resources closer.
 */

/** The links that end each page. One line, named for what the reader can open next. */
const related = (pages: [string, string][]) => (
  <P>
    <B>Related resources:</B>{" "}
    {pages.map(([id, title], i) => (
      <span key={id}>
        {i > 0 ? ", " : ""}
        <InternalLink href={docsHref(id)}>{title}</InternalLink>
      </span>
    ))}
    .
  </P>
);

export const GUIDE_D: Record<string, () => ReactNode> = {
  "build-github-actions": () => (
    <Section
      id="build-github-actions"
      intro="GitHub builds the app and sends the finished release to Egg, so your Nest container only runs it. This is the recommended choice for a project made from a GitHub repository."
    >
      <H2 id="build-actions-what" />
      <P>
        With this choice a workflow in your repository installs, builds and packs the app on GitHub&apos;s machines. It
        sends the finished release to Egg. Egg unpacks it on your container, starts it and checks that it answers. Your
        container never runs the build, so a framework build that needs a lot of memory no longer competes with your app
        for it.
      </P>
      <P>
        This is the default for a new project. Pick <B>Build on Nest</B> when you want no dependence on GitHub; see{" "}
        <InternalLink href={docsHref("build-on-nest")}>Build on Nest</InternalLink>. A project made from a pasted public
        address has no link to the GitHub app. The new project flow does not offer GitHub Actions for it.
      </P>
      <P>
        Builds use your GitHub Actions minutes.
      </P>

      <H2 id="build-actions-steps" />
      <P>
        New projects take you straight to these steps. For an existing project, open Settings, then <B>Where Builds Run</B>.
        Choose <B>GitHub Actions</B> and press Save. Each step opens one at a time, and finished steps fold into one line.
        Egg stores no progress. It knows whether the credentials exist and whether the last test passed. It asks you about
        the two steps that only GitHub can confirm.
      </P>
      <List ordered>
        <li>
          <B>Make the build credentials.</B> Press <B>Make credentials</B>. Egg shows four values once and keeps only a
          fingerprint. Making new ones stops the old ones at once.
        </li>
        <li>
          <B>Save the secrets on GitHub.</B> Save each value under the name and in the place the next section lists. Press{" "}
          <B>I saved all four secrets</B>. Egg cannot read GitHub secrets, so this step is your confirmation.
        </li>
        <li>
          <B>Add the workflow file.</B> Press <B>Add to repository</B>. Egg opens a pull request that adds the file. Merge
          it on GitHub. Without the GitHub app permissions below, copy or download <C>egg.yml</C> and commit it to the
          production branch yourself.
        </li>
        <li>
          <B>Test the connection.</B> Egg checks its own records and, read only, your repository. Every failed check says
          what to do. The last section here goes through them.
        </li>
        <li>
          <B>Run the first build.</B> Push a commit, or open the workflow on GitHub and press <B>Run workflow</B>. The
          deployment appears on the project&apos;s Deployments page.
        </li>
      </List>

      <H2 id="build-actions-secrets" />
      <P>
        The workflow reads four secrets. The two production values live in a GitHub Environment called{" "}
        <C>egg-production</C>. You limit that environment to the production branch. The two preview values are repository
        secrets.
      </P>
      <Table
        caption="The four secrets"
        head={["Name", "Saved in", "What it does"]}
        rows={[
          [<C key="a">EGG_UPLOAD_PRODUCTION_TOKEN</C>, "The egg-production environment", "Sends a finished production build to Egg."],
          [<C key="b">EGG_ENV_PRODUCTION_TOKEN</C>, "The egg-production environment", "Reads the production build variables."],
          [<C key="c">EGG_UPLOAD_PREVIEW_TOKEN</C>, "Repository secrets", "Sends a finished preview build to Egg."],
          [<C key="d">EGG_ENV_PREVIEW_TOKEN</C>, "Repository secrets", "Reads the preview build variables."],
        ]}
      />
      <List>
        <li>
          To make the environment, open the repository&apos;s Settings, then Environments, then New environment. Under
          Deployment branches and tags, choose Selected branches and tags and add the production branch. You can turn on
          Required reviewers so a person approves each production build.
        </li>
        <li>
          Preview secrets go under Settings, Secrets and variables, Actions, as repository secrets.
        </li>
        <li>
          <B>Never save the two production values as repository secrets.</B> A repository secret can be read by a workflow
          that someone edits on any branch.
        </li>
      </List>

      <H2 id="build-actions-pr" />
      <P>
        <B>Add to repository</B> asks the GitHub app to create a branch, commit <C>.github/workflows/egg.yml</C> to it and
        open a pull request into the production branch. If a pull request from an earlier press is still open, Egg updates
        it. If the production branch already has an identical file, Egg changes nothing and says so. Nothing is merged for
        you. The workflow only starts working when you merge.
      </P>
      <Callout tone="warning" title="This needs three permissions on the GitHub app">
        Adding the workflow by pull request needs Egg&apos;s GitHub app to have <B>Contents</B>, <B>Pull requests</B> and{" "}
        <B>Workflows</B> read and write access. Only the person who runs this Egg can grant them, in the app&apos;s settings
        on GitHub. Without them, Egg says so. You copy or download the file instead, and everything else works the same.
      </Callout>

      <H2 id="build-actions-safety" />
      <List>
        <li>
          The workflow runs on pushes and on <B>Run workflow</B>, not on pull requests. A pull request from a fork therefore
          never runs it and never receives a secret.
        </li>
        <li>
          Only the job for the production branch can use the <C>egg-production</C> environment. A workflow edited on another
          branch can ask for it. GitHub then refuses the secrets.
        </li>
        <li>
          Anyone who can push a workflow can run code with the preview credentials and with whatever else the repository
          allows. Treat the people who can edit workflows as trusted operators of this project. Each project has a single
          owner.
        </li>
        <li>
          The credentials can send a release and read build variables, and nothing else. A production credential cannot
          deliver a preview build. A preview credential cannot deliver a production one.
        </li>
      </List>

      <H2 id="build-actions-limits" />
      <Table
        caption="Limits of a build on GitHub"
        head={["Limit", "Value", "What happens at the limit"]}
        rows={[
          ["Release size", "500 MiB (524,288,000 bytes)", "The workflow stops with a message and nothing is sent."],
          ["Wait for the release", "60 minutes", "Egg stops waiting: “GitHub did not send the build in time. Check the workflow run, then deploy again.”"],
          ["Build credential lifetime", "90 days", "Test connection reports them as expired. Make new ones and replace all four secrets."],
        ]}
      />
      <P>
        These numbers are the ones the setup steps show. They come from the code that enforces them.
      </P>

      <H2 id="build-actions-troubleshooting" />
      <P>
        Test connection lists six checks. A check that could not run because an earlier one failed shows “Not checked”.
        It never shows “Passed”. Fix the first failure, then test again.
      </P>
      <Table
        caption="Test connection checks"
        head={["Check", "What failed", "What to do"]}
        rows={[
          ["Build location", "The project is set to build on your container.", "Choose GitHub Actions under Where Builds Run and press Save."],
          ["Build credentials", "Egg has no complete set, or they expired.", "Make new credentials, then replace all four secrets on GitHub."],
          ["GitHub app", "The project is not linked to the app, or the app was uninstalled.", "Install the app from Account, then add the project again."],
          ["Repository access", "The app cannot see the repository.", "On GitHub, open the app's settings and add the repository to its access."],
          ["Workflow file", "There is no file at .github/workflows/egg.yml on the production branch.", "Merge the pull request, or commit the copied file to the production branch."],
          ["Workflow settings", "The file does not match this project's address, production branch, secrets or environment.", "Copy the workflow from the setup step over the file. Do this again after changing the runtime, commands or production branch."],
        ]}
      />
      <P>
        Test connection cannot see your GitHub secrets or environment settings. It does not know whether the last workflow
        run passed. If the first build fails, open the workflow run on GitHub. A run that cannot send the release usually
        means a secret is missing. It may be saved in the wrong place. It may be out of date.
      </P>
      {related([
        ["build-on-nest", "Build on Nest"],
        ["github", "GitHub and previews"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),

  "build-on-nest": () => (
    <Section
      id="build-on-nest"
      intro="Egg builds the app on your Nest container, under a memory and CPU cap, and starts it when the build finishes."
    >
      <H2 id="build-nest-what" />
      <P>
        Nothing depends on GitHub for the build itself. Egg sends the source to your container over SSH. It runs the install
        and build commands there, then starts the result. It suits small apps and projects that are not on GitHub through
        the app.
      </P>
      <H2 id="build-nest-caps" />
      <List>
        <li>
          A build runs under a memory cap and a CPU limit, so it cannot take the container from your running app. Both are
          set on the Container page, under Build memory and Build CPU.
        </li>
        <li>
          The memory cap is never more than your container&apos;s memory minus 512 MB. The 512 MB stays free for your app.
          A container with under 768 MB cannot build.
        </li>
        <li>A build that runs longer than 15 minutes is stopped. Your running app is not.</li>
      </List>
      <H2 id="build-nest-when" />
      <List>
        <li>Prefer it for a small app whose build fits comfortably in the cap.</li>
        <li>Prefer it when you want builds that do not use GitHub Actions minutes.</li>
        <li>
          Prefer GitHub Actions for a framework build that runs out of memory here. See{" "}
          <InternalLink href={docsHref("build-github-actions")}>Build with GitHub Actions</InternalLink>.
        </li>
      </List>
      <P>
        Switching is a saved choice under Where Builds Run in the project&apos;s Settings. Egg never changes it for you, so
        the next deployment uses the new place. The numbers and the messages a build can give are on the{" "}
        <InternalLink href={`${docsHref("container")}#container-build-memory`}>Container page</InternalLink> and in{" "}
        <InternalLink href={`${docsHref("troubleshooting")}#troubleshooting-build`}>Troubleshooting</InternalLink>.
      </P>
      {related([
        ["build-github-actions", "Build with GitHub Actions"],
        ["container", "Container, terminal and files"],
        ["troubleshooting", "Troubleshooting"],
      ])}
    </Section>
  ),
};
