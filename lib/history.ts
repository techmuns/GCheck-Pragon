import type { Subject } from "./types";

// ── Superseded: the old recent-search list ─────────────────────────────────
// This key held the last five *queries* — names and a timestamp, no outcome,
// and the timestamp was never shown. It has been replaced by the run archive
// (lib/archive.ts, lib/archiveStore.ts), which records every run rather than
// the last five subjects, keeps what each one concluded, and is what the
// History screen and the front page's recent list both read.
//
// The file survives for exactly one reason: a browser upgrading into the new
// version still has this key, and those five rows are the only history that
// user has. `archiveStore` reads them once, converts them, and writes a
// sentinel so it never does it again.
//
// Nothing writes here any more. Leaving a live writer on a superseded key is
// how two lists that are meant to be one start disagreeing.

const KEY = "paragon.recentSearches";
const MAX = 5;

export interface RecentSearch extends Subject {
  /** ISO timestamp of when the search was last run. */
  at: string;
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
