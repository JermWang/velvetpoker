"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, type ButtonProps } from "@/components/ui/button";

export function AdminActionButton({
  endpoint,
  body,
  children,
  variant = "secondary",
  size = "sm",
  confirm,
}: {
  endpoint: string;
  body: Record<string, unknown>;
  children: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  confirm?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      window.alert(json.error ?? "Action failed");
      return;
    }
    router.refresh();
  }

  return (
    <Button variant={variant} size={size} onClick={run} disabled={busy}>
      {busy ? "…" : children}
    </Button>
  );
}
