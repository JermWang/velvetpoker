"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/auth/privy-token";

/** Enter a private-table invite code and jump straight to the room. */
export function JoinPrivate() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    const res = await authedFetch(`/api/tables/by-code?code=${encodeURIComponent(code.trim())}`);
    const json = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(json.error ?? "Could not find that table");
      return;
    }
    router.push(`/app/tables/${json.id}`);
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm items-center gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Private invite code"
        className="h-10 flex-1 rounded-xl border border-white/12 bg-charcoal-900/60 px-3 text-sm text-ivory placeholder:text-ash/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-velvet/50"
        aria-label="Invite code"
      />
      <Button type="submit" variant="secondary" disabled={busy}>
        {busy ? "…" : "Join"}
      </Button>
      {error && (
        <span className="absolute mt-12 text-xs text-red-300">{error}</span>
      )}
    </form>
  );
}
