import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";

/** App name placeholder — kept in one place so the product is easy to rename. */
export const APP_NAME = "Velvet";
export const APP_NAME_FULL = "Velvet Poker";

export function Wordmark({
  className,
  href = "/",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("group inline-flex items-center gap-2.5", className)}
    >
      <Image
        src="/velvet-poker-chip.png"
        alt={APP_NAME}
        width={36}
        height={36}
        className="h-8 w-8 drop-shadow-[0_2px_8px_rgba(143,29,44,0.35)]"
        priority
      />
      <span className="font-display text-lg tracking-wide text-ivory">
        {APP_NAME}
        <span className="text-velvet">.</span>
      </span>
    </Link>
  );
}
