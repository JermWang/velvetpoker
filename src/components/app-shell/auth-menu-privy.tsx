"use client";

import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { shortAddress } from "@/lib/utils";

/** Privy-using account menu. Loaded only via dynamic(ssr:false). */
export default function PrivyMenu() {
  const router = useRouter();
  const { user, logout } = usePrivy();
  const address = user?.wallet?.address ?? null;
  return (
    <div className="flex items-center gap-2">
      {address && (
        <span className="hidden rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-ash sm:inline">
          {shortAddress(address)}
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          await logout();
          router.replace("/");
          router.refresh();
        }}
      >
        Disconnect
      </Button>
    </div>
  );
}
