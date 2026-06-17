import Link from "next/link";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { CardFan } from "@/components/marketing/card-fan";

export default function StartScreen() {
  return (
    <div className="relative isolate flex min-h-screen flex-col items-center justify-between px-6 py-8">
      {/* Landing bloom — a soft warm glow that lifts the centerpiece a touch
          brighter than the global ambient. Landing-only, sits behind content. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div
          className="absolute left-1/2 top-[42%] h-[88vh] w-[88vh] max-w-[1040px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(243,236,221,0.13), rgba(243,236,221,0.05) 46%, transparent 72%)",
            filter: "blur(40px)",
          }}
        />
        <div
          className="absolute left-1/2 top-[40%] h-[44vh] w-[44vh] max-w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(176,58,72,0.10), transparent 70%)",
            filter: "blur(28px)",
          }}
        />
      </div>

      {/* Brand mark */}
      <header className="relative z-10 flex w-full max-w-6xl items-center justify-center pt-2 animate-fade-up">
        <Image
          src="/velvet-poker-chip.png"
          alt="Velvet Poker"
          width={48}
          height={48}
          className="h-11 w-11 drop-shadow-[0_3px_12px_rgba(143,29,44,0.38)]"
          priority
        />
      </header>

      {/* Centerpiece */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center text-center">
        <div className="animate-fade-up">
          <CardFan />
        </div>

        <p
          className="mt-2 text-eyebrow animate-fade-up"
          style={{ animationDelay: "80ms" }}
        >
          Private cardroom · Solana
        </p>

        <h1
          className="mt-3 font-display text-6xl leading-none tracking-tight text-ivory md:text-8xl animate-fade-up"
          style={{ animationDelay: "140ms" }}
        >
          Velvet<span className="text-gold">.</span>
        </h1>

        <p
          className="mt-5 max-w-md text-lg leading-relaxed text-ash animate-fade-up"
          style={{ animationDelay: "220ms" }}
        >
          Real-money poker for the few who play it right.
        </p>

        <div
          className="mt-9 flex flex-col items-center gap-3 animate-fade-up sm:flex-row"
          style={{ animationDelay: "300ms" }}
        >
          <Link href="/app/lobby">
            <Button size="lg" className="min-w-[15rem] tracking-wide">
              Enter Lobby
            </Button>
          </Link>
          <Link href="/app/host">
            <Button size="lg" variant="ghost" className="tracking-wide">
              Host a private table
            </Button>
          </Link>
        </div>

        <div
          className="mt-10 flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-ash/60 animate-fade-up"
          style={{ animationDelay: "380ms" }}
        >
          <span>Provably fair</span>
          <span className="text-gold/40">◆</span>
          <span>Instant settlement</span>
          <span className="text-gold/40">◆</span>
          <span>Invite-only tables</span>
        </div>
      </main>

      {/* Slim compliance footer */}
      <footer className="relative z-10 flex w-full max-w-6xl flex-col items-center gap-2 pb-1 text-center">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-ash/70">
          <Link href="/legal/rules" className="hover:text-ivory">Game rules</Link>
          <Link href="/legal/responsible-gaming" className="hover:text-ivory">Responsible play</Link>
          <Link href="/legal/terms" className="hover:text-ivory">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-ivory">Privacy</Link>
        </div>
        <p className="text-[11px] text-ash/40">
          18+ where permitted. Real-money play subject to geographic
          eligibility.
        </p>
      </footer>
    </div>
  );
}
