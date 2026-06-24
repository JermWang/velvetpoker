"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { initials } from "@/lib/utils";
import { authedFetch } from "@/lib/auth/privy-token";

/** Resize/crop an image file to a centered square data URL (JPEG) client-side. */
async function toSquareJpeg(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read image"));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    const scale = Math.max(size / img.width, size / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ProfileCard({
  displayName,
  avatarUrl,
}: {
  displayName: string | null;
  avatarUrl: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(avatarUrl);
  const [name, setName] = useState(displayName ?? "");
  const [busy, setBusy] = useState<null | "avatar" | "name">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    setError(null);
    setBusy("avatar");
    try {
      const dataUrl = await toSquareJpeg(file);
      const res = await authedFetch("/api/account/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setPreview(json.avatarUrl);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveName() {
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 32) {
      setError("Display name must be 2–32 characters");
      return;
    }
    setError(null);
    setBusy("name");
    try {
      const res = await authedFetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setDisplayName", name: trimmed }),
      });
      if (!res.ok) throw new Error("Could not save name");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save name");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="relative">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview}
              alt="Your profile picture"
              className="h-16 w-16 rounded-full border-2 border-velvet/40 object-cover"
            />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded-full border-2 border-white/15 bg-charcoal-700 text-lg font-semibold text-ivory">
              {initials(name || displayName)}
            </div>
          )}
        </div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onPick}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={busy === "avatar"}
          >
            {busy === "avatar" ? "Uploading…" : preview ? "Change photo" : "Upload photo"}
          </Button>
          <p className="mt-1 text-xs text-ash/70">PNG, JPG or WebP. Square works best.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="grow">
          <Label htmlFor="displayName">Display name</Label>
          <Input
            id="displayName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your table name"
            maxLength={32}
          />
        </div>
        <Button onClick={saveName} disabled={busy === "name"}>
          {busy === "name" ? "Saving…" : saved ? "Saved ✓" : "Save"}
        </Button>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}
    </div>
  );
}
