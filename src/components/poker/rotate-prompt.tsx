"use client";

import { useEffect, useState } from "react";

/**
 * Nudges phones into landscape at the table (it plays far better wide). On
 * Android/installed PWAs we can actually lock the orientation; iOS Safari has no
 * such API, so we fall back to a full-screen prompt that disappears the moment
 * the device is turned. A low-key "use portrait" escape hatch avoids trapping
 * anyone whose OS rotation-lock is on.
 */
export function RotatePrompt() {
  const [portrait, setPortrait] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const isPhone =
      window.matchMedia("(pointer: coarse)").matches &&
      Math.min(window.innerWidth, window.innerHeight) <= 600;

    const update = () => {
      if (!isPhone) {
        setPortrait(false);
        return;
      }
      const isPortrait = window.matchMedia("(orientation: portrait)").matches;
      setPortrait(isPortrait);
      if (isPortrait) {
        // Best-effort hard lock — works on Android Chrome / installed PWAs in
        // fullscreen; silently unsupported on iOS (the prompt covers that).
        const o = screen.orientation as ScreenOrientation & {
          lock?: (o: string) => Promise<void>;
        };
        o?.lock?.("landscape").catch(() => {});
      }
    };

    update();
    const mq = window.matchMedia("(orientation: portrait)");
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  if (!portrait || dismissed) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-charcoal-900/97 px-8 text-center backdrop-blur-sm">
      <div className="animate-rotate-hint text-6xl">📱</div>
      <div>
        <h2 className="font-display text-2xl text-ivory">Rotate your device</h2>
        <p className="mt-2 max-w-xs text-sm text-ash">
          Velvet plays best in landscape. Turn your phone sideways to take a seat.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="mt-2 text-xs text-ash/60 underline-offset-2 hover:text-ash hover:underline"
      >
        Continue in portrait
      </button>
    </div>
  );
}
