"use client";

import dynamic from "next/dynamic";
import { usePrivyConfigured } from "@/components/providers";
import { Button } from "@/components/ui/button";

// Privy SDK isolated behind a client-only dynamic import (keeps this module's
// client reference clean for server-rendered pages like /signin).
const WalletSignInInner = dynamic(() => import("./wallet-signin-inner"), {
  ssr: false,
});

/** Wallet-only sign-in via Privy (Solana). */
export function WalletSignIn() {
  const configured = usePrivyConfigured();

  if (!configured) {
    return (
      <div className="mt-6 space-y-4">
        <Button className="w-full" size="lg" disabled>
          Loading…
        </Button>
        <p className="text-center text-xs text-ash/70">
          Connecting to your wallet…
        </p>
      </div>
    );
  }
  return <WalletSignInInner />;
}
