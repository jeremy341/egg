import { OrganizationsView } from "@/components/organizations-view";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/server/auth/current";
import { listOrganizationsFor } from "@/server/organizations";

export const metadata = { title: "Organizations" };

export default async function OrganizationsPage() {
  const user = await requireUser();
  const organizations = await listOrganizationsFor(user.id);
  return (
    <div className="motion-enter">
      <PageHeader title="Organizations" description="Share projects and their roles with a team." />
      <OrganizationsView organizations={organizations.map((o) => ({ id: o.id, name: o.name, role: o.role }))} />
    </div>
  );
}
