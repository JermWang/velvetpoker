"use client";

/**
 * SSR-safe bridge to the connected wallet's "deposit SOL" action, WITHOUT
 * importing the Privy SDK here (the SDK is isolated behind the ssr:false Privy
 * tree — importing it elsewhere breaks the prerender build). The Privy tree
 * registers the real implementation at runtime via setWalletDepositor();
 * everything else (e.g. the poker table) calls through depositSolFromWallet().
 *
 * Mirrors the token-getter bridge in privy-token.ts.
 */

export type WalletDepositResult = { signature: string };
export type WalletDepositor = (lamports: bigint) => Promise<WalletDepositResult>;

let depositor: WalletDepositor | null = null;

/** Called by the Privy tree (client-only) to expose its signing-backed depositor. */
export function setWalletDepositor(fn: WalletDepositor | null): void {
  depositor = fn;
}

/** Whether an in-app wallet deposit is currently available (wallet connected). */
export function canDepositFromWallet(): boolean {
  return depositor != null;
}

/**
 * Sign + send a SOL transfer of `lamports` from the connected wallet to the
 * treasury. Resolves with the on-chain signature (base58). Throws if no wallet
 * is connected or the user rejects the signature.
 */
export async function depositSolFromWallet(
  lamports: bigint,
): Promise<WalletDepositResult> {
  if (!depositor) throw new Error("Connect your wallet to deposit");
  return depositor(lamports);
}
