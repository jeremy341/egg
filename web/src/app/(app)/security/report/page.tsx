import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/server/auth/current";
import { PageHeader } from "@/components/page-header";
import { SecurityReportForm } from "@/components/security-report-form";
import { GenericSkeleton } from "@/components/skeletons/generic";

export const metadata = { title: "Report a vulnerability" };

export default function ReportPage() {
  return (
    <Suspense fallback={<GenericSkeleton />}>
      <ReportContent />
    </Suspense>
  );
}

async function ReportContent() {
  await requireUser();
  return (
    <div className="motion-enter mx-auto w-full max-w-[720px]">
      <PageHeader
        title="Report a vulnerability"
        description="Send a private report to the maintainer. You must be signed in, and you can leave out your identity."
      />
      <p className="mb-4 text-label text-muted-foreground">
        Read the{" "}
        <Link href="/security" className="link font-medium">
          security page
        </Link>{" "}
        first for what Egg protects and what it does not. Do not open a public issue for a vulnerability.
      </p>
      <SecurityReportForm />
    </div>
  );
}
