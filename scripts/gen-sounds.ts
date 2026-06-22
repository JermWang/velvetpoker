/**
 * Generate the table sound-effect WAV files into public/sounds/.
 * Run: `npx tsx scripts/gen-sounds.ts`
 *
 * These are procedurally synthesized so the app ships with working audio today.
 * To upgrade fidelity, drop recorded samples with the SAME filenames into
 * public/sounds/ (the loader keys off the names) — no code change needed.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SR = 44100;
const OUT = join(process.cwd(), "public", "sounds");
mkdirSync(OUT, { recursive: true });

// Deterministic PRNG so regenerating is stable (no Math.random in the harness).
let _s = 1337;
function rnd(): number {
  _s = (_s * 1103515245 + 12345) & 0x7fffffff;
  return _s / 0x7fffffff;
}
const noise = () => rnd() * 2 - 1;

function buf(seconds: number): Float32Array {
  return new Float32Array(Math.ceil(seconds * SR));
}
function mix(dst: Float32Array, src: Float32Array, at = 0) {
  const off = Math.floor(at * SR);
  for (let i = 0; i < src.length; i++) {
    const j = off + i;
    if (j >= 0 && j < dst.length) dst[j] = dst[j]! + src[i]!;
  }
}
/** A decaying sine "ping" (body tone). */
function ping(freq: number, dur: number, decay = 18, gain = 0.6): Float32Array {
  const b = buf(dur);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    b[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-decay * t) * gain;
  }
  return b;
}
/** A short filtered-noise "click" — the building block of chip clinks. */
function click(dur: number, decay: number, gain: number, tone = 0): Float32Array {
  const b = buf(dur);
  let prev = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    // crude high-pass: difference of successive noise samples => bright click
    const n = noise();
    const hp = n - prev;
    prev = n;
    const body = tone ? Math.sin(2 * Math.PI * tone * t) * 0.5 : 0;
    b[i] = (hp * 0.9 + body) * Math.exp(-decay * t) * gain;
  }
  return b;
}
/** A cluster of clicks => chips clinking together. */
function chips(count: number, spread: number, gain: number): Float32Array {
  const b = buf(spread + 0.12);
  for (let k = 0; k < count; k++) {
    const at = rnd() * spread;
    const tone = 1800 + rnd() * 2600;
    mix(b, click(0.07, 60 + rnd() * 40, gain * (0.6 + rnd() * 0.4), tone), at);
  }
  return b;
}
/** Soft sine chime of one or more notes (for turn/win cues). */
function chime(freqs: number[], step: number, dur: number, gain: number): Float32Array {
  const b = buf(step * freqs.length + dur);
  freqs.forEach((f, i) => {
    const n = ping(f, dur, 6, gain);
    // gentle attack so it doesn't click
    for (let j = 0; j < Math.min(n.length, 600); j++) n[j] = n[j]! * (j / 600);
    mix(b, n, i * step);
  });
  return b;
}

function normalize(b: Float32Array, peak = 0.9): Float32Array {
  let max = 0;
  for (const v of b) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < b.length; i++) b[i] = (b[i]! / max) * peak;
  return b;
}

function writeWav(name: string, b: Float32Array) {
  normalize(b);
  const data = Buffer.alloc(44 + b.length * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + b.length * 2, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); // PCM
  data.writeUInt16LE(1, 22); // mono
  data.writeUInt32LE(SR, 24);
  data.writeUInt32LE(SR * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(b.length * 2, 40);
  for (let i = 0; i < b.length; i++) {
    const s = Math.max(-1, Math.min(1, b[i]!));
    data.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  writeFileSync(join(OUT, name), data);
  console.log(`  wrote ${name} (${(data.length / 1024).toFixed(1)} KB)`);
}

// --- the kit ---------------------------------------------------------------

// CHECK — a double knuckle-knock on the table.
function knock(): Float32Array {
  const b = buf(0.34);
  const one = () => {
    const k = buf(0.16);
    mix(k, ping(190, 0.16, 42, 0.9), 0); // low thud body
    mix(k, click(0.04, 120, 0.5), 0); // knuckle transient
    return k;
  };
  mix(b, one(), 0);
  mix(b, one(), 0.13);
  return b;
}

console.log("Generating sounds →", OUT);
writeWav("check.wav", knock());
writeWav("call.wav", chips(5, 0.1, 0.5)); // modest chip set
writeWav("bet.wav", chips(8, 0.16, 0.55)); // a stack pushed
writeWav("raise.wav", chips(12, 0.22, 0.6)); // bigger push
writeWav("allin.wav", (() => {
  const b = buf(0.6);
  mix(b, ping(70, 0.5, 6, 0.5), 0); // low shove rumble
  mix(b, chips(18, 0.34, 0.6), 0.02); // a big pile
  return b;
})());
writeWav("fold.wav", (() => {
  // card slide / swipe — enveloped bright noise.
  const b = buf(0.22);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.01) * Math.exp(-16 * t);
    b[i] = noise() * env * 0.5;
  }
  return b;
})());
writeWav("deal.wav", (() => {
  const b = buf(0.4);
  for (let k = 0; k < 3; k++) mix(b, click(0.06, 70, 0.5, 0), 0.02 + k * 0.11);
  return b;
})());
writeWav("turn.wav", chime([660, 880], 0.1, 0.5, 0.4)); // your turn — soft up-chime
writeWav("win.wav", (() => {
  const b = buf(0.9);
  mix(b, chime([523, 659, 784], 0.12, 0.6, 0.4), 0); // ascending C-E-G
  mix(b, chips(10, 0.3, 0.4), 0.18); // chips raked in
  return b;
})());
console.log("Done.");
