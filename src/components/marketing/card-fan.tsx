"use client";

/**
 * Interactive hero card fan (Claude Design's masthead).
 *
 * The five cards rest in a fanned royal flush. The spread is driven by the
 * cursor's distance from the center: hovering the center (where the cards sit)
 * collapses them into a stack, and moving toward either edge opens the full fan.
 * It tracks 1:1, can settle at any point, and eases back to the full fan on
 * leave. The end positions are the design's exact fan.
 *
 * Tracking is imperative (refs + one RAF-smoothed spread value) rather than
 * React state or per-pointermove CSS transitions. That avoids restarting
 * interpolation while the cards are between stacked and fanned positions.
 */

import { useEffect, useRef } from "react";
import { Card3D } from "@/components/poker/card-3d";
import type { Card as CardCode } from "@/lib/poker/types";

const ROYAL_FLUSH: CardCode[] = ["Ts", "Js", "Qs", "Ks", "As"];

// Full-spread end positions (spread = 1). Stacked is spread = 0.
const FAN = [
  { rotate: -16, x: -150, y: 26 },
  { rotate: -8, x: -76, y: 6 },
  { rotate: 0, x: 0, y: 0 },
  { rotate: 8, x: 76, y: 6 },
  { rotate: 16, x: 150, y: 26 },
];

function transformFor(i: number, spread: number): string {
  const f = FAN[i]!;
  const tx = (f.x * spread).toFixed(2);
  const ty = (f.y * spread).toFixed(2);
  const rot = (f.rotate * spread).toFixed(3);
  return `translate(-50%, -50%) translate(${tx}px, ${ty}px) rotate(${rot}deg)`;
}

export function CardFan() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentSpreadRef = useRef(1);
  const targetSpreadRef = useRef(1);
  const frameRef = useRef<number | null>(null);

  // Apply a spread imperatively with transitions disabled. Motion smoothing
  // happens in the RAF loop so transforms never fight an in-flight CSS easing.
  const apply = (spread: number) => {
    for (let i = 0; i < FAN.length; i++) {
      const el = cardRefs.current[i];
      if (!el) continue;
      el.style.transform = transformFor(i, spread);
    }
  };

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const stopLoop = () => {
      if (frameRef.current == null) return;
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };

    const tick = () => {
      const current = currentSpreadRef.current;
      const target = targetSpreadRef.current;
      const next = current + (target - current) * 0.18;
      const settled = Math.abs(target - next) < 0.001;
      currentSpreadRef.current = settled ? target : next;
      apply(currentSpreadRef.current);
      frameRef.current = settled ? null : requestAnimationFrame(tick);
    };

    const ensureLoop = () => {
      if (frameRef.current == null) {
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    const setTarget = (spread: number) => {
      targetSpreadRef.current = Math.min(1, Math.max(0, spread));
      ensureLoop();
    };

    for (const el of cardRefs.current) {
      if (!el) continue;
      el.style.transition = "none";
    }

    if (reduce) {
      apply(1);
      return stopLoop;
    }

    const onMove = (e: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      if (rect.width === 0) return;
      // Distance from center: fully UNSPREAD (stacked) at the center where the
      // cards sit, opening to the full fan toward either edge.
      const frac = (e.clientX - rect.left) / rect.width;
      setTarget(Math.abs(frac - 0.5) * 2);
    };
    const onLeave = () => {
      setTarget(1);
    };

    root.addEventListener("pointerenter", onMove);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    return () => {
      stopLoop();
      root.removeEventListener("pointerenter", onMove);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative mx-auto flex h-[260px] w-[34rem] max-w-[92vw] origin-center scale-[0.78] items-center justify-center sm:scale-100"
    >
      <div className="relative" style={{ animation: "vp-float 7s ease-in-out infinite" }}>
        {ROYAL_FLUSH.map((card, i) => (
          <div
            key={card}
            ref={(el) => {
              cardRefs.current[i] = el;
            }}
            className="absolute left-1/2 top-1/2"
            style={{
              // Initial = full fan (spread 1); the effect takes over on interaction.
              transform: transformFor(i, 1),
              transformOrigin: "50% 50%",
              transition: "none",
              willChange: "transform",
              zIndex: i,
              filter: "drop-shadow(0 24px 28px rgba(0,0,0,0.55))",
            }}
          >
            <Card3D card={card} size="lg" tilt={false} glow={i === 4} />
          </div>
        ))}
      </div>
    </div>
  );
}
