import { prisma } from "@/lib/db/prisma";
import { AdminDataTable, type Column } from "@/components/admin/admin-data-table";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof load>>[number];

async function load() {
  return prisma.riskEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 150,
    include: { user: true },
  });
}

const severityTone = {
  LOW: "neutral",
  MEDIUM: "amber",
  HIGH: "red",
  CRITICAL: "red",
} as const;

export default async function AdminRiskPage() {
  const rows = await load();
  const columns: Column<Row>[] = [
    { header: "When", cell: (r) => <span className="text-ash">{r.createdAt.toISOString().slice(0, 19).replace("T", " ")}</span> },
    { header: "Type", cell: (r) => <span className="text-ivory">{r.type.replace(/_/g, " ").toLowerCase()}</span> },
    { header: "Severity", cell: (r) => <Badge tone={severityTone[r.severity]}>{r.severity}</Badge> },
    { header: "User", cell: (r) => <span className="text-ash">{r.user?.email ?? "—"}</span> },
    {
      header: "Detail",
      cell: (r) => (
        <span className="font-mono text-xs text-ash">
          {r.metadata ? JSON.stringify(r.metadata).slice(0, 60) : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl text-ivory">Risk events</h1>
      <AdminDataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="No risk events." />
    </div>
  );
}
