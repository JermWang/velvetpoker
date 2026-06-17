import Link from "next/link";
import type { User } from "@prisma/client";
import { evaluateRealMoneyGates } from "@/lib/compliance/gates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ComplianceGateCard({ user }: { user: User }) {
  const { allowed, failures } = evaluateRealMoneyGates(user);

  if (allowed) {
    return (
      <Card className="border-emerald-500/20">
        <CardContent className="flex items-center justify-between py-5">
          <div>
            <p className="text-sm font-medium text-ivory">
              You&apos;re cleared for real-money play
            </p>
            <p className="mt-1 text-xs text-ash">
              Identity verified, location eligible, account in good standing.
            </p>
          </div>
          <Badge tone="green">Verified</Badge>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/25">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Before you can play for real money</CardTitle>
          <Badge tone="amber">Action needed</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {failures.map((f) => (
            <li key={f.code} className="flex items-start gap-2 text-sm text-ash">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/70" />
              {f.message}
            </li>
          ))}
        </ul>
        <div className="mt-5">
          <Link href="/app/account">
            <Button size="sm" variant="secondary">
              Complete verification
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
