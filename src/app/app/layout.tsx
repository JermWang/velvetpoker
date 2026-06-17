import { requireUser } from "@/lib/auth/require-user";
import { getUserBalances } from "@/lib/queries";
import { Wordmark } from "@/components/brand";
import { Sidebar } from "@/components/app-shell/sidebar";
import { BalancePill } from "@/components/app-shell/balance-pill";
import { AuthMenu } from "@/components/app-shell/auth-menu";
import { initials } from "@/lib/utils";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const balances = await getUserBalances(user.id);

  return (
    <div className="min-h-screen">
      {/* Top nav */}
      <header className="sticky top-0 z-30 border-b border-white/8 bg-charcoal-900/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Wordmark href="/app" />
          <div className="flex items-center gap-4">
            <BalancePill balances={balances} />
            <div
              className="grid h-9 w-9 place-items-center rounded-full border border-white/12 bg-white/5 text-xs text-ivory"
              title={user.displayName ?? user.email ?? "Account"}
            >
              {initials(user.displayName ?? user.email)}
            </div>
            <AuthMenu />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-6 py-8">
        <aside className="hidden w-52 shrink-0 md:block">
          <div className="sticky top-24">
            <Sidebar isAdmin={user.role === "ADMIN"} />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
