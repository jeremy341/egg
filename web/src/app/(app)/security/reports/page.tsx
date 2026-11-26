import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/current";
import { isInstanceAdmin } from "@/server/admin-identity";
import {
  listSecurityReports,
  REPORT_HEADROOM_HOURLY_LIMIT,
  securityReportCapacity,
} from "@/server/security-reports";
import { PageHeader } from "@/components/page-header";
import { SecurityReportInbox } from "@/components/security-report-inbox";
import { GenericSkeleton } from "@/components/skeletons/generic";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Private vulnerability reports" };

export default function ReportsPage() {
  return (
    <Suspense fallback={<GenericSkeleton />}>
      <ReportsContent />
    </Suspense>
  );
}

async function ReportsContent() {
  const user = await requireUser();
  if (!(await isInstanceAdmin(user.id))) notFound();
  const reports = await listSecurityReports(user.id);
  const capacity = await securityReportCapacity(user.id);
  return (
    <div className="motion-enter">
      <PageHeader
        title="Vulnerability reports"
        description="Private evidence and reports sent to this Egg instance."
      />
      {capacity.low && (
        <Alert tone="warning" role="status" className="mb-4">
          The inbox is {Math.round(capacity.fraction * 100)}% full ({capacity.used} of{" "}
          {capacity.limit} reports). New anonymous reports are limited to{" "}
          {REPORT_HEADROOM_HOURLY_LIMIT} an hour so the last slots stay free. Delete reports
          you have finished with to make room.
        </Alert>
      )}
      <SecurityReportInbox
        initial={reports.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
