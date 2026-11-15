import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/current";
import { isInstanceAdmin } from "@/server/admin-identity";
import { adminOverview } from "@/server/admin";
import { AdminDashboard } from "@/components/admin-dashboard";
import { GenericSkeleton } from "@/components/skeletons/generic";

export const metadata = { title: "Instance administration" };

export default function AdminPage() {
  return (
    <Suspense fallback={<GenericSkeleton />}>
      <AdminContent />
    </Suspense>
  );
}

async function AdminContent() {
  const user = await requireUser();
  if (!isInstanceAdmin(user.id)) notFound();
  return <AdminDashboard initial={await adminOverview(user.id)} />;
}
