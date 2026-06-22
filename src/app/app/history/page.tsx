import { requireUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { formatAmount, ASSET_SYMBOLS } from "@/lib/ledger/money";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const user = await requireUser();
  const [ledger, results] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.handResult.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { hand: { include: { table: true } } },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-eyebrow">Your record</p>
        <h1 className="mt-2 font-display text-3xl text-ivory">History</h1>
      </div>

      <Card>
        <CardContent className="py-5">
          <h3 className="mb-4 text-sm font-medium text-ivory">Recent hands</h3>
          {results.length === 0 ? (
            <p className="text-sm text-ash">No hands played yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ash">
                <tr>
                  <th className="pb-2">Hand</th>
                  <th className="pb-2">Result</th>
                  <th className="pb-2 text-right">Won</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {results.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 font-mono text-ash">
                      #{r.hand.handNumber}
                    </td>
                    <td className="py-2 text-ivory">{r.handDescription}</td>
                    <td className="py-2 text-right font-mono text-ivory">
                      {formatAmount(r.hand.table.asset, r.amountWon)}{" "}
                      {ASSET_SYMBOLS[r.hand.table.asset]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-5">
          <h3 className="mb-4 text-sm font-medium text-ivory">Ledger entries</h3>
          {ledger.length === 0 ? (
            <p className="text-sm text-ash">No ledger activity yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ash">
                <tr>
                  <th className="pb-2">When</th>
                  <th className="pb-2">Reason</th>
                  <th className="pb-2">Account</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {ledger.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2 text-ash">
                      {e.createdAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="py-2 text-ivory">
                      {e.reason.replace(/_/g, " ").toLowerCase()}
                    </td>
                    <td className="py-2">
                      <Badge>{e.accountType.replace(/_/g, " ")}</Badge>
                    </td>
                    <td className="py-2 text-right font-mono text-ivory">
                      {e.direction === "DEBIT" ? "−" : "+"}
                      {formatAmount(e.asset, e.amount)} {ASSET_SYMBOLS[e.asset]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
