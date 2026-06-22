"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/app", label: "Overview", hint: "Your dashboard — balances and quick links." },
  { href: "/app/lobby", label: "Lobby", hint: "Browse public tables and join a game." },
  { href: "/app/host", label: "Host a table", hint: "Create your own cash game — public or private invite-only." },
  { href: "/app/cashier", label: "Cashier", hint: "Deposit and withdraw. Send from your connected wallet." },
  { href: "/app/history", label: "History", hint: "Past hands and your ledger of wins and losses." },
  { href: "/app/account", label: "Account", hint: "Profile photo, display name, limits, and verification." },
  { href: "/app/support", label: "Support", hint: "Rules, help, and responsible-gaming tools." },
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
            title={item.hint}
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
          className="mt-4 rounded-lg border border-velvet/25 px-3 py-2 text-sm text-velvet hover:bg-velvet/10"
        >
          Admin console
        </Link>
      )}
    </nav>
  );
}
