import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: unknown; href: string }) => createElement("a", { href }, children as never) }));
import {
  CheckList,
  FirstBuildStep,
  ManualWorkflow,
  PermissionNotice,
  PublishOutcome,
  STEP_IDS,
  SecretsStep,
  SetupProgress,
  firstUnfinished,
  publishAdvice,
  type Made,
  type StepId,
  type WorkflowInfo,
} from "@/components/github-setup-steps";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el).replace(/<!-- -->/g, "");
const none: Record<StepId, boolean> = { credentials: false, secrets: false, workflow: false, test: false, build: false };

describe("which step is open", () => {
  it("is the first step Egg cannot confirm", () => {
    expect(firstUnfinished(none)).toBe("credentials");
    expect(firstUnfinished({ ...none, credentials: true })).toBe("secrets");
    expect(firstUnfinished({ ...none, credentials: true, secrets: true, workflow: true })).toBe("test");
  });

  it("ends on the first build, which is never finished", () => {
    expect(firstUnfinished({ credentials: true, secrets: true, workflow: true, test: true, build: false })).toBe("build");
    expect(STEP_IDS).toHaveLength(5);
  });
});

describe("the progress header", () => {
  it("says Step N of 5 with the step name, and repeats it in segments hidden from screen readers", () => {
    const out = render(createElement(SetupProgress, { current: "secrets", done: { ...none, credentials: true } }));
    expect(out).toContain("Step 2 of 5");
    expect(out).toContain("Save the secrets on GitHub");
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('aria-hidden="true"');
  });

  it("says it is checking before the credentials are read", () => {
    expect(render(createElement(SetupProgress, { current: null, done: none }))).toContain("Checking your setup");
  });
});

describe("saving the secrets", () => {
  const made = {
    previewUploadToken: "pu",
    productionUploadToken: "xu",
    previewEnvToken: "pe",
    productionEnvToken: "xe",
    createdAt: "2026-11-01T00:00:00Z",
    expiresAt: "2027-01-30T00:00:00Z",
  } as Made;
  const step = (m: Made | null) => render(createElement(SecretsStep, { branch: "main", secrets: null, made: m, acknowledged: false, onAcknowledge: () => {} }));

  it("lists the four names under the place each is saved, and the production branch rule", () => {
    const out = step(null);
    const env = out.indexOf("an environment named egg-production");
    const repo = out.indexOf("Previews: repository secrets");
    expect(env).toBeGreaterThan(-1);
    expect(repo).toBeGreaterThan(env);
    expect(out.indexOf("EGG_UPLOAD_PRODUCTION_TOKEN")).toBeLessThan(repo);
    expect(out.indexOf("EGG_ENV_PRODUCTION_TOKEN")).toBeLessThan(repo);
    expect(out.indexOf("EGG_UPLOAD_PREVIEW_TOKEN")).toBeGreaterThan(repo);
    expect(out.indexOf("EGG_ENV_PREVIEW_TOKEN")).toBeGreaterThan(repo);
    expect(out).toContain("Selected branches and tags");
    expect(out).toContain("I saved all four secrets");
  });

  it("shows the values once, beside where they are pasted, and says so when they are gone", () => {
    expect(step(made)).toContain("Value for the EGG_UPLOAD_PRODUCTION_TOKEN secret");
    expect(step(made)).toContain("Egg does not show them again");
    expect(step(null)).not.toContain("Value for the");
    expect(step(null)).toContain("make new credentials in step 1");
  });

  it("keeps the two security warnings in short form", () => {
    const out = step(null);
    expect(out).toContain("must not be repository secrets");
    expect(out).toContain("trusted operators of this project");
  });
});

describe("adding the workflow file", () => {
  it("explains, for permission_missing, that the App needs three permissions only the person who runs Egg can grant", () => {
    const out = render(createElement(PermissionNotice));
    expect(out).toContain('role="alert"');
    expect(out).toContain("Contents, Pull requests and Workflows, each read and write");
    expect(out).toContain("Only the person who runs this Egg can grant it");
    expect(out).toContain("add the file by hand below");
    expect(publishAdvice({ code: "permission_missing", message: "x" }).manual).toBe(true);
  });

  it("gives an actionable sentence for every other code and never a bare status", () => {
    for (const code of ["workflow_invalid", "repo_unavailable", "not_a_github_project", "rate_limited", "github_error"]) {
      const a = publishAdvice({ code, message: "" });
      expect(a.text.length, code).toBeGreaterThan(30);
      expect(a.text, code).not.toMatch(/\b(403|404|422|429|502|400)\b/);
      expect(a.text, code).not.toMatch(/[–—]/);
    }
    expect(publishAdvice({ code: "rate_limited", message: "" }).manual).toBe(false);
    expect(publishAdvice({ code: "github_error", message: "" }).manual).toBe(true);
    expect(publishAdvice({ message: "The server said no." }).text).toBe("The server said no.");
  });

  it("links the pull request when one is opened, and says to merge it", () => {
    const out = render(
      createElement(PublishOutcome, {
        result: { status: "opened", branch: "egg/add-workflow", base: "main", pullRequestUrl: "https://github.com/sam/recipe-api/pull/7" },
      })
    );
    expect(out).toContain("Pull request opened");
    expect(out).toContain("Merge it on GitHub to finish.");
    expect(out).toContain('href="https://github.com/sam/recipe-api/pull/7"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("(opens in a new tab)");
  });

  it("says updated, and handles a missing pull request URL by naming the branch", () => {
    const upd = render(createElement(PublishOutcome, { result: { status: "updated", branch: "egg/add-workflow", base: "main", pullRequestUrl: null } }));
    expect(upd).toContain("Pull request updated");
    expect(upd).toContain("egg/add-workflow");
    expect(upd).not.toContain("<a ");
  });

  it("says when the file is already there and that nothing changed", () => {
    const out = render(createElement(PublishOutcome, { result: { status: "already", branch: "main", base: "main", pullRequestUrl: null } }));
    expect(out).toContain("already on");
    expect(out).toContain("Nothing changed.");
  });

  it("offers copy and download of egg.yml with the path, as the manual fallback", () => {
    const info: WorkflowInfo = {
      path: ".github/workflows/egg.yml",
      workflow: "name: Build for Egg\n",
      secrets: [],
      limits: { waitMinutes: 60, maxArchiveMb: 500, credentialDays: 90 },
    };
    const out = render(createElement(ManualWorkflow, { info, branch: "main", onReload: () => {} }));
    expect(out).toContain(".github/workflows/egg.yml");
    expect(out).toContain("Copy egg.yml");
    expect(out).toContain("Download egg.yml");
    expect(out).toContain('aria-label="Contents of .github/workflows/egg.yml"');
    expect(out).toContain("name: Build for Egg");
  });
});

describe("the connection test and the first build", () => {
  it("shows each check with a word as well as an icon, and the fix sentence", () => {
    const out = render(
      createElement(CheckList, {
        report: {
          allPassed: false,
          notChecked: ["Whether the secrets exist."],
          checks: [
            { id: "credentials", label: "Build credentials", status: "pass", detail: "Egg has all four build credentials." },
            { id: "workflow_file", label: "Workflow file", status: "fail", detail: "Egg found no file. Copy the workflow above." },
            { id: "workflow_matches", label: "Workflow settings", status: "not_checked", detail: "Not checked. It needs the workflow file first." },
          ],
        },
      })
    );
    expect(out).toContain("1 check failed, 1 not checked.");
    for (const w of ["Passed", "Failed", "Not checked"]) expect(out).toContain(w);
    expect(out).toContain("Copy the workflow above.");
    expect(out).toContain("What this test cannot check");
  });

  it("links the workflow runs and the deployments, and reports only the latest known state", () => {
    const out = render(createElement(FirstBuildStep, { slug: "recipe-api", repo: "sam/recipe-api", branch: "main", state: "error", autoDeploy: true }));
    expect(out).toContain("actions/workflows/egg.yml");
    expect(out).toContain("Run workflow");
    expect(out).toContain('href="/projects/recipe-api/deployments"');
    expect(out).toContain("Latest deployment: failed.");
  });

  it("does not invent a link when the repository is unknown", () => {
    const out = render(createElement(FirstBuildStep, { slug: "p", repo: null, branch: "main", state: null, autoDeploy: true }));
    expect(out).not.toContain("github.com");
    expect(out).toContain("Nothing has been deployed yet.");
  });
});
