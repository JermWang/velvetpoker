"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ConnectButton } from "@/components/auth/connect-button";

export function HostTableForm({ authed }: { authed: boolean }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asset, setAsset] = useState("SOL");
  const [visibility, setVisibility] = useState("PUBLIC");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      name: String(form.get("name") ?? ""),
      asset,
      maxSeats: Number(form.get("maxSeats")),
      smallBlind: String(form.get("smallBlind") ?? ""),
      bigBlind: String(form.get("bigBlind") ?? ""),
      minBuyIn: String(form.get("minBuyIn") ?? ""),
      maxBuyIn: String(form.get("maxBuyIn") ?? ""),
      visibility,
      password: String(form.get("password") ?? "") || undefined,
      actionTimeoutSeconds: Number(form.get("actionTimeoutSeconds") ?? 30),
      spectatorsAllowed: form.get("spectatorsAllowed") === "on",
    };

    const res = await fetch("/api/tables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(json.error ?? "Could not create the table");
      return;
    }
    router.push(`/app/tables/${json.id}`);
  }

  return (
    <Card>
      <CardContent className="py-6">
        <form onSubmit={onSubmit} className="space-y-6">
          <div>
            <Label htmlFor="name">Table name</Label>
            <Input id="name" name="name" placeholder="The Velvet Room" required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="asset">Asset</Label>
              <Select
                id="asset"
                name="asset"
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
              >
                <option value="SOL">SOL</option>
                <option value="USDC">USDC</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="maxSeats">Table size</Label>
              <Select id="maxSeats" name="maxSeats" defaultValue="6">
                <option value="2">Heads-up (2 max)</option>
                <option value="6">6-max</option>
                <option value="9">9-max</option>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="smallBlind">Small blind</Label>
              <Input id="smallBlind" name="smallBlind" placeholder="0.01" required />
            </div>
            <div>
              <Label htmlFor="bigBlind">Big blind</Label>
              <Input id="bigBlind" name="bigBlind" placeholder="0.02" required />
            </div>
            <div>
              <Label htmlFor="minBuyIn">Min buy-in</Label>
              <Input id="minBuyIn" name="minBuyIn" placeholder="1" required />
            </div>
            <div>
              <Label htmlFor="maxBuyIn">Max buy-in</Label>
              <Input id="maxBuyIn" name="maxBuyIn" placeholder="4" required />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="visibility">Visibility</Label>
              <Select
                id="visibility"
                name="visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value)}
              >
                <option value="PUBLIC">Public — listed in the lobby</option>
                <option value="PRIVATE">Private — invite only</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="actionTimeoutSeconds">Action timer (seconds)</Label>
              <Input
                id="actionTimeoutSeconds"
                name="actionTimeoutSeconds"
                type="number"
                defaultValue={30}
                min={10}
                max={120}
              />
            </div>
          </div>

          {visibility === "PRIVATE" && (
            <div>
              <Label htmlFor="password">Optional password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="Leave blank for link-only access"
              />
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-ash">
            <input type="checkbox" name="spectatorsAllowed" defaultChecked />
            Allow spectators
          </label>

          <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4 text-xs text-ash">
            As host you set the stakes and seating. You do not control the deck,
            RNG, payouts, pot logic, balances, or rake — all are enforced by the
            server.
          </div>

          {error && <p className="text-sm text-red-300">{error}</p>}

          {authed ? (
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create table"}
            </Button>
          ) : (
            <div className="space-y-2">
              <ConnectButton label="Connect wallet to host" />
              <p className="text-xs text-ash/70">
                Set everything up first — you only need to connect to create the
                table.
              </p>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
