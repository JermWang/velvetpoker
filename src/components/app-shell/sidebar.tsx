"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/app", label: "Overview" },
  { href: "/app/lobby", label: "Lobby" },
  { href: "/app/host", label: "Host a table" },
  { href: "/app/cashier", label: "Cashier" },
  { href: "/app/history", label: "History" },
  { href: "/app/account", label: "Account" },
  { href: "/app/support", label: "Support" },
];

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {nav.map((item) => {
        const active =
          item.href === "/app"
            ? pathname === "/app"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-lg px-3 py-2 text-sm transition-colors",
              active
                ? "bg-white/8 text-ivory"
                : "text-ash hover:bg-white/5 hover:text-ivory",
            )}
          >
            {item.label}
          </Link>
        );
      })}
      {isAdmin && (
        <Link
          href="/admin"
          className="mt-4 rounded-lg border border-gold/25 px-3 py-2 text-sm text-gold hover:bg-gold/10"
        >
          Admin console
        </Link>
      )}
    </nav>
  );
}
