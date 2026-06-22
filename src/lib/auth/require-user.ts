/**
 * Server-side current-user resolution + guards for React Server Components and
 * route handlers. Upserts a User row on first sight of a Privy identity.
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isAdminEmail, isAdminWallet } from "@/lib/env";
import { shortAddress } from "@/lib/utils";
import { ensureReferralCode, attributeReferral } from "@/lib/referrals/referrals";
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

  const existing = await prisma.user.findUnique({
    where: { privyUserId: identity.privyUserId },
  });

  let user: User;
  if (!existing) {
    user = await prisma.user.create({
      data: {
        privyUserId: identity.privyUserId,
        email: identity.email,
        displayName,
        role: role ?? "USER",
      },
    });
    // First sign-in: assign a referral code, and attribute to a referrer if a
    // `ref` code was captured into the cookie by middleware.
    await ensureReferralCode(user.id);
    const refCode = cookies().get("velvet_ref")?.value;
    if (refCode) await attributeReferral(user.id, refCode);
  } else {
    user = await prisma.user.update({
      where: { privyUserId: identity.privyUserId },
      data: {
        ...(identity.email ? { email: identity.email } : {}),
        ...(role ? { role } : {}),
        // Only seed a default display name if the user has none yet — NEVER
        // overwrite a name the player chose (previously clobbered every login).
        ...(!existing.displayName && displayName ? { displayName } : {}),
      },
    });
    // Backfill a referral code for users created before referrals existed.
    if (!user.referralCode) await ensureReferralCode(user.id);
  }

  // Persist the linked Solana wallet(s) for cashier/withdrawal UX and audit.
  // Binding is IMMUTABLE: a wallet is never silently re-assigned to a different
  // user, since deposit attribution is by sender address — re-binding would let
  // one account hijack another's deposits.
  for (const address of identity.wallets) {
    const existing = await prisma.wallet.findUnique({
      where: { chain_address: { chain: "SOLANA", address } },
    });
    if (!existing) {
      await prisma.wallet.create({
        data: { userId: user.id, chain: "SOLANA", address, type: "EMBEDDED" },
      });
    } else if (existing.userId !== user.id) {
      console.warn(
        `[auth] wallet ${address} is already bound to another user; refusing to re-bind`,
      );
    }
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
