import { prisma } from "@/lib/db/prisma";
import { formatAmount } from "@/lib/ledger/money";
import { AdminDataTable, type Column } from "@/components/admin/admin-data-table";
import { StatusBadge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof load>>[number];

async function load() {
  return prisma.deposit.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: true },
  });
}

export default async function AdminDepositsPage() {
  const rows = await load();
  const columns: Column<Row>[] = [
    {
      header: "User",
      cell: (d) =>
        d.userId ? (
          <span className="text-ivory">{d.user?.email ?? d.userId}</span>
        ) : (
          <span className="text-amber-300" title={d.fromAddress ?? undefined}>
            Unattributed
          </span>
        ),
    },
    {
      header: "Amount",
      align: "right",
      cell: (d) => <span className="font-mono text-ivory">{formatAmount(d.asset, d.amount)} {d.asset}</span>,
    },
    { header: "Tx", cell: (d) => <span className="font-mono text-xs text-ash">{d.txSignature.slice(0, 16)}…</span> },
    { header: "Confirms", align: "right", cell: (d) => <span className="text-ash">{d.confirmations}</span> },
    { header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl text-ivory">Deposits</h1>
      <AdminDataTable columns={columns} rows={rows} rowKey={(d) => d.id} empty="No deposits." />
    </div>
  );
}
