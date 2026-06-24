"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { initials } from "@/lib/utils";
import { authedFetch } from "@/lib/auth/privy-token";
import { AvatarCropper } from "./avatar-cropper";
import { NftPicker } from "./nft-picker";

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
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [nftOpen, setNftOpen] = useState(false);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file");
      return;
    }
    setError(null);
    setCropFile(file); // open the cropper; the upload happens on "Use photo"
  }

  async function uploadCropped(dataUrl: string) {
    setError(null);
    setBusy("avatar");
    try {
      const res = await authedFetch("/api/account/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setPreview(json.avatarUrl);
      setCropFile(null);
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
      {cropFile && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="mb-3 text-center text-sm font-medium text-ivory">
            Position &amp; crop your photo
          </p>
          <AvatarCropper
            file={cropFile}
            busy={busy === "avatar"}
            onCancel={() => setCropFile(null)}
            onCropped={uploadCropped}
          />
        </div>
      )}
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
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={busy === "avatar"}
            >
              {busy === "avatar" ? "Uploading…" : preview ? "Change photo" : "Upload photo"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNftOpen(true)}
              disabled={busy === "avatar"}
            >
              Choose NFT
            </Button>
          </div>
          <p className="mt-1 text-xs text-ash/70">
            Upload an image, or pick a verified NFT from your wallet.
          </p>
        </div>
      </div>

      {nftOpen && (
        <NftPicker
          onClose={() => setNftOpen(false)}
          onPicked={(url) => {
            setPreview(url);
            setNftOpen(false);
            router.refresh();
          }}
        />
      )}

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
