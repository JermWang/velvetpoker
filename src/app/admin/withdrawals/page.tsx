import { prisma } from "@/lib/db/prisma";
import { formatAmount } from "@/lib/ledger/money";
import { AdminDataTable, type Column } from "@/components/admin/admin-data-table";
import { StatusBadge } from "@/components/ui/badge";
import { AdminActionButton } from "@/components/admin/admin-action-button";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof load>>[number];

async function load() {
  return prisma.withdrawal.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: true },
  });
}

export default async function AdminWithdrawalsPage() {
  const rows = await load();

  const columns: Column<Row>[] = [
    { header: "User", cell: (w) => <span className="text-ivory">{w.user.email ?? w.userId}</span> },
    {
      header: "Amount",
      align: "right",
      cell: (w) => (
        <span className="font-mono text-ivory">
          {formatAmount(w.asset, w.amount)} {w.asset}
        </span>
      ),
    },
    { header: "To", cell: (w) => <span className="font-mono text-xs text-ash">{w.toAddress.slice(0, 10)}…</span> },
    { header: "Status", cell: (w) => <StatusBadge status={w.status} /> },
    {
      header: "Actions",
      align: "right",
      cell: (w) => (
        <div className="flex justify-end gap-2">
          {w.status === "PENDING_REVIEW" && (
            <>
              <AdminActionButton endpoint="/api/admin/withdrawals" body={{ withdrawalId: w.id, action: "approve" }}>
                Approve
              </AdminActionButton>
              <AdminActionButton
                endpoint="/api/admin/withdrawals"
                body={{ withdrawalId: w.id, action: "reject" }}
                variant="danger"
                confirm="Reject and refund this withdrawal?"
              >
                Reject
              </AdminActionButton>
            </>
          )}
          {w.status === "APPROVED" && (
            <AdminActionButton endpoint="/api/admin/withdrawals" body={{ withdrawalId: w.id, action: "send" }}>
              Send
            </AdminActionButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl text-ivory">Withdrawals</h1>
      <AdminDataTable columns={columns} rows={rows} rowKey={(w) => w.id} empty="No withdrawals." />
    </div>
  );
}
