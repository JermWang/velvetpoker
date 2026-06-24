"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { authedFetch } from "@/lib/auth/privy-token";

type Action =
  | { action: "verifyAge" }
  | { action: "startKyc"; country?: string }
  | { action: "setDepositLimit"; amount: string }
  | { action: "selfExclude"; days: number }
  | { action: "setDisplayName"; name: string };

export function AccountActions() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [country, setCountry] = useState("US");
  const [limit, setLimit] = useState("5");

  async function call(body: Action) {
    setBusy(body.action);
    await authedFetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="country">Country (ISO-2)</Label>
          <Input id="country" value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} className="w-24" />
        </div>
        <Button
          disabled={busy !== null}
          onClick={() => call({ action: "startKyc", country })}
        >
          {busy === "startKyc" ? "Checking…" : "Verify location"}
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => call({ action: "verifyAge" })}
        >
          Confirm I am of legal age
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="limit">Daily deposit limit (SOL)</Label>
          <Input id="limit" value={limit} onChange={(e) => setLimit(e.target.value)} className="w-32" />
        </div>
        <Button
          variant="secondary"
          disabled={busy !== null}
          onClick={() => call({ action: "setDepositLimit", amount: limit })}
        >
          Set limit
        </Button>
      </div>

      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
        <p className="text-sm font-medium text-ivory">Self-exclude</p>
        <p className="mt-1 text-xs text-ash">
          Take a break from real-money play. You can still withdraw existing
          funds.
        </p>
        <div className="mt-3 flex gap-2">
          <Button variant="danger" disabled={busy !== null} onClick={() => call({ action: "selfExclude", days: 30 })}>
            30 days
          </Button>
          <Button variant="danger" disabled={busy !== null} onClick={() => call({ action: "selfExclude", days: 365 })}>
            1 year
          </Button>
        </div>
      </div>
    </div>
  );
}
