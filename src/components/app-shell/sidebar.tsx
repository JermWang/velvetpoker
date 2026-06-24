"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ContractAddressChip } from "@/components/app-shell/contract-address";

const nav = [
  { href: "/app", label: "Overview", hint: "Your dashboard — balances and quick links." },
  { href: "/app/lobby", label: "Lobby", hint: "Browse public tables and join a game." },
  { href: "/app/host", label: "Host a table", hint: "Create your own cash game — public or private invite-only." },
  { href: "/app/cashier", label: "Cashier", hint: "Deposit and withdraw. Send from your connected wallet." },
  { href: "/app/history", label: "History", hint: "Past hands and your ledger of wins and losses." },
  { href: "/app/account", label: "Account", hint: "Profile photo and display name." },
  { href: "/app/support", label: "Support", hint: "Rules, help, and responsible-gaming tools." },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {nav.map((item) => {
        const active =
          item.href === "/app"
            ? pathname === "/app"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            // Don't viewport-prefetch every dynamic route at once — that opened a
            // burst of DB connections per page and tripped Prisma on serverless.
            // Still prefetches on hover, so navigation stays snappy.
            prefetch={false}
            title={item.hint}
            className={cn(
              // Tight left padding — labels sit close to the rail edge; any slack
              // is trailing space on the right.
              "rounded-lg py-2 pl-2 pr-2 text-sm transition-colors",
              active
                ? "bg-white/8 text-ivory"
                : "text-ash hover:bg-white/5 hover:text-ivory",
            )}
          >
            {item.label}
          </Link>
        );
      })}
      {/* Token CA — mobile nav drawer only (desktop carries it in the header). */}
      <div className="mt-3 border-t border-white/8 pt-3 md:hidden">
        <ContractAddressChip compact />
      </div>
    </nav>
  );
}
