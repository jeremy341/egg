import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/current";
import { isInstanceAdmin } from "@/server/admin-identity";
import { AdminUsers } from "@/components/admin-users";
import { GenericSkeleton } from "@/components/skeletons/generic";

export const metadata = { title: "Accounts · Instance administration" };

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<GenericSkeleton />}>
      <AdminUsersContent />
    </Suspense>
  );
}

async function AdminUsersContent() {
  const user = await requireUser();
  // The page is hidden from everyone else. The API checks administration again on every request.
  if (!(await isInstanceAdmin(user.id))) notFound();
  return <AdminUsers />;
}
