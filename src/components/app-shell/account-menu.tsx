"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { initials } from "@/lib/utils";
import { AuthMenu } from "./auth-menu";

/**
 * Clickable profile avatar in the header that opens an account dropdown
 * (edit profile, history, cashier, sign out). Sign-out reuses the Privy-isolated
 * AuthMenu so the Privy SDK never enters this component's import graph.
 */
export function AccountMenu({
  avatarUrl,
  displayName,
  email,
}: {
  avatarUrl: string | null;
  displayName: string | null;
  email: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const label = displayName ?? email ?? "Account";
  const links = [
    { href: "/app/account", label: "Edit profile" },
    { href: "/app/history", label: "History" },
    { href: "/app/cashier", label: "Cashier" },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        className="block h-9 w-9 overflow-hidden rounded-full border border-white/12 transition hover:ring-2 hover:ring-velvet/40"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="Your profile" className="h-full w-full object-cover" />
        ) : (
          <span className="grid h-full w-full place-items-center bg-white/5 text-xs text-ivory">
            {initials(label)}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-charcoal-900/95 py-1 shadow-elevated backdrop-blur"
        >
          <div className="border-b border-white/8 px-3 py-2">
            <p className="truncate text-sm text-ivory">{label}</p>
            {email && displayName && (
              <p className="truncate text-xs text-ash">{email}</p>
            )}
          </div>
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-sm text-ash transition-colors hover:bg-white/5 hover:text-ivory"
            >
              {l.label}
            </Link>
          ))}
          <div className="flex justify-end border-t border-white/8 px-3 py-2">
            <AuthMenu />
          </div>
        </div>
      )}
    </div>
  );
}
