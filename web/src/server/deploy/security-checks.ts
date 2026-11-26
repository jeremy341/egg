import { eq } from "drizzle-orm";
import { open } from "@/server/crypto";
import { getDb, schema } from "@/server/db";
import { parseImageRef } from "@/server/deploy/image-ref";
import { assertOwned, type ProjectRow } from "@/server/projects";

export type SecurityFinding = {
  id: "plaintext-secret" | "http-domain" | "movable-image-tag";
  severity: "warning";
  title: string;
  message: string;
  resource: string;
};

export type SecurityCheckData = {
  project: Pick<ProjectRow, "deploymentMode" | "imageRef">;
  env: Array<{ key: string; value: string }>;
  domains: Array<{ domain: string }>;
};

const SECRET_KEY = /(?:secret|token|password|passwd|credential|private[_-]?key|api[_-]?key|auth)/i;
const PLACEHOLDER = /^(?:\$\{[^}]+\}|\$[A-Z_][A-Z0-9_]*|<[^>]+>|\[.*\]|secret:\/\/.*)$/i;

/** Pure checks; messages intentionally never contain environment values. */
export function findSecurityChecks(data: SecurityCheckData): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const entry of data.env) {
    if (SECRET_KEY.test(entry.key) && entry.value.trim() && !PLACEHOLDER.test(entry.value.trim())) {
      findings.push({
        id: "plaintext-secret",
        severity: "warning",
        title: "Secret stored directly in an environment value",
        message: "This secret appears to be a literal value. Rotate it if it has been exposed and use a protected secret source where available.",
        resource: entry.key,
      });
    }
  }

  for (const entry of data.domains) {
    if (/^http:\/\//i.test(entry.domain.trim())) {
      findings.push({
        id: "http-domain",
        severity: "warning",
        title: "Custom domain uses HTTP without TLS",
        message: "This custom domain is configured with HTTP. Use HTTPS so traffic is encrypted in transit.",
        resource: entry.domain,
      });
    }
  }

  if (data.project.deploymentMode === "image" && data.project.imageRef) {
    const parsed = parseImageRef(data.project.imageRef);
    if (parsed.ok && parsed.ref.movableTag) {
      findings.push({
        id: "movable-image-tag",
        severity: "warning",
        title: "Container image can change without a project change",
        message: "This image reference uses a movable tag or no tag. Pin it to an immutable digest for repeatable deployments.",
        resource: data.project.imageRef,
      });
    }
  }

  return findings;
}

/** Owner-only, read-only configuration scan. Secret values are decrypted only for inspection and never returned. */
export async function securityChecksForProject(userId: string, projectId: string): Promise<SecurityFinding[]> {
  const project = await assertOwned(userId, projectId);
  const db = await getDb();
  const [envRows, domainRows] = await Promise.all([
    db.select({ key: schema.envVars.key, target: schema.envVars.target, valueEnc: schema.envVars.valueEnc })
      .from(schema.envVars).where(eq(schema.envVars.projectId, project.id)),
    db.select({ domain: schema.domains.domain }).from(schema.domains)
      .where(eq(schema.domains.projectId, project.id)),
  ]);
  const env = envRows.flatMap((row) => {
    try {
      return [{ key: row.key, value: open(row.valueEnc, `env:${project.id}:${row.key}:${row.target}`) }];
    } catch {
      // A rotated key or damaged row cannot be safely inspected; never expose it.
      return [];
    }
  });
  return findSecurityChecks({ project, env, domains: domainRows });
}
