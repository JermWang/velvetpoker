import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/require-user";
import { prisma } from "@/lib/db/prisma";
import { evaluateRealMoneyGates } from "@/lib/compliance/gates";
import { ComplianceGateCard } from "@/components/app-shell/compliance-gate-card";

export const dynamic = "force-dynamic";

export default async function AppHome() {
  const user = await getCurrentUser();
  const [openTables] = await Promise.all([
    prisma.pokerTable.count({ where: { status: { in: ["WAITING", "ACTIVE"] } } }),
  ]);
  const cleared = user ? evaluateRealMoneyGates(user).allowed : false;

  return (
    <div className="mx-auto max-w-4xl space-y-8 py-4">
      <div className="text-center">
        <p className="text-eyebrow">Good to see you</p>
        <h1 className="mt-2 font-display text-4xl text-ivory md:text-5xl">
          Where to tonight?
        </h1>
      </div>

      {user && !cleared && <ComplianceGateCard user={user} />}

      {/* Primary: private tables — the house specialty. */}
      <Link href="/app/host" className="block">
        <div className="glass glass-velvet glass-hover relative overflow-hidden p-8">
          <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-velvet/10 blur-3xl" />
          <p className="text-eyebrow">The house specialty</p>
          <h2 className="mt-2 font-display text-3xl text-ivory">
            Host a private table
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-ash">
            Your stakes, your seats, invite-only. Spin up an elegant cash game in
            seconds and share a single link with your circle.
          </p>
          <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-velvet">
            Open the host room
            <span aria-hidden>→</span>
          </span>
        </div>
      </Link>

      {/* Secondary destinations */}
      <div className="grid gap-4 sm:grid-cols-2">
        <EntranceCard
          href="/app/lobby"
          eyebrow="Public games"
          title="Browse the lobby"
          body="Take a seat at an open public cash game."
          meta={`${openTables} ${openTables === 1 ? "table" : "tables"} live`}
        />
        <EntranceCard
          href="/app/cashier"
          eyebrow="Custody"
          title="Cashier"
          body="Deposit, withdraw, and review your balances."
          meta="SOL · USDC"
        />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-ash">
        <Link href="/app/history" className="hover:text-ivory">Hand &amp; ledger history</Link>
        <span className="text-velvet/30">◆</span>
        <Link href="/app/account" className="hover:text-ivory">Account &amp; limits</Link>
        <span className="text-velvet/30">◆</span>
        <Link href="/app/support" className="hover:text-ivory">Support</Link>
      </div>
    </div>
  );
}

function EntranceCard({
  href,
  eyebrow,
  title,
  body,
  meta,
}: {
  href: string;
  eyebrow: string;
  title: string;
  body: string;
  meta: string;
}) {
  return (
    <Link href={href} className="block">
      <div className="glass glass-hover flex h-full flex-col p-6">
        <p className="text-eyebrow">{eyebrow}</p>
        <h3 className="mt-1.5 font-display text-2xl text-ivory">{title}</h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-ash">{body}</p>
        <span className="mt-4 font-mono text-xs text-velvet/80">{meta}</span>
      </div>
    </Link>
  );
}
