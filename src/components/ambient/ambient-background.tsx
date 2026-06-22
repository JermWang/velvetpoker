"use client";

/**
 * AmbientBackground — sleek, restrained mood layer.
 *
 * A slow domain-warped FBM field rendered as a faint velvet-red ASCII tracery that
 * lives only in the OUTSKIRTS (a radial mask fades it out toward the center so
 * content stays clean), with a soft bloom and a few tiny velvet-red motes. Quiet by
 * design — an accent, not a centerpiece.
 *
 * Client-only (mounts after hydration): there is no reason to server-render an
 * animated canvas, and doing so was breaking static prerender. Honors
 * prefers-reduced-motion, throttles, pauses when hidden, pointer-events: none.
 */

import { useEffect, useRef, useState } from "react";

const RAMP = [" ", "·", "·", ":", "+", "=", "✦", "◆"]; // sparse → dense
const CELL = 13; // small, fine ASCII characters
const FPS = 30;
const PARTICLE_COUNT = 90;
const NS = 0.05;

interface Particle {
  x: number; y: number; vx: number; vy: number; r: number; a: number; phase: number;
}

function hash2(ix: number, iy: number): number {
  const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const u = smooth(xf);
  const v = smooth(yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x: number, y: number): number {
  let f = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 3; i++) {
    f += amp * valueNoise(x * freq, y * freq);
    freq *= 2;
    amp *= 0.5;
  }
  return f / 0.875;
}

export function AmbientBackground({ intensity = 1 }: { intensity?: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <AmbientCanvas intensity={intensity} />;
}

function AmbientCanvas({ intensity }: { intensity: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const glyph = document.createElement("canvas");
    const gctx = glyph.getContext("2d");
    if (!gctx) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    const particles: Particle[] = [];

    const resize = () => {
      const nextW = window.innerWidth || document.documentElement.clientWidth || 0;
      const nextH = window.innerHeight || document.documentElement.clientHeight || 0;
      if (nextW === 0 || nextH === 0) return;
      const changed = nextW !== w || nextH !== h;
      w = nextW;
      h = nextH;
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      glyph.width = w;
      glyph.height = h;
      cols = Math.ceil(w / CELL) + 1;
      rows = Math.ceil(h / CELL) + 1;
      if (changed && particles.length) seedParticles();
    };

    const seedParticles = () => {
      particles.length = 0;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.06,
          vy: -(0.05 + Math.random() * 0.13),
          r: 0.26 + Math.random() * 0.55,
          a: 0.28 + Math.random() * 0.5,
          phase: Math.random() * Math.PI * 2,
        });
      }
    };

    resize();
    seedParticles();
    requestAnimationFrame(() => resize());
    const kick = setTimeout(() => resize(), 120);

    const field = (c: number, r: number, t: number) => {
      const x = c * NS;
      const y = r * NS;
      const qx = fbm(x + t * 0.06, y - t * 0.03);
      const qy = fbm(x + 2.3, y + t * 0.05 + 1.7);
      return fbm(x + 2.4 * qx, y + 2.4 * qy - t * 0.02);
    };

    gctx.textBaseline = "top";

    const drawFrame = (t: number) => {
      gctx.clearRect(0, 0, w, h);
      gctx.font = `${CELL}px ui-monospace, "Cascadia Code", "Courier New", monospace`;
      const baseAlpha = 0.92 * intensity;
      const last = RAMP.length - 1;
      const ccx = cols / 2;
      const ccy = rows / 2;
      const maxD = Math.hypot(ccx, ccy);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // gentle center fade: clean in the very center, present elsewhere,
          // fullest at the edges
          const dist = Math.hypot(c - ccx, r - ccy) / maxD;
          const edge = smoothstep(0.18, 0.9, dist);
          if (edge <= 0.02) continue;
          const raw = field(c, r, t);
          const vc = smoothstep(0.34, 0.72, raw);
          if (vc <= 0.04) continue;
          let idx = 1 + Math.floor(vc * (RAMP.length - 1));
          if (idx > last) idx = last;
          const ch = RAMP[idx];
          if (!ch || ch === " ") continue;
          const a = baseAlpha * edge * (0.5 + 0.5 * vc);
          gctx.fillStyle = `rgba(176,58,72,${a.toFixed(3)})`;
          gctx.fillText(ch, c * CELL, r * CELL);
        }
      }

      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.filter = "none";
      ctx.globalAlpha = 1;
      ctx.drawImage(glyph, 0, 0);
      // glowey bloom — multi-radius "lighter" passes (brighter halo)
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.85 * intensity;
      ctx.filter = "blur(5px)";
      ctx.drawImage(glyph, 0, 0);
      ctx.globalAlpha = 0.64 * intensity;
      ctx.filter = "blur(14px)";
      ctx.drawImage(glyph, 0, 0);
      ctx.globalAlpha = 0.46 * intensity;
      ctx.filter = "blur(30px)";
      ctx.drawImage(glyph, 0, 0);
      ctx.filter = "none";
      ctx.globalAlpha = 1;

      for (const p of particles) {
        const twinkle = 0.7 + 0.3 * Math.sin(t * 2.4 + p.phase);
        const a = p.a * intensity * twinkle;
        const glow = p.r * 3.2;
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glow);
        grd.addColorStop(0, `rgba(214,106,118,${a.toFixed(3)})`);
        grd.addColorStop(0.5, `rgba(176,58,72,${(a * 0.32).toFixed(3)})`);
        grd.addColorStop(1, "rgba(176,58,72,0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(p.x, p.y, glow, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(244,221,224,${Math.min(1, a * 1.3).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.35, p.r * 0.7), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const step = (p: Particle, t: number) => {
      p.x += p.vx + Math.sin(t * 0.6 + p.phase) * 0.1;
      p.y += p.vy;
      if (p.y < -10) {
        p.y = h + 10;
        p.x = Math.random() * w;
      }
      if (p.x < -10) p.x = w + 10;
      if (p.x > w + 10) p.x = -10;
    };

    let raf = 0;
    let lastT = 0;
    let t = 0;
    const interval = 1000 / FPS;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - lastT < interval) return;
      lastT = now;
      t += 0.045;
      for (const p of particles) step(p, t);
      drawFrame(t);
    };

    if (reduce) drawFrame(8);
    else raf = requestAnimationFrame(loop);

    const onResize = () => {
      resize();
      if (reduce) drawFrame(8);
    };
    const ro = new ResizeObserver(() => {
      const had = w;
      resize();
      if (reduce && (had === 0 || w !== had)) drawFrame(8);
    });
    ro.observe(canvas.parentElement ?? canvas);

    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reduce) {
        lastT = 0;
        raf = requestAnimationFrame(loop);
      }
    };
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(kick);
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intensity]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.14) 0px, rgba(0,0,0,0.14) 1px, transparent 1px, transparent 3px)",
          mixBlendMode: "multiply",
          opacity: 0.45,
        }}
      />
      <div className="absolute inset-0 crt-flicker" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 120% at 50% 40%, transparent 58%, rgba(6,7,9,0.5) 100%)",
        }}
      />
    </div>
  );
}
