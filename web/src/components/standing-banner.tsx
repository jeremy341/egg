import { Alert } from "@/components/ui/alert";
import type { StandingNotice } from "@/server/account-standing";

/** The suspension notice at the top of the app. It is text only, so it renders the same on the server and in tests. */
export function StandingBanner({ notice }: { notice: StandingNotice }) {
  return (
    <Alert tone={notice.tone} className="mb-4">
      <p className="font-medium">{notice.title}</p>
      <p className="mt-0.5">{notice.body}</p>
    </Alert>
  );
}
