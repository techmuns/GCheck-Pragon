import type { RawHit } from "./types";

// ── Profile view derivation ─────────────────────────────────────────────────
// The profile collector emits its facts as RawHits (one "profile" hit per page
// read, plus a "profile-highlight" hit per background fact). This turns that raw
// set into the single, ranked shape the dashboard renders and the assembler
// cites — one derivation, so the on-screen card and the citation numbers behind
// it can never disagree about what the profile says.
//
// Nothing here invents: every value comes from a hit a source actually returned,
// and every value keeps the URL of the page it was read from, so each fact on
// the card links back to its own source.

/** A headline figure — Net worth, World rank, Revenue… — with its source. */
export interface ProfileMetric {
  label: string;
  value: string;
  url?: string;
}

/** One background fact, with the page it was read from. */
export interface ProfileHighlight {
  text: string;
  url?: string;
}

export interface ProfileView {
  /** Current role / title. */
  role?: string;
  /** The organisation the role sits at. */
  employer?: string;
  /** A short paragraph placing the subject. */
  bio?: string;
  /** Big figures shown as tiles. */
  metrics: ProfileMetric[];
  /** Short key/value attributes shown inline (nationality, born, education…). */
  attributes: ProfileMetric[];
  /** Career / background facts, deduped across sources. */
  highlights: ProfileHighlight[];
  /** The richest source, used for the role/bio citation. */
  primaryUrl?: string;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function isForbes(url?: string): boolean {
  return Boolean(url && /forbes\.com/i.test(url));
}

/** Fields that make a profile hit "rich", for choosing which one leads. */
const RICH_FIELDS = [
  "role",
  "employer",
  "headline",
  "bio",
  "netWorth",
  "worldRank",
  "nationality",
  "bornYear",
  "education",
  "foundedYear",
  "revenue",
  "employees",
  "headquarters",
] as const;

function richness(h: RawHit): number {
  const x = h.extra ?? {};
  let n = RICH_FIELDS.reduce((acc, f) => acc + (str(x[f]) ? 1 : 0), 0);
  // A Forbes profile is the canonical wealth source — prefer it as the lead
  // when two pages are otherwise equally full.
  if (isForbes(h.url)) n += 0.5;
  return n;
}

// Metric tiles vs inline attributes, in display order. The tiles are the
// figures a partner scans first; the attributes are the placing facts.
const TILE_FIELDS: Array<[string, string]> = [
  ["netWorth", "Net worth"],
  ["worldRank", "World rank"],
  ["revenue", "Revenue"],
  ["employees", "Employees"],
  ["foundedYear", "Founded"],
];
const ATTR_FIELDS: Array<[string, string]> = [
  ["nationality", "Nationality"],
  ["bornYear", "Born"],
  ["education", "Education"],
  ["headquarters", "Headquarters"],
];

/** The first hit that states a given field, preferring a Forbes page — so a
 *  net worth is cited to Forbes rather than to whatever page happened to be
 *  read first. */
function pickMetric(hits: RawHit[], field: string, label: string): ProfileMetric | undefined {
  const withField = hits.filter((h) => str(h.extra?.[field]));
  if (withField.length === 0) return undefined;
  const chosen = withField.find((h) => isForbes(h.url)) ?? withField[0];
  return { label, value: str(chosen.extra?.[field])!, url: chosen.url };
}

/** Normalised key for deduping a background fact across sources. */
function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

export function buildProfile(hits: RawHit[]): ProfileView | null {
  const profileHits = hits.filter((h) => h.extra?.category === "profile");
  const highlightHits = hits.filter((h) => h.extra?.category === "profile-highlight");
  if (profileHits.length === 0 && highlightHits.length === 0) return null;

  const primary = profileHits.slice().sort((a, b) => richness(b) - richness(a))[0];
  const role = str(primary?.extra?.role);
  const employer = str(primary?.extra?.employer);
  const bio = str(primary?.extra?.bio) ?? str(primary?.extra?.headline);

  const metrics = TILE_FIELDS.map(([f, label]) => pickMetric(profileHits, f, label)).filter(
    (m): m is ProfileMetric => m != null,
  );
  const attributes = ATTR_FIELDS.map(([f, label]) => pickMetric(profileHits, f, label)).filter(
    (m): m is ProfileMetric => m != null,
  );

  const highlights: ProfileHighlight[] = [];
  const seen = new Set<string>();
  for (const h of highlightHits) {
    const text = h.title.trim();
    const key = normKey(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    highlights.push({ text, url: h.url });
    if (highlights.length >= 10) break;
  }

  if (!role && !bio && metrics.length === 0 && attributes.length === 0 && highlights.length === 0) {
    return null;
  }

  return { role, employer, bio, metrics, attributes, highlights, primaryUrl: primary?.url };
}
