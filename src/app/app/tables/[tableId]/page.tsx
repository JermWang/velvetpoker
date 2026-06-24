import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { env, isLiveKitConfigured } from "@/lib/env";
import { canPlayRealMoney } from "@/lib/compliance/gates";
import { PokerTableView } from "@/components/poker/poker-table-view";
import { ComplianceGateCard } from "@/components/app-shell/compliance-gate-card";
import { ConnectButton } from "@/components/auth/connect-button";
import { signWsTicket } from "@/lib/realtime/ws-ticket";

export const dynamic = "force-dynamic";

export default async function TablePage({
  params,
}: {
  params: { tableId: string };
}) {
  const user = await getCurrentUser();
  const table = await prisma.pokerTable.findUnique({
    where: { id: params.tableId },
  });
  if (!table || table.status === "CLOSED") notFound();

  const voiceEnabled = isLiveKitConfigured();

  // WS auth for an authenticated user: the site (Vercel) and the ws server
  // (Railway) are on different hosts, so the auth cookie isn't sent on the
  // cross-origin handshake. We mint a short-lived signed ticket here (we hold
  // the verified session) and the ws verifies it — the Privy token never enters
  // a URL. Dev cookie fallback for local (Privy-unconfigured) only.
  const privyConfigured = Boolean(env.privyAppId && env.privyAppSecret);
  const devEmail = cookies().get("velvet_dev_user")?.value;
  const userAuthQuery = user
    ? privyConfigured
      ? `ticket=${encodeURIComponent(signWsTicket(user.id))}`
      : !env.isProduction && devEmail
        ? `dev=${encodeURIComponent(devEmail)}`
        : ""
    : "";

  // Free-play demo table: anyone plays for free — logged in or as a guest — with
  // no compliance gate and no real money. Guests get an ephemeral client-side id.
  if (table.isDemo) {
    const common = {
      tableId: table.id,
      tableName: table.name,
      asset: table.asset,
      minBuyIn: table.minBuyIn.toString(),
      maxBuyIn: table.maxBuyIn.toString(),
      wsUrl: env.wsUrl,
      demo: true as const,
    };
    return user ? (
      <PokerTableView
        {...common}
        authQuery={userAuthQuery}
        youUserId={user.id}
        voiceEnabled={voiceEnabled}
      />
    ) : (
      <PokerTableView {...common} authQuery="" youUserId={null} guestMode />
    );
  }

  // Visitors without a wallet may spectate (when the host allows it). They see
  // the live felt and public action but never take a seat or receive hole cards.
  if (!user) {
    if (!table.spectatorsAllowed) {
      return (
        <div className="mx-auto max-w-md space-y-5 py-10 text-center">
          <h1 className="font-display text-2xl text-ivory">{table.name}</h1>
          <p className="text-sm text-ash">
            This table isn&apos;t open to spectators. Connect your wallet to take
            a seat.
          </p>
          <div className="flex justify-center">
            <ConnectButton label="Connect wallet to join" size="lg" />
          </div>
          <Link href="/app/lobby" className="block text-xs text-ash hover:text-ivory">
            Back to the lobby
          </Link>
        </div>
      );
    }
    return (
      <PokerTableView
        tableId={table.id}
        tableName={table.name}
        asset={table.asset}
        minBuyIn={table.minBuyIn.toString()}
        maxBuyIn={table.maxBuyIn.toString()}
        wsUrl={env.wsUrl}
        authQuery="spectate=1"
        youUserId={null}
      />
    );
  }

  // Real-money gate: block sitting down (the view still loads for spectating).
  if (!canPlayRealMoney(user)) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="font-display text-2xl text-ivory">{table.name}</h1>
        <ComplianceGateCard user={user} />
        <p className="text-sm text-ash">
          You can take a seat once the checks above are complete.
        </p>
      </div>
    );
  }

  return (
    <PokerTableView
      tableId={table.id}
      tableName={table.name}
      asset={table.asset}
      minBuyIn={table.minBuyIn.toString()}
      maxBuyIn={table.maxBuyIn.toString()}
      wsUrl={env.wsUrl}
      authQuery={userAuthQuery}
      youUserId={user.id}
      requiresPassword={table.visibility === "PRIVATE" && Boolean(table.passwordHash)}
      inviteCode={table.visibility === "PRIVATE" ? table.inviteCode : null}
      voiceEnabled={voiceEnabled}
    />
  );
}
