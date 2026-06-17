import { prisma } from "@/lib/db/prisma";
import { AdminDataTable, type Column } from "@/components/admin/admin-data-table";
import { StatusBadge } from "@/components/ui/badge";
import { AdminActionButton } from "@/components/admin/admin-action-button";

export const dynamic = "force-dynamic";

type Row = Awaited<ReturnType<typeof load>>[number];

async function load() {
  return prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
}

export default async function AdminUsersPage() {
  const rows = await load();

  const columns: Column<Row>[] = [
    { header: "Email", cell: (u) => <span className="text-ivory">{u.email ?? "—"}</span> },
    { header: "Role", cell: (u) => <span className="text-ash">{u.role}</span> },
    { header: "Status", cell: (u) => <StatusBadge status={u.status} /> },
    { header: "KYC", cell: (u) => <StatusBadge status={u.kycStatus} /> },
    { header: "Geo", cell: (u) => <StatusBadge status={u.geofenceStatus} /> },
    {
      header: "Actions",
      align: "right",
      cell: (u) => (
        <div className="flex justify-end gap-2">
          {u.status === "ACTIVE" ? (
            <AdminActionButton
              endpoint="/api/admin/users"
              body={{ userId: u.id, action: "suspend" }}
            >
              Suspend
            </AdminActionButton>
          ) : (
            <AdminActionButton
              endpoint="/api/admin/users"
              body={{ userId: u.id, action: "activate" }}
            >
              Reinstate
            </AdminActionButton>
          )}
          <AdminActionButton
            endpoint="/api/admin/users"
            body={{ userId: u.id, action: "block" }}
            variant="danger"
            confirm="Block this user from the platform?"
          >
            Block
          </AdminActionButton>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl text-ivory">Users</h1>
      <AdminDataTable columns={columns} rows={rows} rowKey={(u) => u.id} />
    </div>
  );
}
