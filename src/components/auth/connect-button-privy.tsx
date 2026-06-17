"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import type { ConnectButtonProps } from "./connect-button";

/**
 * Privy-using connect button. Loaded ONLY via dynamic(ssr:false) so the Privy
 * SDK never enters the server render graph. On successful connect it refreshes
 * the current route so server components re-read the now-present session cookie
 * (revealing balance, buy-in, etc. in place).
 */
export default function ConnectButtonPrivy({
  label = "Connect wallet",
  size = "md",
  variant = "primary",
  className,
}: ConnectButtonProps) {
  const { ready, authenticated, login } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.refresh();
  }, [ready, authenticated, router]);

  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      disabled={!ready}
      onClick={() => (authenticated ? router.refresh() : login())}
    >
      {!ready ? "Loading…" : label}
    </Button>
  );
}
