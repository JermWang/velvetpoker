import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileCard } from "@/components/account/profile-card";
import { ReferralPanel } from "@/components/account/referral-panel";
import { getReferralSummary } from "@/lib/referrals/referrals";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  const referral = await getReferralSummary(user.id);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-eyebrow">Your profile</p>
        <h1 className="mt-2 font-display text-3xl text-ivory">Account</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileCard displayName={user.displayName} avatarUrl={user.avatarUrl} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Refer &amp; earn</CardTitle>
        </CardHeader>
        <CardContent>
          <ReferralPanel
            code={referral.code}
            refereeCount={referral.refereeCount}
            balances={referral.balances}
          />
        </CardContent>
      </Card>
    </div>
  );
}
