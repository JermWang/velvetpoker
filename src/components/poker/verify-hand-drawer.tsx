"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface VerifyResponse {
  proof: {
    algorithm: string;
    serverSeedHash: string;
    serverSeed: string | null;
    clientSeeds: string[];
    tableId: string;
    handId: string;
    deckHash: string;
  };
  result: { ok: boolean; reasons: string[] };
}

export function VerifyHandDrawer({ handId }: { handId: string | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<VerifyResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    if (!handId) return;
    setOpen(true);
    setLoading(true);
    const res = await fetch(`/api/hands/${handId}/verify`);
    setData(res.ok ? await res.json() : null);
    setLoading(false);
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={load} disabled={!handId}>
        Verify hand
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setOpen(false)}>
          <aside
            className="h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-charcoal-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl text-ivory">Verify hand</h2>
              <button onClick={() => setOpen(false)} className="text-ash hover:text-ivory">
                ✕
              </button>
            </div>

            {loading && <p className="mt-6 text-sm text-ash">Recomputing deck…</p>}

            {data && (
              <div className="mt-6 space-y-4 text-sm">
                <div className="flex items-center gap-2">
                  {data.result.ok ? (
                    <Badge tone="green">Verified fair</Badge>
                  ) : (
                    <Badge tone="red">Verification failed</Badge>
                  )}
                </div>
                {!data.result.ok && (
                  <ul className="list-disc pl-5 text-red-300">
                    {data.result.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}

                <Field label="Algorithm" value={data.proof.algorithm} />
                <Field label="Server seed hash (published before deal)" value={data.proof.serverSeedHash} mono />
                <Field
                  label="Server seed (revealed after hand)"
                  value={data.proof.serverSeed ?? "Not yet revealed"}
                  mono
                />
                <Field label="Deck hash" value={data.proof.deckHash} mono />
                <Field
                  label="Client seeds"
                  value={data.proof.clientSeeds.length ? data.proof.clientSeeds.join(", ") : "None submitted"}
                />

                <p className="pt-2 text-xs leading-relaxed text-ash/70">
                  The deck is derived from{" "}
                  <code className="text-ash">
                    serverSeed | tableId | handId | sortedClientSeeds
                  </code>{" "}
                  via the published algorithm. Confirm{" "}
                  <code className="text-ash">sha256(serverSeed)</code> equals the
                  pre-published hash, then recompute the deck to match the deck
                  hash.
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-ash">{label}</p>
      <p className={`mt-0.5 break-all ${mono ? "font-mono text-xs" : "text-sm"} text-ivory`}>
        {value}
      </p>
    </div>
  );
}
