/** One exact database account id grants instance administration. Never infer it from a name or email. */
export function instanceAdminId(): string | null {
  return process.env.SECURITY_REPORT_ADMIN_ID?.trim() || null;
}

export function isInstanceAdmin(userId: string | null | undefined): boolean {
  const configured = instanceAdminId();
  return !!configured && userId === configured;
}
