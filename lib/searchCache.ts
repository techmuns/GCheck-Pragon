// ── Search result cache ────────────────────────────────────────────────────
// Search backends are metered — SerpAPI's free tier is 100 calls a *month*, and
// a single brief costs roughly three per entity. Re-running the same company
// (the common case while demoing, or when a run is retried) would burn the
// quota on answers we already have.
//
// So identical queries share a result for a short window. Held on globalThis
// for the same reason the run store is: Next.js hands separate route bundles
// separate module instances otherwise. It is deliberately in-memory — a cold
// start or a redeploy drops it, which is the honest trade for having no
// database here.

interface Entry<T> {
  /** Epoch ms after which this entry is stale. Set once the call resolves, so
   *  a slow request doesn't spend its own window waiting to come back. */
  expires: number;
  /** The in-flight or settled call. Storing the promise — not just its value —
   *  is what makes two simultaneous runs of the same subject share one request
   *  instead of both missing the cache and firing. */
  promise: Promise<unknown>;
}

interface CacheStore {
  entries: Map<string, Entry<unknown>>;
  hits: number;
  misses: number;
}

const g = globalThis as unknown as { __paragonSearchCache?: CacheStore };
const store: CacheStore = (g.__paragonSearchCache ??= { entries: new Map(), hits: 0, misses: 0 });

/** Default lifetime. Fifteen minutes: long enough that re-running a subject
 *  while reviewing it is free, short enough that today's news is still today's.
 *  Governance findings move on a slower clock than that, so nothing meaningful
 *  goes stale inside the window. */
const DEFAULT_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_SECONDS ?? 15 * 60) * 1000;

/** Bound the map so a long-lived instance can't grow without limit. */
const MAX_ENTRIES = 500;

/**
 * Run `fn`, reusing a recent — or still in-flight — result for the same key.
 *
 * Only successes are retained. A failure is evicted the moment it settles, so
 * the next attempt is free to succeed: otherwise an expired token would be
 * remembered as "no results" until the window lapsed, long after it was
 * replaced.
 */
export async function cached<T>(key: string, fn: () => Promise<T>, ttlMs: number = DEFAULT_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = store.entries.get(key);
  if (hit && hit.expires > now) {
    store.hits += 1;
    return hit.promise as Promise<T>;
  }

  store.misses += 1;
  evict(now);

  const promise = fn();
  // Pending entries carry a provisional expiry so a caller arriving mid-flight
  // still joins this call rather than starting a second one.
  const entry: Entry<T> = { expires: now + ttlMs, promise };
  store.entries.set(key, entry as Entry<unknown>);

  try {
    const value = await promise;
    // Start the clock from when the answer actually landed.
    entry.expires = Date.now() + ttlMs;
    return value;
  } catch (err) {
    // Drop it — but only if it is still ours; a later call may already have
    // replaced this entry with a fresh attempt.
    if (store.entries.get(key) === (entry as Entry<unknown>)) store.entries.delete(key);
    throw err;
  }
}

/** Expired entries first; if that isn't enough, drop the oldest — insertion
 *  order is Map's iteration order, so the first key is the coldest. */
function evict(now: number): void {
  if (store.entries.size < MAX_ENTRIES) return;
  for (const [k, v] of store.entries) {
    if (v.expires <= now) store.entries.delete(k);
  }
  while (store.entries.size >= MAX_ENTRIES) {
    const oldest = store.entries.keys().next();
    if (oldest.done) break;
    store.entries.delete(oldest.value);
  }
}

export function cacheStats(): { entries: number; hits: number; misses: number; ttlSeconds: number } {
  return {
    entries: store.entries.size,
    hits: store.hits,
    misses: store.misses,
    ttlSeconds: Math.round(DEFAULT_TTL_MS / 1000),
  };
}

/** Drop everything — used by the admin panel's reset, and by tests. */
export function clearSearchCache(): void {
  store.entries.clear();
  store.hits = 0;
  store.misses = 0;
}
