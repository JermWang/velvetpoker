import { requireUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { formatAmount, ASSET_SYMBOLS } from "@/lib/ledger/money";
import { solscanTxUrl } from "@/lib/solana/explorer";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { VerifyHandDrawer } from "@/components/poker/verify-hand-drawer";

export const dynamic = "force-dynamic";

/** Pull an on-chain tx signature out of a ledger entry's metadata, if present. */
function txSignatureOf(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const sig = (metadata as Record<string, unknown>).txSignature;
    if (typeof sig === "string" && sig.length > 0) return sig;
  }
  return null;
}

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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="text-left text-xs text-ash">
                  <tr>
                    <th className="pb-2">Hand</th>
                    <th className="pb-2">Result</th>
                    <th className="pb-2 text-right">Won</th>
                    <th className="pb-2 text-right">Rake</th>
                    <th className="pb-2 text-right">Verify</th>
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
                      <td className="py-2 text-right font-mono text-ash">
                        {formatAmount(r.hand.table.asset, r.hand.rakeAmount)}{" "}
                        {ASSET_SYMBOLS[r.hand.table.asset]}
                      </td>
                      <td className="py-2 text-right">
                        <VerifyHandDrawer handId={r.hand.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-5">
          <h3 className="mb-4 text-sm font-medium text-ivory">Ledger entries</h3>
          {ledger.length === 0 ? (
            <p className="text-sm text-ash">No ledger activity yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="text-left text-xs text-ash">
                  <tr>
                    <th className="pb-2">When</th>
                    <th className="pb-2">Reason</th>
                    <th className="pb-2">Account</th>
                    <th className="pb-2 text-right">Amount</th>
                    <th className="pb-2 text-right">On-chain</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {ledger.map((e) => {
                    const sig = txSignatureOf(e.metadata);
                    return (
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
                        <td className="py-2 text-right">
                          {sig ? (
                            <a
                              href={solscanTxUrl(sig)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-velvet-soft underline decoration-velvet-soft/40 underline-offset-2 hover:text-velvet"
                            >
                              Solscan ↗
                            </a>
                          ) : (
                            <span className="text-ash/40">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
