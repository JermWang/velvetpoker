import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "velvet" | "green" | "amber" | "red";

const tones: Record<Tone, string> = {
  neutral: "border-white/12 text-ash bg-white/5",
  velvet: "border-velvet/30 text-velvet bg-velvet/10",
  green: "border-emerald-500/30 text-emerald-300 bg-emerald-500/10",
  amber: "border-amber-500/30 text-amber-300 bg-amber-500/10",
  red: "border-red-500/30 text-red-300 bg-red-500/10",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-wide",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Maps domain statuses to a tone + label. */
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, Tone> = {
    ACTIVE: "green",
    APPROVED: "green",
    ALLOWED: "green",
    SENT: "green",
    WAITING: "neutral",
    PENDING: "amber",
    PENDING_REVIEW: "amber",
    NOT_STARTED: "neutral",
    UNKNOWN: "neutral",
    PAUSED: "amber",
    REQUESTED: "amber",
    DETECTED: "amber",
    CONFIRMED: "velvet",
    CREDITED: "green",
    SUSPENDED: "red",
    BLOCKED: "red",
    REJECTED: "red",
    FAILED: "red",
    SELF_EXCLUDED: "red",
    CLOSED: "neutral",
  };
  return <Badge tone={map[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}
