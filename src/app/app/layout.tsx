import { getCurrentUser } from "@/lib/auth/require-user";
import { Wordmark } from "@/components/brand";
import { Sidebar } from "@/components/app-shell/sidebar";
import { AppChrome } from "@/components/app-shell/app-chrome";
import { WalletBalancePill } from "@/components/app-shell/wallet-balance-pill";
import { AccountMenu } from "@/components/app-shell/account-menu";
import { ConnectButton } from "@/components/auth/connect-button";
import { ContractAddressChip } from "@/components/app-shell/contract-address";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The app shell is browseable without a wallet — visitors can read the lobby,
  // see how tables are set up, and spectate. Connection is only required to take
  // an action (host, join, take a seat), gated at those points.
  const user = await getCurrentUser();

  return (
    <AppChrome
      wordmark={<Wordmark href="/" />}
      sidebar={<Sidebar />}
      headerRight={
        <div className="flex items-center gap-3 sm:gap-4">
          {/* Token CA — desktop nav. Hidden on phones (the lobby bar + the menu
              drawer carry it there) so the header never clusters. */}
          <div className="hidden md:block">
            <ContractAddressChip compact />
          </div>
          {user ? (
            <>
              <WalletBalancePill />
              <AccountMenu
                avatarUrl={user.avatarUrl}
                displayName={user.displayName}
                email={user.email}
              />
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
