import { getCurrentUser } from "@/lib/auth/require-user";
import { HostTableForm } from "@/components/host/host-table-form";
import { env, isTokenConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

// Public — anyone can explore how a table is configured; connection is only
// required to actually create it (gated on the form's submit).
export default async function HostPage() {
  const user = await getCurrentUser();
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <p className="text-eyebrow">Create a cash game</p>
        <h1 className="mt-2 font-display text-3xl text-ivory">Host a table</h1>
        <p className="mt-2 text-sm text-ash">
          Configure your game. Public tables appear in the lobby; private tables
          are reachable by invite link or code.
        </p>
      </div>
      <HostTableForm
        authed={Boolean(user)}
        tokenConfigured={isTokenConfigured()}
        tokenSymbol={env.tokenSymbol}
      />
    </div>
  );
}
