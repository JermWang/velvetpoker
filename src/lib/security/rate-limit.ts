/**
 * Lightweight in-memory token-bucket rate limiter.
 *
 * - In the realtime server (one long-lived process) this is authoritative.
 * - In Next API routes on serverless it is best-effort per instance — enough to
 *   blunt casual abuse; move to a shared store (Redis/Upstash) for hard limits
 *   at scale.
 */

interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();

export interface RateOptions {
  /** Max burst. */
  capacity: number;
  /** Sustained tokens added per second. */
  refillPerSec: number;
}

/** Returns true if the action is allowed, false if it should be throttled. */
export function rateLimit(key: string, opts: RateOptions): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: opts.capacity, last: now };
    buckets.set(key, b);
  }
  const elapsedSec = (now - b.last) / 1000;
  b.tokens = Math.min(opts.capacity, b.tokens + elapsedSec * opts.refillPerSec);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Route guard: returns a 429 Response when the caller (keyed by IP) is over the
 * limit, otherwise null. Usage: `const l = tooMany(req, "withdraw", {...}); if (l) return l;`
 */
export function tooMany(
  req: Request,
  name: string,
  opts: RateOptions,
): Response | null {
  if (rateLimit(`${name}:${clientIp(req)}`, opts)) return null;
  return new Response(
    JSON.stringify({ error: "Too many requests — slow down a moment." }),
    { status: 429, headers: { "content-type": "application/json" } },
  );
}

// Periodically drop idle buckets so the map can't grow unbounded.
const SWEEP_MS = 5 * 60_000;
if (typeof setInterval !== "undefined") {
  const timer = setInterval(() => {
    const cutoff = Date.now() - 30 * 60_000;
    for (const [k, b] of buckets) if (b.last < cutoff) buckets.delete(k);
  }, SWEEP_MS);
  // Don't keep the process alive just for the sweep.
  (timer as { unref?: () => void }).unref?.();
}
