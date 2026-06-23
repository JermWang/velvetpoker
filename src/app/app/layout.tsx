import { getCurrentUser } from "@/lib/auth/require-user";
import { getUserBalances } from "@/lib/queries";
import { Wordmark } from "@/components/brand";
import { Sidebar } from "@/components/app-shell/sidebar";
import { AppChrome } from "@/components/app-shell/app-chrome";
import { BalancePill } from "@/components/app-shell/balance-pill";
import { AuthMenu } from "@/components/app-shell/auth-menu";
import { ConnectButton } from "@/components/auth/connect-button";
import { initials } from "@/lib/utils";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The app shell is browseable without a wallet — visitors can read the lobby,
  // see how tables are set up, and spectate. Connection is only required to take
  // an action (host, join, take a seat), gated at those points.
  const user = await getCurrentUser();
  const balances = user ? await getUserBalances(user.id) : null;

  return (
    <AppChrome
      wordmark={<Wordmark href="/" />}
      sidebar={<Sidebar isAdmin={user?.role === "ADMIN"} />}
      headerRight={
        <div className="flex items-center gap-3 sm:gap-4">
          {user && balances ? (
            <>
              <BalancePill balances={balances} />
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatarUrl}
                  alt="Your profile"
                  className="h-9 w-9 rounded-full border border-white/12 object-cover"
                  title={user.displayName ?? user.email ?? "Account"}
                />
              ) : (
                <div
                  className="grid h-9 w-9 place-items-center rounded-full border border-white/12 bg-white/5 text-xs text-ivory"
                  title={user.displayName ?? user.email ?? "Account"}
                >
                  {initials(user.displayName ?? user.email)}
                </div>
              )}
              <AuthMenu />
            </>
          ) : (
            <ConnectButton label="Connect wallet" size="sm" />
          )}
        </div>
      }
    >
      {children}
    </AppChrome>
  );
}
