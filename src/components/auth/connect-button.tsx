"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { usePrivyConfigured } from "@/components/providers";
import { Button } from "@/components/ui/button";

export interface ConnectButtonProps {
  label?: string;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
}

// Privy SDK isolated behind a client-only dynamic import.
const ConnectButtonPrivy = dynamic(() => import("./connect-button-privy"), {
  ssr: false,
});

/** Dev fallback (Privy not configured): route to the sign-in page. */
function ConnectButtonDev({
  label = "Connect wallet",
  size = "md",
  variant = "primary",
  className,
}: ConnectButtonProps) {
  const router = useRouter();
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      onClick={() => router.push("/signin")}
    >
      {label}
    </Button>
  );
}

/**
 * A wallet-connect button usable anywhere we want to gate an action behind
 * connection (host, join, take a seat). Triggers the Privy login modal in
 * production; falls back to the sign-in page in dev.
 */
export function ConnectButton(props: ConnectButtonProps) {
  const configured = usePrivyConfigured();
  return configured ? (
    <ConnectButtonPrivy {...props} />
  ) : (
    <ConnectButtonDev {...props} />
  );
}
