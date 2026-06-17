/**
 * Server-side current-user resolution + guards for React Server Components and
 * route handlers. Upserts a User row on first sight of a Privy identity.
 */

import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isAdminEmail, isAdminWallet } from "@/lib/env";
import { shortAddress } from "@/lib/utils";
import { getSessionIdentity } from "./session";

/** Returns the current User (creating it on first login) or null. */
export async function getCurrentUser(): Promise<User | null> {
  const identity = await getSessionIdentity();
  if (!identity) return null;

  const primaryWallet = identity.wallets[0] ?? null;
  const isAdmin =
    isAdminEmail(identity.email) ||
    identity.wallets.some((w) => isAdminWallet(w));
  const role = isAdmin ? "ADMIN" : undefined;
  const displayName = primaryWallet ? shortAddress(primaryWallet) : undefined;

  const user = await prisma.user.upsert({
    where: { privyUserId: identity.privyUserId },
    create: {
      privyUserId: identity.privyUserId,
      email: identity.email,
      displayName,
      role: role ?? "USER",
    },
    update: {
      ...(identity.email ? { email: identity.email } : {}),
      ...(role ? { role } : {}),
      ...(displayName ? { displayName } : {}),
    },
  });

  // Persist the linked Solana wallet(s) for cashier/withdrawal UX and audit.
  for (const address of identity.wallets) {
    await prisma.wallet.upsert({
      where: { chain_address: { chain: "SOLANA", address } },
      create: {
        userId: user.id,
        chain: "SOLANA",
        address,
        type: "EMBEDDED",
      },
      update: { userId: user.id },
    });
  }

  return user;
}

/** Require a signed-in user; redirect to landing if absent. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.status === "BLOCKED") redirect("/blocked");
  return user;
}
