import type { ReactNode } from "react";

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: "left" | "right";
}

export function AdminDataTable<T>({
  columns,
  rows,
  empty = "No records.",
  rowKey,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  rowKey: (row: T) => string;
}) {
  if (rows.length === 0) {
    return <p className="card-surface p-8 text-center text-sm text-ash">{empty}</p>;
  }
  return (
    <div className="card-surface overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-white/8 text-left text-xs uppercase tracking-wide text-ash">
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                className={`px-4 py-3 font-medium ${c.align === "right" ? "text-right" : ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-white/[0.02]">
              {columns.map((c, i) => (
                <td
                  key={i}
                  className={`px-4 py-3 ${c.align === "right" ? "text-right" : ""}`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
