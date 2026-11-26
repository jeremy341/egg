import { notFound } from "next/navigation";
import { OrganizationDetail } from "@/components/organization-detail";
import { PageHeader } from "@/components/page-header";
import { canInvite } from "@/lib/org-roles";
import { requireUser } from "@/server/auth/current";
import { getOrganizationFor, listOrgMembers } from "@/server/organizations";
import { pendingInvitations } from "@/server/invitations";
import { HttpError } from "@/server/http";

export const metadata = { title: "Organization" };

type Props = { params: Promise<{ id: string }> };

export default async function OrganizationPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();
  let org;
  try {
    org = await getOrganizationFor(user.id, id);
  } catch (err) {
    // Not a member, or no such organization: the same answer either way.
    if (err instanceof HttpError && err.status === 404) notFound();
    throw err;
  }
  const members = await listOrgMembers(user.id, id);
  // Only admins and owners may see invitations; the server refuses anyone else, so the page asks only when allowed.
  const invitations = canInvite(org.role) ? await pendingInvitations(user.id, id) : [];

  return (
    <div className="motion-enter">
      <PageHeader title={org.name} description={`Your role: ${org.role}`} />
      <OrganizationDetail
        orgId={org.id}
        orgName={org.name}
        myId={user.id}
        myRole={org.role}
        members={members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role }))}
        invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
      />
    </div>
  );
}
