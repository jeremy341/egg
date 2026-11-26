import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/current";
import { isInstanceAdmin } from "@/server/admin-identity";
import { adminOverview } from "@/server/admin";
import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminAdministrators } from "@/components/admin-administrators";
import { GenericSkeleton } from "@/components/skeletons/generic";
import { buttonVariants } from "@/components/ui/button";

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
  if (!(await isInstanceAdmin(user.id))) notFound();
  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <div className="flex gap-2">
          <Link href="/admin/grafts" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Apps
          </Link>
          <Link href="/admin/users" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Accounts and bans
          </Link>
        </div>
      </div>
      <AdminDashboard initial={await adminOverview(user.id)} />
      <AdminAdministrators />
    </div>
  );
}
