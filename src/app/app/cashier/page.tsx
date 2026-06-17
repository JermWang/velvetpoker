import { requireUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { getUserBalances } from "@/lib/queries";
import { canPlayRealMoney } from "@/lib/compliance/gates";
import { formatAmount } from "@/lib/ledger/money";
import { CashierPanel } from "@/components/cashier/cashier-panel";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function CashierPage() {
  const user = await requireUser();
  const [balances, deposits, withdrawals] = await Promise.all([
    getUserBalances(user.id),
    prisma.deposit.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.withdrawal.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-eyebrow">Custody &amp; settlement</p>
        <h1 className="mt-2 font-display text-3xl text-ivory">Cashier</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {balances.map((b) => (
          <Card key={b.asset}>
            <CardContent className="flex items-baseline justify-between py-5">
              <span className="text-sm text-ash">{b.asset}</span>
              <span className="font-mono text-xl text-ivory">
                {formatAmount(b.asset, b.available)}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      <CashierPanel canPlay={canPlayRealMoney(user)} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="py-5">
            <h3 className="mb-3 text-sm font-medium text-ivory">Recent deposits</h3>
            {deposits.length === 0 ? (
              <p className="text-sm text-ash">No deposits yet.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {deposits.map((d) => (
                  <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-mono text-ivory">
                      {formatAmount(d.asset, d.amount)} {d.asset}
                    </span>
                    <StatusBadge status={d.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-5">
            <h3 className="mb-3 text-sm font-medium text-ivory">Recent withdrawals</h3>
            {withdrawals.length === 0 ? (
              <p className="text-sm text-ash">No withdrawals yet.</p>
            ) : (
              <ul className="divide-y divide-white/5">
                {withdrawals.map((w) => (
                  <li key={w.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-mono text-ivory">
                      {formatAmount(w.asset, w.amount)} {w.asset}
                    </span>
                    <StatusBadge status={w.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
