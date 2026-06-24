"use client";

import { useEffect, useState } from "react";

/**
 * Compact bar shown above the felt on a PRIVATE table: one-click copy of the
 * shareable invite link (plus the short invite code) so the host can pull
 * friends straight into this specific room.
 */
export function PrivateInviteBar({
  tableId,
  inviteCode,
}: {
  tableId: string;
  inviteCode: string;
}) {
  const [copied, setCopied] = useState(false);
  // Build the absolute link client-side so it carries the real origin
  // (velvetpoker.fun) rather than a guessed/relative one.
  const [link, setLink] = useState(`/app/tables/${tableId}`);
  useEffect(() => {
    setLink(`${window.location.origin}/app/tables/${tableId}`);
  }, [tableId]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the code is still visible to share manually */
    }
  }

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 rounded-2xl border border-velvet/25 bg-velvet/10 px-3 py-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="text-velvet">🔒</span>
        <div className="min-w-0 leading-tight">
          <p className="text-xs font-semibold text-ivory">Private table</p>
          <p className="truncate text-[11px] text-ash">
            Invite code{" "}
            <span className="font-mono text-velvet">{inviteCode}</span>
            <span className="hidden sm:inline"> · share the link to bring friends in</span>
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-lg border border-velvet/40 bg-velvet/15 px-3 py-1.5 text-xs font-semibold text-ivory transition-colors hover:bg-velvet/25"
      >
        {copied ? "Copied ✓" : "Copy invite link"}
      </button>
    </div>
  );
}
