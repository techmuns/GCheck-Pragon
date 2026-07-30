import { env } from "./env";
import { fetchWithTimeout } from "./types";
import { cached } from "../searchCache";
import type { Suggestion } from "../types";

// ── Company / stock search ──────────────────────────────────────────────────
// The typeahead behind the company box. A governance check begins with WHO the
// meeting is about, and "who" is far better anchored to a real listed entity —
// with a ticker and a sector — than to whatever the user happened to type. This
// resolves a fragment to that entity.
//
// The endpoint answers with a map keyed by ticker: { RELIANCE: [country, name,
// sector], … }. Object key order is the API's ranking, and JS preserves it, so
// the results arrive already ordered.

/** The platform's fixed user index for this search. Sent verbatim. */
const USER_INDEX = 124;

/** A typeahead's whole value is arriving before the next keystroke. Eight
 *  seconds of waiting is not a slow suggestion, it is no suggestion — so the
 *  call is given a budget a person would actually wait through. */
const TIMEOUT_MS = 2500;

// ── Circuit breaker ─────────────────────────────────────────────────────────
// An expired token or an unreachable endpoint used to cost EVERY keystroke the
// full timeout: the box spun, fell back, and did it again on the next letter.
// After a couple of consecutive failures the upstream is presumed down and
// skipped outright for a cooldown, so the field stays instant on local results
// instead of re-discovering the outage character by character. One probe is
// allowed through once the cooldown lapses, and a single success clears it.

const TRIP_AFTER = 2;
const COOLDOWN_MS = 60_000;

interface Breaker {
  failures: number;
  openedAt: number;
}

const g = globalThis as unknown as { __paragonStockBreaker?: Breaker };
const breaker: Breaker = (g.__paragonStockBreaker ??= { failures: 0, openedAt: 0 });

/** Is the upstream currently presumed down? */
export function stockSearchTripped(now: number = Date.now()): boolean {
  if (breaker.failures < TRIP_AFTER) return false;
  if (now - breaker.openedAt >= COOLDOWN_MS) {
    // Cooldown lapsed — let one probe through rather than staying dark forever.
    breaker.failures = TRIP_AFTER - 1;
    return false;
  }
  return true;
}

function recordFailure(): void {
  breaker.failures += 1;
  if (breaker.failures >= TRIP_AFTER) breaker.openedAt = Date.now();
}

function recordSuccess(): void {
  breaker.failures = 0;
  breaker.openedAt = 0;
}

/** Each result row is [country, name, sector], any of which the API may null. */
type StockRow = [string | null, string | null, (string | null)?];

/**
 * Resolve a typed fragment to listed companies.
 *
 * Cached briefly — a typeahead re-queries on nearly every keystroke, and the
 * same prefix recurs constantly as the user backspaces and retypes, so a short
 * window spares both the quota and the latency. An empty or too-short query
 * never reaches the network.
 */
export async function searchStocks(query: string): Promise<Suggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  if (!env.munshotToken) throw new Error("no token");
  if (stockSearchTripped()) throw new Error("stock search unavailable (cooling down)");

  return cached(`stocks:${q.toLowerCase()}`, async () => {
    try {
      const res = await fetchWithTimeout(env.munshotStockSearchUrl, {
        method: "POST",
        timeoutMs: TIMEOUT_MS,
        headers: {
          "Content-Type": "application/json",
          accept: "application/json",
          Authorization: `Bearer ${env.munshotToken}`,
        },
        body: JSON.stringify({ query: q, user_index: USER_INDEX }),
      });
      if (!res.ok) throw new Error(`stock search ${res.status}`);
      const parsed = parseStocks(await res.json());
      recordSuccess();
      return parsed;
    } catch (err) {
      recordFailure();
      throw err;
    }
  });
}

/** Turn the ticker-keyed map into ordered suggestions, defensively. */
function parseStocks(data: unknown): Suggestion[] {
  const results = (data as { data?: { results?: Record<string, unknown> } })?.data?.results;
  if (!results || typeof results !== "object") return [];

  const out: Suggestion[] = [];
  for (const [ticker, row] of Object.entries(results)) {
    if (!Array.isArray(row)) continue;
    const r = row as unknown as StockRow;
    const name = (r[1] ?? "").toString().trim();
    if (!name) continue;
    const sector = (r[2] ?? "").toString().trim();
    const country = (r[0] ?? "").toString().trim();

    // A real ticker is short and symbol-like. The endpoint sometimes returns a
    // display string in the key slot (e.g. "Reliance Media") — that is not a
    // ticker, so it is not carried as one, and the filings lookup is not offered
    // for it.
    const looksLikeTicker = /^[A-Z0-9.&-]{1,20}$/.test(ticker) && !ticker.includes(" ");

    out.push({
      value: name,
      label: name,
      sub: [sector, country].filter(Boolean).join(" · ") || undefined,
      ticker: looksLikeTicker ? ticker : undefined,
    });
  }
  return out.slice(0, 8);
}
