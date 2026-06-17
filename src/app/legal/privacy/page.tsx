export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="text-ash/70">
        <strong>Draft / placeholder.</strong> Replace with a counsel-reviewed
        policy before production.
      </p>

      <h2>Information we process</h2>
      <ul>
        <li>Account identifiers from your authentication provider (Privy).</li>
        <li>Identity verification (KYC) status and results from our providers.</li>
        <li>Geolocation signals used for eligibility (geofencing).</li>
        <li>Wallet addresses, deposits, withdrawals, and ledger history.</li>
        <li>Gameplay data: hands, actions, and results.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        To operate the service, meet legal and regulatory obligations, prevent
        fraud and collusion, and provide responsible-gaming protections.
      </p>

      <h2>Sharing</h2>
      <p>
        With compliance, payments, and infrastructure providers acting on our
        behalf, and where required by law.
      </p>

      <h2>Your choices</h2>
      <p>
        You may request access or deletion subject to legal retention
        requirements. Self-exclusion and limit tools are available in your
        account.
      </p>
    </>
  );
}
