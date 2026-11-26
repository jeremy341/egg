import { getCurrentUser } from "@/server/auth/current";
import { accountStandingFor, standingNotice } from "@/server/account-standing";
import { StandingBanner } from "@/components/standing-banner";

/** Shown to a signed-in account that is suspended. Active accounts get nothing. */
export async function AccountStandingBanner() {
  const user = await getCurrentUser();
  if (!user) return null;
  const notice = standingNotice(await accountStandingFor(user.id));
  return notice ? <StandingBanner notice={notice} /> : null;
}
