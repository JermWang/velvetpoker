"use client";

/**
 * Table sound effects. Files live in /public/sounds and are played on socket
 * events (moves, deal, your turn, win). Honors a persisted mute toggle and the
 * browser autoplay policy (play() is best-effort; it succeeds once the user has
 * interacted with the page, which they have by the time they're at a table).
 *
 * To upgrade fidelity, replace the .wav files with recordings of the same name.
 */

import type { ActionType } from "@/lib/poker/types";

export type SoundName =
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "allin"
  | "fold"
  | "deal"
  | "turn"
  | "win";

const SRC: Record<SoundName, string> = {
  check: "/sounds/check.wav",
  call: "/sounds/call.wav",
  bet: "/sounds/bet.wav",
  raise: "/sounds/raise.wav",
  allin: "/sounds/allin.wav",
  fold: "/sounds/fold.wav",
  deal: "/sounds/deal.wav",
  turn: "/sounds/turn.wav",
  win: "/sounds/win.wav",
};

const MUTE_KEY = "vp:muted";
const cache = new Map<SoundName, HTMLAudioElement>();
const listeners = new Set<(m: boolean) => void>();

export function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MUTE_KEY) === "1";
}

export function setMuted(m: boolean): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  listeners.forEach((fn) => fn(m));
}

export function subscribeMuted(fn: (m: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function base(name: SoundName): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  let el = cache.get(name);
  if (!el) {
    el = new Audio(SRC[name]);
    el.preload = "auto";
    cache.set(name, el);
  }
  return el;
}

/** Preload all clips (call once on mount so first plays aren't delayed). */
export function preloadSounds(): void {
  (Object.keys(SRC) as SoundName[]).forEach(base);
}

/** Play a sound (no-op when muted / SSR). Clones so rapid repeats overlap. */
export function playSound(name: SoundName): void {
  if (typeof window === "undefined" || isMuted()) return;
  const el = base(name);
  if (!el) return;
  const node = el.cloneNode(true) as HTMLAudioElement;
  node.volume = 0.6;
  void node.play().catch(() => {
    /* autoplay blocked until first gesture — ignore */
  });
}

/** Map an engine action to its sound (null = no sound, e.g. blind posts). */
export function soundForAction(action: ActionType): SoundName | null {
  switch (action) {
    case "CHECK":
      return "check";
    case "CALL":
      return "call";
    case "BET":
      return "bet";
    case "RAISE":
      return "raise";
    case "ALL_IN":
      return "allin";
    case "FOLD":
      return "fold";
    default:
      return null;
  }
}
