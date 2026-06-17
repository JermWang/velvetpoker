"use client";

import { createContext, useContext } from "react";

/**
 * Whether Privy is actually configured + mounted. Lives in its own module (no
 * Privy imports) so both `providers.tsx` and the dynamically-loaded Privy tree
 * can share it without dragging the heavy Privy SDK into either's import graph.
 */
export const PrivyConfiguredContext = createContext(false);

export function usePrivyConfigured() {
  return useContext(PrivyConfiguredContext);
}
