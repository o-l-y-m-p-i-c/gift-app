/**
 * Fixed-window in-memory rate limiter. Enough for the single Render instance;
 * move the counters to a shared store (e.g. Redis) before scaling out.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const windows = new Map<string, { count: number; resetAt: number }>();

  return function allow(key: string, now = Date.now()) {
    const current = windows.get(key);
    if (!current || current.resetAt <= now) {
      if (windows.size >= 10_000) {
        for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
      }
      windows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  };
}
