import { AcceptInvitation } from "@/components/accept-invitation";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Accept invitation" };

type Props = { params: Promise<{ token: string }> };

export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  return (
    <div className="motion-enter">
      <PageHeader title="Join an organization" />
      <AcceptInvitation token={token} />
    </div>
  );
}
