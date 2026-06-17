import { prisma } from "@/lib/db/prisma";
import { formatAmount } from "@/lib/ledger/money";
import { AdminDataTable, type Column } from "@/components/admin/admin-data-table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof load>>[number];

async function load() {
  return prisma.ledgerEntry.findMany({
    orderBy: { createdAt: "desc" },
    take: 150,
    include: { user: true },
  });
}

export default async function AdminLedgerPage() {
  const rows = await load();
  const columns: Column<Row>[] = [
    { header: "When", cell: (e) => <span className="text-ash">{e.createdAt.toISOString().slice(0, 19).replace("T", " ")}</span> },
    { header: "User", cell: (e) => <span className="text-ivory">{e.user?.email ?? "system"}</span> },
    { header: "Reason", cell: (e) => <span className="text-ash">{e.reason.replace(/_/g, " ").toLowerCase()}</span> },
    { header: "Account", cell: (e) => <Badge>{e.accountType.replace(/_/g, " ")}</Badge> },
    {
      header: "Amount",
      align: "right",
      cell: (e) => (
        <span className="font-mono text-ivory">
          {e.direction === "DEBIT" ? "−" : "+"}
          {formatAmount(e.asset, e.amount)} {e.asset}
        </span>
      ),
    },
    { header: "Correlation", cell: (e) => <span className="font-mono text-xs text-ash">{e.correlationId.slice(0, 24)}</span> },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl text-ivory">Ledger</h1>
      <p className="text-sm text-ash">Append-only double-entry record. Every movement appears as balanced legs.</p>
      <AdminDataTable columns={columns} rows={rows} rowKey={(e) => e.id} />
    </div>
  );
}
