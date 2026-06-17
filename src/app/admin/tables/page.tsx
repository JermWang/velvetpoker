import { prisma } from "@/lib/db/prisma";
import { formatAmount } from "@/lib/ledger/money";
import { AdminDataTable, type Column } from "@/components/admin/admin-data-table";
import { StatusBadge } from "@/components/ui/badge";
import { AdminActionButton } from "@/components/admin/admin-action-button";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof load>>[number];

async function load() {
  return prisma.pokerTable.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { seats: true } } },
  });
}

export default async function AdminTablesPage() {
  const rows = await load();
  const columns: Column<Row>[] = [
    { header: "Name", cell: (t) => <span className="text-ivory">{t.name}</span> },
    { header: "Stakes", cell: (t) => <span className="font-mono text-ash">{formatAmount(t.asset, t.smallBlind)}/{formatAmount(t.asset, t.bigBlind)} {t.asset}</span> },
    { header: "Seats", cell: (t) => <span className="text-ash">{t.maxSeats}-max</span> },
    { header: "Visibility", cell: (t) => <span className="text-ash">{t.visibility}</span> },
    { header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
    {
      header: "Actions",
      align: "right",
      cell: (t) => (
        <div className="flex justify-end gap-2">
          {t.status !== "PAUSED" && t.status !== "CLOSED" && (
            <AdminActionButton endpoint="/api/admin/tables" body={{ tableId: t.id, action: "pause" }}>
              Pause
            </AdminActionButton>
          )}
          {t.status === "PAUSED" && (
            <AdminActionButton endpoint="/api/admin/tables" body={{ tableId: t.id, action: "resume" }}>
              Resume
            </AdminActionButton>
          )}
          {t.status !== "CLOSED" && (
            <AdminActionButton
              endpoint="/api/admin/tables"
              body={{ tableId: t.id, action: "close" }}
              variant="danger"
              confirm="Close this table after the current hand?"
            >
              Close
            </AdminActionButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl text-ivory">Tables</h1>
      <AdminDataTable columns={columns} rows={rows} rowKey={(t) => t.id} empty="No tables." />
    </div>
  );
}
