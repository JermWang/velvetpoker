import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { AccountActions } from "@/components/account/account-actions";
import { ReferralPanel } from "@/components/account/referral-panel";
import { getReferralSummary } from "@/lib/referrals/referrals";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  const referral = await getReferralSummary(user.id);

  const rows: Array<[string, string]> = [
    ["Account status", user.status],
    ["Location", user.geofenceStatus],
    ["Age verified", user.ageVerifiedAt ? "Yes" : "No"],
    ["Country", user.country ?? "—"],
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-eyebrow">Profile &amp; compliance</p>
        <h1 className="mt-2 font-display text-3xl text-ivory">Account</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-white/5">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-2.5 text-sm">
                <dt className="text-ash">{k}</dt>
                <dd>
                  {["ACTIVE", "APPROVED", "ALLOWED", "PENDING", "REJECTED", "BLOCKED", "SUSPENDED", "SELF_EXCLUDED", "NOT_STARTED", "UNKNOWN"].includes(v) ? (
                    <StatusBadge status={v} />
                  ) : (
                    <span className="text-ivory">{v}</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manage</CardTitle>
        </CardHeader>
        <CardContent>
          <AccountActions />
        </CardContent>
      </Card>
    </div>
  );
}
