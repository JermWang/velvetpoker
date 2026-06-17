"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { PrivyConfiguredContext } from "./privy-context";

// Re-exported for existing imports (`@/components/providers`).
export { PrivyConfiguredContext, usePrivyConfigured } from "./privy-context";

// The Privy SDK is isolated behind a client-only dynamic import so it never
// enters the SSR / prerender graph. `providers.tsx` itself imports NO Privy code,
// keeping its client reference clean for the server root layout.
const PrivyTree = dynamic(() => import("./privy-tree"), { ssr: false });

export function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // SSR / first paint: render children directly (no Privy). After hydration,
  // mount the Privy tree client-side.
  if (!appId || !mounted) {
    return (
      <PrivyConfiguredContext.Provider value={false}>
        {children}
      </PrivyConfiguredContext.Provider>
    );
  }

  return <PrivyTree appId={appId}>{children}</PrivyTree>;
}
