export const SOURCE_PROVIDERS = [
  { value: "github", label: "GitHub", example: "https://github.com/owner/name" },
  { value: "gitlab", label: "GitLab", example: "https://gitlab.com/group/name" },
  { value: "forgejo", label: "Forgejo", example: "https://git.example.org/owner/name" },
  { value: "codeberg", label: "Codeberg", example: "https://codeberg.org/owner/name" },
  { value: "generic", label: "Other Git server", example: "https://git.example.org/owner/name.git" },
] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number]["value"];
export const providerLabel = (provider: SourceProvider) => SOURCE_PROVIDERS.find((p) => p.value === provider)!.label;

/** Early input feedback only; the API validates and authorizes the actual fetch. */
export function repositoryUrl(provider: SourceProvider, input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("Enter a complete HTTPS repository URL."); }
  if (url.username || url.password) throw new Error("Keep credentials out of the URL. Connect the provider separately.");
  const hasRepositoryPath = provider === "generic" ? url.pathname.length > 1 : /^\/.+\/.+/.test(url.pathname);
  if (url.protocol !== "https:" || url.search || url.hash || !hasRepositoryPath) throw new Error("Enter a complete HTTPS repository URL without query parameters or fragments.");
  const expectedHost = provider === "github" ? "github.com" : provider === "codeberg" ? "codeberg.org" : null;
  if (expectedHost && url.hostname !== expectedHost) throw new Error(`Use a repository on ${expectedHost}, or choose another source.`);
  if (provider === "github") {
    if (!/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname)) throw new Error("Enter the repository URL, without a branch or file path.");
    url.pathname = url.pathname.replace(/\/$/, "").replace(/\.git$/, "");
  }
  return url.toString().replace(/\/$/, "");
}
