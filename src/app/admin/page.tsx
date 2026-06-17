import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const [users, pendingWithdrawals, openTables, riskHigh, deposits] =
    await Promise.all([
      prisma.user.count(),
      prisma.withdrawal.count({ where: { status: "PENDING_REVIEW" } }),
      prisma.pokerTable.count({ where: { status: { in: ["WAITING", "ACTIVE"] } } }),
      prisma.riskEvent.count({ where: { severity: { in: ["HIGH", "CRITICAL"] } } }),
      prisma.deposit.count(),
    ]);

  const metrics = [
    { label: "Users", value: users, href: "/admin/users" },
    { label: "Withdrawals to review", value: pendingWithdrawals, href: "/admin/withdrawals" },
    { label: "Open tables", value: openTables, href: "/admin/tables" },
    { label: "High/critical risk events", value: riskHigh, href: "/admin/risk" },
    { label: "Deposits", value: deposits, href: "/admin/deposits" },
  ];

  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl text-ivory">Operations</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((m) => (
          <Link key={m.label} href={m.href}>
            <Card className="transition-colors hover:border-velvet/30">
              <CardContent className="py-5">
                <p className="text-xs text-ash">{m.label}</p>
                <p className="mt-1 font-mono text-3xl text-ivory">{m.value}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
