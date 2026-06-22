"use client";

/**
 * Lightweight, accessible tooltip + a small "?" help hint. Hover- and
 * focus-triggered with a short open delay so it never feels nagging (instant
 * dismiss). Pointer-events-none, wraps text, positioned above by default.
 *
 * Intended for explaining navigation/features to new visitors — not for things
 * regulars already know (poker actions, etc.).
 */

import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type Side = "top" | "bottom" | "left" | "right";

const SIDE_POS: Record<Side, string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
};

export function Tooltip({
  label,
  children,
  side = "top",
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: Side;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 350);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            "pointer-events-none absolute z-50 w-max max-w-[220px] whitespace-normal rounded-lg border border-white/10 bg-charcoal-900/95 px-2.5 py-1.5 text-center text-[11px] leading-snug text-ivory shadow-elevated backdrop-blur",
            SIDE_POS[side],
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}

/** A small "?" affordance that reveals help text on hover/focus. */
export function HelpHint({
  label,
  side = "top",
  className,
}: {
  label: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  return (
    <Tooltip label={label} side={side} className={className}>
      <button
        type="button"
        aria-label="Help"
        className="grid h-4 w-4 place-items-center rounded-full border border-white/15 text-[9px] font-semibold text-ash/80 transition-colors hover:border-velvet/50 hover:text-ivory"
        // Hint only — never submits a form, navigates, or toggles a wrapping label.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        ?
      </button>
    </Tooltip>
  );
}
