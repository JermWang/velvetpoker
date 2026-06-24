"use client";

import { useEffect, type ReactNode } from "react";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import {
  toSolanaWalletConnectors,
  useWallets,
  useSignAndSendTransaction,
} from "@privy-io/react-auth/solana";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { PrivyConfiguredContext } from "./privy-context";
import { setTokenGetter, authedFetch } from "@/lib/auth/privy-token";
import { setWalletDepositor } from "@/lib/solana/wallet-deposit";

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
 * Registers the connected wallet's "deposit SOL to the treasury" action via the
 * SSR-safe bridge, so the poker table can pull a buy-in straight from the wallet
 * (Phantom popup) without the rest of the app importing the Privy SDK.
 */
function DepositBridge() {
  const { wallets } = useWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  useEffect(() => {
    setWalletDepositor(async (lamports: bigint) => {
      const wallet = wallets[0];
      if (!wallet) throw new Error("Connect your wallet to deposit");
      const res = await authedFetch("/api/solana/deposit-prep");
      const prep = (await res.json()) as {
        treasury?: string;
        blockhash?: string;
        error?: string;
      };
      if (!res.ok || !prep.treasury || !prep.blockhash) {
        throw new Error(prep.error ?? "Could not prepare deposit");
      }
      const tx = new Transaction({
        feePayer: new PublicKey(wallet.address),
        recentBlockhash: prep.blockhash,
      });
      tx.add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(wallet.address),
          toPubkey: new PublicKey(prep.treasury),
          lamports,
        }),
      );
      const serialized = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      const { signature } = await signAndSendTransaction({
        transaction: new Uint8Array(serialized),
        wallet,
      });
      return { signature: bs58.encode(signature) };
    });
    return () => setWalletDepositor(null);
  }, [wallets, signAndSendTransaction]);
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
        <DepositBridge />
        {children}
      </PrivyProvider>
    </PrivyConfiguredContext.Provider>
  );
}
