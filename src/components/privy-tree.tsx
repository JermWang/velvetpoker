"use client";

import { useEffect, type ReactNode } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { PrivyConfiguredContext } from "./privy-context";
import { setTokenGetter } from "@/lib/auth/privy-token";

/**
 * Bridges Privy's getAccessToken out to the SSR-safe token module so authedFetch
 * (which must not import the Privy SDK) can attach a fresh Bearer token to API
 * requests. Renders nothing.
 */
function TokenBridge() {
  const { getAccessToken } = usePrivy();
  useEffect(() => {
    setTokenGetter(getAccessToken);
    return () => setTokenGetter(null);
  }, [getAccessToken]);
  return null;
}

/**
 * The actual Privy provider tree. This is the ONLY module that imports the Privy
 * SDK, and it is loaded via `dynamic(..., { ssr: false })` from providers.tsx —
 * so the Privy import graph (with its webpack-stubbed optional deps) never
 * enters SSR / static prerender, which previously rendered an undefined
 * component and broke the production build.
 */
export default function PrivyTree({
  appId,
  children,
}: {
  appId: string;
  children: ReactNode;
}) {
  return (
    <PrivyConfiguredContext.Provider value={true}>
      <PrivyProvider
        appId={appId}
        config={{
          loginMethods: ["wallet"],
          appearance: {
            theme: "dark",
            accentColor: "#8f1d2c",
            walletChainType: "solana-only",
            // Curated, Phantom-first list of the dominant Solana wallets. We do
            // NOT include "detected_solana_wallets" on purpose — that auto-surfaces
            // every installed wallet (Magic Eden, Leap, etc.), which we don't want.
            walletList: ["phantom", "solflare", "backpack"],
          },
          externalWallets: {
            solana: {
              connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }),
            },
          },
        }}
      >
        <TokenBridge />
        {children}
      </PrivyProvider>
    </PrivyConfiguredContext.Provider>
  );
}
