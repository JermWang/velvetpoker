import Link from "next/link";
import { APP_NAME_FULL } from "@/components/brand";

const legal = [
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/responsible-gaming", label: "Responsible Gaming" },
  { href: "/legal/rules", label: "Game Rules" },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-white/8 bg-charcoal-900/60">
      <div className="container-page py-12">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md">
            <p className="font-display text-lg text-ivory">
              {APP_NAME_FULL}
              <span className="text-velvet">.</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ash">
              A private real-money poker room on Solana. Play responsibly. Games
              involve financial risk and are intended for adults of legal age in
              eligible jurisdictions only.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-8 gap-y-3">
            {legal.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="text-sm text-ash transition-colors hover:text-ivory"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="mt-10 space-y-2 border-t border-white/8 pt-6 text-xs leading-relaxed text-ash/70">
          <p>
            Real-money gaming is restricted by jurisdiction. Availability is
            subject to geographic eligibility and applicable law. {APP_NAME_FULL}{" "}
            does not represent that its services are lawful in every
            jurisdiction.
          </p>
          <p>
            If gambling stops being fun, take a break. Set deposit limits or
            self-exclude at any time from your account settings.
          </p>
          <p className="text-ash/50">
            © {new Date().getFullYear()} {APP_NAME_FULL}. Internal placeholder
            brand — not for public distribution.
          </p>
        </div>
      </div>
    </footer>
  );
}
