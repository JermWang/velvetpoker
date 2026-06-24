"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Output + on-screen viewport size (square). The circle mask shows the crop. */
const SIZE = 256;

/**
 * Interactive avatar cropper: drag to pan, slider to zoom, all inside a circular
 * viewport. Exports exactly what's framed as a square JPEG data URL. Self-
 * contained (pointer events + canvas, no deps).
 */
export function AvatarCropper({
  file,
  busy,
  onCancel,
  onCropped,
}: {
  file: File;
  busy?: boolean;
  onCancel: () => void;
  onCropped: (dataUrl: string) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const base = useRef(1);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => {
      base.current = SIZE / Math.min(i.width, i.height); // "cover" at zoom 1
      const w = i.width * base.current;
      const h = i.height * base.current;
      setImg(i);
      setZoom(1);
      setPos({ x: (SIZE - w) / 2, y: (SIZE - h) / 2 });
    };
    i.onerror = onCancel;
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, onCancel]);

  if (!img) {
    return <p className="py-8 text-center text-sm text-ash">Loading photo…</p>;
  }

  const drawW = img.width * base.current * zoom;
  const drawH = img.height * base.current * zoom;

  // Keep the image covering the circle (no empty gaps).
  const clamp = (x: number, y: number, w: number, h: number) => ({
    x: Math.min(0, Math.max(SIZE - w, x)),
    y: Math.min(0, Math.max(SIZE - h, y)),
  });

  const onZoom = (z: number) => {
    const w = img.width * base.current * z;
    const h = img.height * base.current * z;
    // zoom around the center of the viewport
    const r = z / zoom;
    const nx = SIZE / 2 - (SIZE / 2 - pos.x) * r;
    const ny = SIZE / 2 - (SIZE / 2 - pos.y) * r;
    setZoom(z);
    setPos(clamp(nx, ny, w, h));
  };

  return (
    <div className="space-y-3">
      <div
        className="relative mx-auto cursor-grab touch-none select-none overflow-hidden rounded-full border-2 border-velvet/40 bg-charcoal-900 active:cursor-grabbing"
        style={{ width: SIZE, height: SIZE, maxWidth: "100%" }}
        onPointerDown={(e) => {
          drag.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPos(
            clamp(
              drag.current.px + (e.clientX - drag.current.sx),
              drag.current.py + (e.clientY - drag.current.sy),
              drawW,
              drawH,
            ),
          );
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.src}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            left: pos.x,
            top: pos.y,
            width: drawW,
            height: drawH,
            maxWidth: "none",
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-ash">Zoom</span>
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(e) => onZoom(Number(e.target.value))}
          className="flex-1 accent-velvet"
        />
      </div>
      <p className="text-center text-xs text-ash/70">Drag to reposition · slide to zoom</p>
      <div className="flex justify-center gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            const canvas = document.createElement("canvas");
            canvas.width = SIZE;
            canvas.height = SIZE;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(img, pos.x, pos.y, drawW, drawH);
            onCropped(canvas.toDataURL("image/jpeg", 0.85));
          }}
        >
          {busy ? "Saving…" : "Use photo"}
        </Button>
      </div>
    </div>
  );
}
