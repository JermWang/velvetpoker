import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const faqs = [
  {
    q: "How are my funds held?",
    a: "Balances are custodial and recorded in an internal double-entry ledger. Deposits and withdrawals settle on Solana. Funds at a table are locked in the ledger until you cash out.",
  },
  {
    q: "How do I know hands are fair?",
    a: "Each hand uses a commit-reveal shuffle. The server publishes a hash before dealing and reveals the seed afterward, so you can recompute and verify the deck. Use ‘Verify hand’ at any table.",
  },
  {
    q: "Why is my withdrawal under review?",
    a: "Withdrawals above a threshold, or that trigger risk checks, are reviewed by our team before sending. Funds remain locked and accounted for during review.",
  },
  {
    q: "Can I take a break?",
    a: "Yes. Set deposit limits or self-exclude from your Account page at any time.",
  },
];

export default async function SupportPage() {
  await requireUser();
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-eyebrow">We&apos;re here to help</p>
        <h1 className="mt-2 font-display text-3xl text-ivory">Support</h1>
      </div>

      <div className="space-y-3">
        {faqs.map((f) => (
          <Card key={f.q}>
            <CardContent className="py-5">
              <h3 className="text-sm font-medium text-ivory">{f.q}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ash">{f.a}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-sm text-ash">
        Need more help? Review our{" "}
        <Link href="/legal/rules" className="text-velvet">
          game rules
        </Link>{" "}
        and{" "}
        <Link href="/legal/responsible-gaming" className="text-velvet">
          responsible gaming
        </Link>{" "}
        resources.
      </p>
    </div>
  );
}
