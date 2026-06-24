"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The house token's on-chain contract address (CA), click-to-copy.
 *
 * Wired to NEXT_PUBLIC_CONTRACT_ADDRESS (the token mint — public info, safe to
 * expose) so it auto-populates everywhere the moment the token launches; until
 * then it shows a tasteful "live at launch" state. NEXT_PUBLIC_TOKEN_SYMBOL
 * labels it (falls back to the VELVET brand ticker). NEXT_PUBLIC_* is inlined at
 * build time, so set it on the host and redeploy.
 *
 * Two looks, one source of truth:
 *  - default → a full-width frosted-glass bar (top of the lobby)
 *  - compact → a pill (desktop nav header + mobile nav drawer)
 *
 * The whole container is the copy target ("click to copy"), with a brief
 * "Copied" confirmation.
 */

const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "").trim();
const SYMBOL =
  process.env.NEXT_PUBLIC_TOKEN_SYMBOL &&
  process.env.NEXT_PUBLIC_TOKEN_SYMBOL !== "TOKEN"
    ? process.env.NEXT_PUBLIC_TOKEN_SYMBOL
    : "VELVET";

/** `So111…1112` — keeps an address from overflowing while staying recognizable. */
function middleTruncate(addr: string, head = 5, tail = 5): string {
  return addr.length <= head + tail + 1
    ? addr
    : `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

function Glyph({ copied, className }: { copied: boolean; className?: string }) {
  return copied ? (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function ContractAddressChip({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const hasCA = CONTRACT_ADDRESS.length > 0;

  async function copy() {
    if (!hasCA) return;
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={copy}
        disabled={!hasCA}
        title={
          hasCA
            ? `Copy the $${SYMBOL} contract address`
            : `$${SYMBOL} contract address — live at launch`
        }
        className={cn(
          "group flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs backdrop-blur transition-colors",
          "border-velvet/30 bg-velvet/[0.08]",
          hasCA
            ? "hover:border-velvet/55 hover:bg-velvet/[0.16]"
            : "cursor-default opacity-70",
          className,
        )}
      >
        <span className="font-semibold tracking-wide text-velvet">CA</span>
        {hasCA ? (
          <>
            <span className="font-mono text-ivory">
              {middleTruncate(CONTRACT_ADDRESS, 4, 4)}
            </span>
            <Glyph
              copied={copied}
              className="h-3.5 w-3.5 shrink-0 text-ash group-hover:text-ivory"
            />
          </>
        ) : (
          <span className="text-ash">soon</span>
        )}
      </button>
    );
  }

  // Full bar — top of the lobby.
  return (
    <button
      type="button"
      onClick={copy}
      disabled={!hasCA}
      aria-label={hasCA ? `Copy the ${SYMBOL} contract address` : undefined}
      className={cn(
        "glass glass-velvet group flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-colors sm:px-5",
        hasCA ? "glass-hover hover:border-velvet/55" : "cursor-default",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-velvet sm:text-[11px]">
          ${SYMBOL} Contract Address
        </p>
        {hasCA ? (
          <>
            {/* Full on desktop, middle-truncated on mobile so it never overflows. */}
            <p className="mt-0.5 hidden truncate font-mono text-sm text-ivory sm:block">
              {CONTRACT_ADDRESS}
            </p>
            <p className="mt-0.5 font-mono text-sm text-ivory sm:hidden">
              {middleTruncate(CONTRACT_ADDRESS, 7, 7)}
            </p>
          </>
        ) : (
          <p className="mt-0.5 font-mono text-sm text-ash">
            Live at launch — paste-ready right here.
          </p>
        )}
      </div>
      <span
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
          hasCA
            ? "border-velvet/40 bg-velvet/15 text-ivory group-hover:bg-velvet/25"
            : "border-white/10 bg-white/5 text-ash",
        )}
      >
        <Glyph copied={copied} className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
      </span>
    </button>
  );
}
