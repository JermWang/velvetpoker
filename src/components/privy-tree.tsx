"use client";

import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import { PrivyConfiguredContext } from "./privy-context";

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
            walletList: [
              "detected_solana_wallets",
              "phantom",
              "solflare",
              "backpack",
              "jupiter",
            ],
          },
          externalWallets: {
            solana: {
              connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }),
            },
          },
        }}
      >
        {children}
      </PrivyProvider>
    </PrivyConfiguredContext.Provider>
  );
}
