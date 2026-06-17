"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";

/**
 * The Privy-using half of wallet sign-in. Imported ONLY via dynamic(ssr:false)
 * so the Privy SDK never enters the server render graph (which would corrupt the
 * client reference and 500 the page).
 */
export default function WalletSignInInner() {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) {
      router.replace("/app");
      router.refresh();
    }
  }, [ready, authenticated, router]);

  return (
    <div className="mt-6 space-y-4">
      <Button
        className="w-full"
        size="lg"
        disabled={!ready || authenticated}
        onClick={() => login()}
      >
        {!ready ? "Loading…" : authenticated ? "Entering…" : "Connect Solana wallet"}
      </Button>
      <p className="text-center text-xs text-ash/70">
        Phantom, Solflare, and Backpack supported.
      </p>
    </div>
  );
}
