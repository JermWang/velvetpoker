import Link from "next/link";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/require-user";
import { Wordmark } from "@/components/brand";
import { DevSignIn } from "@/components/auth/dev-signin";
import { WalletSignIn } from "@/components/auth/wallet-signin";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const existing = await getCurrentUser();
  if (existing) redirect("/app");

  const privyConfigured = Boolean(env.privyAppId && env.privyAppSecret);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Wordmark />
        </div>
        <div className="card-surface p-8">
          <h1 className="font-display text-2xl text-ivory">Connect to play</h1>
          <p className="mt-2 text-sm text-ash">
            Velvet is wallet-only. Connect a Solana wallet to enter your private
            poker room.
          </p>

          {privyConfigured ? <WalletSignIn /> : <DevSignIn />}
        </div>
        <p className="mt-6 text-center text-xs text-ash/60">
          By continuing you agree to our{" "}
          <Link href="/legal/terms" className="text-velvet">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/responsible-gaming" className="text-velvet">
            Responsible Gaming
          </Link>{" "}
          policy.
        </p>
      </div>
    </div>
  );
}
