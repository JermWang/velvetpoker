import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { TableCard, type TableCardData } from "@/components/lobby/table-card";
import { JoinPrivate } from "@/components/lobby/join-private";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

// Public — no wallet required to browse the lobby or open a table to spectate.
export default async function LobbyPage() {
  const tables = await prisma.pokerTable.findMany({
    where: { visibility: "PUBLIC", status: { in: ["WAITING", "ACTIVE"] } },
    // Free-play demo first, then live games, then newest.
    orderBy: [{ isDemo: "desc" }, { status: "asc" }, { createdAt: "desc" }],
    include: { seats: { where: { status: { not: "EMPTY" } } } },
  });

  const data: TableCardData[] = tables.map((t) => ({
    id: t.id,
    name: t.name,
    asset: t.asset,
    smallBlind: t.smallBlind,
    bigBlind: t.bigBlind,
    minBuyIn: t.minBuyIn,
    maxBuyIn: t.maxBuyIn,
    maxSeats: t.maxSeats,
    seatsOccupied: t.seats.length,
    visibility: t.visibility,
    status: t.status,
    isDemo: t.isDemo,
  }));

  return (
    <div className="space-y-10 py-2">
      {/* Private-room banner — the house specialty. */}
      <div className="glass glass-gold relative overflow-hidden p-7">
        <div className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-gold/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="max-w-lg">
            <p className="text-eyebrow">Invite-only</p>
            <h1 className="mt-2 font-display text-3xl text-ivory">
              The best games are private
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ash">
              Host your own table in seconds, or drop in with an invite code.
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-3">
            <Link href="/app/host">
              <Button size="lg" className="w-full tracking-wide">
                Host a private table
              </Button>
            </Link>
            <JoinPrivate />
          </div>
        </div>
      </div>

      {/* Public lobby list */}
      <div>
        <div className="mb-5 flex items-end justify-between">
          <div>
            <p className="text-eyebrow">Open to all</p>
            <h2 className="mt-1 font-display text-2xl text-ivory">Public tables</h2>
          </div>
          <span className="text-sm text-ash">
            {data.length} {data.length === 1 ? "game" : "games"} running
          </span>
        </div>

        {data.length === 0 ? (
          <div className="glass p-12 text-center">
            <p className="text-ash">No public tables are running right now.</p>
            <Link href="/app/host" className="mt-4 inline-block">
              <Button>Be the first to host</Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.map((t) => (
              <TableCard key={t.id} table={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
