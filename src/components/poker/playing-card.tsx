import { cn } from "@/lib/utils";
import type { Card as CardCode } from "@/lib/poker/types";

/**
 * Flat realistic playing card — the lightweight, server-renderable card used for
 * the table grid and opponents (the design keeps these flat). It shares the
 * ivory linen + editorial-serif face of <Card3D>, without 3D transforms.
 */

const SUIT_SYMBOL: Record<string, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };

function rankLabel(r: string): string {
  return r === "T" ? "10" : r;
}

const DIMS: Record<"sm" | "md" | "lg", { w: number; h: number; r: number; rank: number; pip: number; corner: number; pad: number }> = {
  sm: { w: 34, h: 48, r: 5, rank: 12, pip: 18, corner: 9, pad: 3 },
  md: { w: 44, h: 62, r: 6, rank: 15, pip: 24, corner: 11, pad: 4 },
  lg: { w: 60, h: 84, r: 8, rank: 20, pip: 34, corner: 14, pad: 6 },
};

export function PlayingCard({
  card,
  size = "md",
  faceDown = false,
}: {
  card?: CardCode;
  size?: "sm" | "md" | "lg";
  faceDown?: boolean;
}) {
  const S = DIMS[size];

  if (faceDown || !card) {
    return (
      <div
        className="relative shrink-0"
        style={{
          width: S.w,
          height: S.h,
          borderRadius: S.r,
          // Clean cream/white card border frame.
          background: "#f4efe3",
          boxShadow: "inset 0 0 0 1px rgba(143,29,44,0.35)",
        }}
      >
        {/* Inner panel: the red lattice lives ONLY here, inset from the white
            border so the frame stays clean. */}
        <div
          style={{
            position: "absolute",
            inset: Math.round(S.w * 0.13),
            borderRadius: Math.max(2, S.r - 3),
            background:
              "repeating-linear-gradient(45deg, rgba(143,29,44,0.32) 0 1.5px, transparent 1.5px 7px), repeating-linear-gradient(-45deg, rgba(143,29,44,0.32) 0 1.5px, transparent 1.5px 7px), #dad5ca",
            boxShadow: "inset 0 0 0 1px rgba(143,29,44,0.3)",
          }}
        />
      </div>
    );
  }

  const rank = rankLabel(card[0]!);
  const suit = card[1]!;
  const red = suit === "h" || suit === "d";
  const color = red ? "#b23b3b" : "#1a1c20";
  const sym = SUIT_SYMBOL[suit];

  return (
    <div
      className={cn("relative shrink-0")}
      style={{
        width: S.w,
        height: S.h,
        borderRadius: S.r,
        overflow: "hidden",
        background: "radial-gradient(125% 120% at 50% -8%, #faf8f1 0%, #f2eee2 70%, #e9e3d3 100%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.6), inset 0 0 0 1px rgba(120,100,60,0.12)",
        fontFamily: "var(--font-display), Georgia, serif",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: S.pad,
          left: S.pad + 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          lineHeight: 0.82,
          color,
        }}
      >
        <span style={{ fontSize: S.rank, fontWeight: 600, letterSpacing: "-0.02em" }}>{rank}</span>
        <span style={{ fontSize: S.corner, lineHeight: 1 }}>{sym}</span>
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          color,
          fontSize: S.pip,
          lineHeight: 1,
          textShadow: "0 1px 1px rgba(120,100,60,0.16)",
        }}
      >
        {sym}
      </div>
      <div
        style={{
          position: "absolute",
          bottom: S.pad,
          right: S.pad + 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          lineHeight: 0.82,
          color,
          transform: "rotate(180deg)",
        }}
      >
        <span style={{ fontSize: S.rank, fontWeight: 600, letterSpacing: "-0.02em" }}>{rank}</span>
        <span style={{ fontSize: S.corner, lineHeight: 1 }}>{sym}</span>
      </div>
    </div>
  );
}
