"use client";

import { useEffect, useRef } from "react";

/**
 * A live camera tile. Renders a MediaStreamTrack into a square <video> — used
 * to replace a seat's round avatar with the player's camera when they enable
 * video. `mirror` flips the local preview so it reads like a mirror.
 */
export function VideoTile({
  track,
  className,
  mirror = false,
}: {
  track: MediaStreamTrack;
  className?: string;
  mirror?: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stream = new MediaStream([track]);
    el.srcObject = stream;
    void el.play().catch(() => {
      /* autoplay can be blocked; the muted attr should allow it */
    });
    return () => {
      el.srcObject = null;
    };
  }, [track]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={className}
      style={{ objectFit: "cover", transform: mirror ? "scaleX(-1)" : undefined }}
    />
  );
}
