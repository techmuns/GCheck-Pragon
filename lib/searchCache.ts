// ── Search result cache ────────────────────────────────────────────────────
// Search backends are metered — SerpAPI's free tier is 100 calls a *month*, and
// a single brief costs roughly three per entity. Re-running the same company
// (the common case while demoing, or when a run is retried) would burn the
// quota on answers we already have.
//
// So identical queries share a result for a while. Held on globalThis for the
// same reason the run store is: Next.js hands separate route bundles separate
// module instances otherwise. It is deliberately in-memory — a cold start or a
// redeploy drops it, which is the honest trade for having no database here.

interface Entry<T> {
  expires: number;
  value: T;
}

interface CacheStore {
  entries: Map<string, Entry<unknown>>;
  hits: number;
  misses: number;
}

const g = globalThis as unknown as { __paragonSearchCache?: CacheStore };
const store: CacheStore = (g.__paragonSearchCache ??= { entries: new Map(), hits: 0, misses: 0 });

/** Default lifetime. Long enough to cover a demo session, short enough that a
 *  brief re-run tomorrow still reflects today's news. */
const DEFAULT_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_SECONDS ?? 6 * 3600) * 1000;

/** Bound the map so a long-lived instance can't grow without limit. */
const MAX_ENTRIES = 500;

/**
 * Run `fn`, reusing a recent result for the same key when one exists.
 *
 * Only successes are cached — a failure must be free to succeed on the next
 * attempt, otherwise an expired token would be remembered as "no results" for
 * hours after it was replaced.
 */
export async function cached<T>(key: string, fn: () => Promise<T>, ttlMs: number = DEFAULT_TTL_MS): Promise<T> {
  const now = Date.now();
  const hit = store.entries.get(key);
  if (hit && hit.expires > now) {
    store.hits += 1;
    return hit.value as T;
  }

  store.misses += 1;
  const value = await fn();

  // Evict expired entries first; if that isn't enough, drop the oldest —
  // insertion order is Map's iteration order, so the first key is the coldest.
  if (store.entries.size >= MAX_ENTRIES) {
    for (const [k, v] of store.entries) {
      if (v.expires <= now) store.entries.delete(k);
    }
    while (store.entries.size >= MAX_ENTRIES) {
      const oldest = store.entries.keys().next();
      if (oldest.done) break;
      store.entries.delete(oldest.value);
    }
  }

  store.entries.set(key, { expires: now + ttlMs, value });
  return value;
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
