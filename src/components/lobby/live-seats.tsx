"use client";

import { useEffect, useState } from "react";

/** ws:// → http:// , wss:// → https:// (the occupancy endpoint shares the port). */
function occupancyUrl(): string | null {
  const ws = process.env.NEXT_PUBLIC_WS_URL ?? "";
  if (!ws) return null;
  return ws.replace(/^ws/, "http") + "/occupancy";
}

/**
 * Live seat-occupancy strip for a lobby card. Polls the ws server's /occupancy
 * snapshot so the count reflects who's actually seated right now — including the
 * free/demo table, whose seats live only in the ws process's memory (no DB rows
 * the lobby's server render could ever see). Seeds from the server-rendered
 * count, then self-updates.
 */
export function LiveSeats({
  tableId,
  maxSeats,
  initialOccupied,
}: {
  tableId: string;
  maxSeats: number;
  initialOccupied: number;
}) {
  const [occupied, setOccupied] = useState(initialOccupied);

  useEffect(() => {
    const url = occupancyUrl();
    if (!url) return;
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as Record<string, number>;
        if (!active || !json || typeof json !== "object") return;
        // A table absent from the snapshot has no live room → no one seated.
        setOccupied(Math.max(0, Math.min(maxSeats, json[tableId] ?? 0)));
      } catch {
        /* transient network blip — keep the last known count */
      }
    };

    poll();
    const id = setInterval(poll, 4000);
    const onVis = () => {
      if (!document.hidden) poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [tableId, maxSeats]);

  const seats = Array.from({ length: maxSeats }, (_, i) => i < occupied);

  return (
    <div className="relative mt-5">
      <div className="flex items-center justify-between text-[11px] text-ash">
        <span className="uppercase tracking-[0.2em]">Seats</span>
        <span className="font-mono text-ivory">
          {occupied}/{maxSeats}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {seats.map((filled, i) => (
          <span
            key={i}
            title={filled ? "Seat taken" : "Open seat"}
            className={`h-5 w-5 rounded-full border ${
              filled
                ? "border-velvet bg-velvet shadow-[0_0_8px_rgba(143,29,44,0.55)]"
                : "border-white/25 bg-transparent"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
