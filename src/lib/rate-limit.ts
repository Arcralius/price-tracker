type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;

/**
 * In-process fixed-window limiter, sized for a single-container deployment.
 * If you ever run more than one `web` replica, move this to Postgres or Redis —
 * each process currently keeps its own count.
 */
export function checkRateLimit(key: string): { allowed: boolean; retryInSeconds: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    sweep(now);
    return { allowed: true, retryInSeconds: 0 };
  }

  bucket.count++;
  if (bucket.count > MAX_ATTEMPTS) {
    return { allowed: false, retryInSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryInSeconds: 0 };
}

export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/** Drops expired buckets so a stream of unique keys can't grow the map forever. */
function sweep(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}
