"use client";

import { useEffect, useState } from "react";
import { authedFetch } from "@/lib/auth/privy-token";

interface Nft {
  id: string;
  name: string;
  image: string;
}

/**
 * Modal grid of the NFTs in the player's connected wallet. Picking one verifies
 * ownership on-chain (server-side) and sets it as their profile picture.
 */
export function NftPicker({
  onClose,
  onPicked,
}: {
  onClose: () => void;
  onPicked: (avatarUrl: string) => void;
}) {
  const [nfts, setNfts] = useState<Nft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authedFetch("/api/wallet/nfts");
        const json = (await res.json()) as { nfts?: Nft[]; error?: string };
        if (!alive) return;
        if (!res.ok) {
          setError(json.error ?? "Couldn't load your NFTs");
          setNfts([]);
          return;
        }
        setNfts(json.nfts ?? []);
        if (json.error) setError(json.error);
      } catch {
        if (alive) {
          setError("Couldn't load your NFTs");
          setNfts([]);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function choose(nft: Nft) {
    setSaving(nft.id);
    setError(null);
    try {
      const res = await authedFetch("/api/account/avatar/nft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: nft.id }),
      });
      const json = (await res.json()) as { avatarUrl?: string; error?: string };
      if (!res.ok || !json.avatarUrl) {
        throw new Error(json.error ?? "Couldn't set that NFT");
      }
      onPicked(json.avatarUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't set that NFT");
      setSaving(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-charcoal-900 p-5 shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg text-ivory">Choose an NFT</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-full text-ash hover:text-ivory"
          >
            ✕
          </button>
        </div>
        {error && <p className="mb-3 text-sm text-amber-300">{error}</p>}
        {nfts === null ? (
          <p className="py-10 text-center text-sm text-ash">Loading your NFTs…</p>
        ) : nfts.length === 0 ? (
          <p className="py-10 text-center text-sm text-ash">
            No NFTs found in your connected wallet.
          </p>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
            {nfts.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => choose(n)}
                disabled={saving != null}
                title={n.name}
                className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 transition-colors hover:border-velvet disabled:opacity-50"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={n.image}
                  alt={n.name}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                {saving === n.id && (
                  <div className="absolute inset-0 grid place-items-center bg-black/65 text-xs text-ivory">
                    Setting…
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
