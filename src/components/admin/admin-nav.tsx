"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/ledger", label: "Ledger" },
  { href: "/admin/deposits", label: "Deposits" },
  { href: "/admin/withdrawals", label: "Withdrawals" },
  { href: "/admin/tables", label: "Tables" },
  { href: "/admin/hands", label: "Hands" },
  { href: "/admin/risk", label: "Risk" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1">
      {items.map((i) => {
        const active = i.href === "/admin" ? pathname === "/admin" : pathname.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              active ? "bg-white/8 text-ivory" : "text-ash hover:bg-white/5 hover:text-ivory",
            )}
          >
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
