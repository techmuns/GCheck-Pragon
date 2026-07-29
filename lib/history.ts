import type { Subject } from "./types";

// ── Recent-search history (client-side) ────────────────────────────────────
// Runs live only in the server's in-memory store, so "recent searches" is kept
// in the browser's localStorage instead — it survives reloads and lets a
// partner re-run a recent subject in one click. Last few, most-recent first.

const KEY = "paragon.recentSearches";
const MAX = 5;

export interface RecentSearch extends Subject {
  /** ISO timestamp of when the search was last run. */
  at: string;
}

/** A stable identity for a subject — type + name + promoter set. */
function keyOf(s: Subject): string {
  const promoters = [...s.promoters].map((p) => p.toLowerCase()).sort();
  return `${s.type ?? "company"}|${s.company.toLowerCase()}|${promoters.join(",")}`;
}

export function getRecentSearches(): RecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is RecentSearch => typeof r?.company === "string" && Array.isArray(r?.promoters))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/** Remove one recent search by its subject identity. Returns the new list. */
export function removeRecentSearch(subject: Subject): RecentSearch[] {
  if (typeof window === "undefined") return [];
  const key = keyOf(subject);
  const next = getRecentSearches().filter((r) => keyOf(r) !== key);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — best-effort */
  }
  return next;
}

/** Record a search, deduping by subject identity and capping at MAX. */
export function addRecentSearch(subject: Subject): RecentSearch[] {
  if (typeof window === "undefined") return [];
  const entry: RecentSearch = {
    type: subject.type ?? "company",
    company: subject.company,
    promoters: subject.promoters,
    at: new Date().toISOString(),
  };
  const key = keyOf(subject);
  const next = [entry, ...getRecentSearches().filter((r) => keyOf(r) !== key)].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full / unavailable — history is best-effort */
  }
  return next;
}
