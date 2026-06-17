"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { usePrivyConfigured } from "@/components/providers";
import { Button } from "@/components/ui/button";

// Privy SDK isolated behind a client-only dynamic import.
const PrivyMenu = dynamic(() => import("./auth-menu-privy"), { ssr: false });

function DevMenu() {
  const router = useRouter();
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        await fetch("/api/dev/signin", { method: "DELETE" });
        router.replace("/");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}

export function AuthMenu() {
  const configured = usePrivyConfigured();
  return configured ? <PrivyMenu /> : <DevMenu />;
}
