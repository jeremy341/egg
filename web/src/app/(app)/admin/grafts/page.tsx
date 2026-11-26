import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/current";
import { isInstanceAdmin } from "@/server/admin-identity";
import { listGrafts } from "@/server/grafts/registry";
import { AdminGrafts } from "@/components/admin-grafts";
import { GenericSkeleton } from "@/components/skeletons/generic";
import { Suspense } from "react";

export const metadata = { title: "Apps · Instance administration" };

export default function AdminGraftsPage() {
  return <Suspense fallback={<GenericSkeleton />}><AdminGraftsContent /></Suspense>;
}

async function AdminGraftsContent() {
  const user = await requireUser();
  if (!(await isInstanceAdmin(user.id))) notFound();
  return <AdminGrafts initial={await listGrafts()} />;
}
