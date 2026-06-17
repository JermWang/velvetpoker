export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="text-ash/70">
        <strong>Draft / placeholder.</strong> This document is a scaffold for
        development and is not legal advice. Replace with counsel-reviewed terms
        before any production launch.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        Real-money play is available only to adults of legal age in
        jurisdictions where such play is permitted, subject to identity
        verification and geographic eligibility checks. We make no
        representation that the service is lawful in your location.
      </p>

      <h2>2. Accounts &amp; custody</h2>
      <p>
        Balances are held custodially and recorded in an internal double-entry
        ledger. On-chain settlement occurs for deposits and withdrawals. You are
        responsible for safeguarding access to your authentication method.
      </p>

      <h2>3. Game integrity</h2>
      <p>
        Gameplay is server-authoritative. Each hand uses a commit-reveal shuffle
        whose proof you may independently verify. Collusion, multi-accounting,
        and use of prohibited assistance are grounds for suspension and
        forfeiture under applicable law.
      </p>

      <h2>4. Withdrawals &amp; review</h2>
      <p>
        Withdrawals may be subject to risk and compliance review, including
        manual approval above defined thresholds. Funds locked at a table or in
        a pending withdrawal are not available for transfer.
      </p>

      <h2>5. Responsible gaming</h2>
      <p>
        Tools including deposit limits and self-exclusion are available. See our
        Responsible Gaming policy.
      </p>

      <h2>6. Limitation of liability</h2>
      <p>Placeholder. To be completed with legal counsel.</p>
    </>
  );
}
