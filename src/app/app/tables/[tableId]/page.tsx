import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { env } from "@/lib/env";
import { canPlayRealMoney } from "@/lib/compliance/gates";
import { PokerTableView } from "@/components/poker/poker-table-view";
import { ComplianceGateCard } from "@/components/app-shell/compliance-gate-card";

export const dynamic = "force-dynamic";

export default async function TablePage({
  params,
}: {
  params: { tableId: string };
}) {
  const user = await requireUser();
  const table = await prisma.pokerTable.findUnique({
    where: { id: params.tableId },
  });
  if (!table || table.status === "CLOSED") notFound();

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

  // WS auth: when Privy is configured the `privy-token` cookie is sent on the
  // WebSocket handshake (same host), so no query auth is needed. Otherwise fall
  // back to the dev cookie in development.
  const privyConfigured = Boolean(env.privyAppId && env.privyAppSecret);
  const devEmail = cookies().get("velvet_dev_user")?.value;
  const authQuery = privyConfigured
    ? ""
    : !env.isProduction && devEmail
      ? `dev=${encodeURIComponent(devEmail)}`
      : "";

  return (
    <PokerTableView
      tableId={table.id}
      tableName={table.name}
      asset={table.asset}
      minBuyIn={table.minBuyIn.toString()}
      maxBuyIn={table.maxBuyIn.toString()}
      wsUrl={env.wsUrl}
      authQuery={authQuery}
      youUserId={user.id}
    />
  );
}
