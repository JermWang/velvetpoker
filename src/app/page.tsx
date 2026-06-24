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
              "radial-gradient(closest-side, rgba(236,238,241,0.12), rgba(236,238,241,0.045) 46%, transparent 72%)",
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
          Velvet<span className="text-velvet">.</span>
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

      </main>

      {/* Footer — trust badges, legal links + socials, and the 18+ line grouped
          as ONE block so the three rows share one even vertical gap (the badges
          used to live in the hero, which made the middle row's spacing uneven). */}
      <footer className="relative z-10 flex w-full max-w-6xl flex-col items-center gap-3.5 pb-4 text-center">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11px] uppercase tracking-[0.22em] text-ash/60">
          <span>Verified RNG</span>
          <span className="text-velvet/40">◆</span>
          <span>Instant settlement</span>
          <span className="text-velvet/40">◆</span>
          <span>Invite-only tables</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-ash/70">
          <Link href="/legal/rules" className="hover:text-ivory">Game rules</Link>
          <Link href="/legal/responsible-gaming" className="hover:text-ivory">Responsible play</Link>
          <Link href="/legal/terms" className="hover:text-ivory">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-ivory">Privacy</Link>
          <span aria-hidden className="hidden h-3.5 w-px bg-white/15 sm:inline-block" />
          <a
            href="https://x.com/velvetpokerfun"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Velvet Poker on X"
            className="text-ash/70 transition-colors hover:text-ivory"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]" aria-hidden>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
          <a
            href="https://discord.gg/6Krs879gnS"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Velvet Poker on Discord"
            className="text-ash/70 transition-colors hover:text-ivory"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-[18px] w-[18px]" aria-hidden>
              <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
            </svg>
          </a>
        </div>
        <p className="text-[11px] text-ash/40">
          18+ where permitted. Real-money play subject to geographic eligibility.
        </p>
      </footer>
    </div>
  );
}
