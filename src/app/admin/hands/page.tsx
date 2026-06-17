import { prisma } from "@/lib/db/prisma";
import { formatAmount } from "@/lib/ledger/money";
import { AdminDataTable, type Column } from "@/components/admin/admin-data-table";
import { StatusBadge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof load>>[number];

async function load() {
  return prisma.hand.findMany({
    orderBy: { startedAt: "desc" },
    take: 100,
    include: { table: true, _count: { select: { actions: true } } },
  });
}

export default async function AdminHandsPage() {
  const rows = await load();
  const columns: Column<Row>[] = [
    { header: "Hand", cell: (h) => <span className="font-mono text-ash">{h.table.name} #{h.handNumber}</span> },
    { header: "Status", cell: (h) => <StatusBadge status={h.status} /> },
    {
      header: "Pot",
      align: "right",
      cell: (h) => <span className="font-mono text-ivory">{formatAmount(h.table.asset, h.potAmount)} {h.table.asset}</span>,
    },
    { header: "Actions", align: "right", cell: (h) => <span className="text-ash">{h._count.actions}</span> },
    { header: "Seed hash", cell: (h) => <span className="font-mono text-xs text-ash">{h.serverSeedHash.slice(0, 16)}…</span> },
    {
      header: "Revealed",
      cell: (h) => (h.serverSeed ? <span className="text-emerald-300">yes</span> : <span className="text-ash">no</span>),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl text-ivory">Hands</h1>
      <AdminDataTable columns={columns} rows={rows} rowKey={(h) => h.id} empty="No hands recorded." />
    </div>
  );
}
