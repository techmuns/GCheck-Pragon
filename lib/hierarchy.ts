// ── Board seniority ─────────────────────────────────────────────────────────
// A board arrives from the registry in the registry's own order — filing order,
// not rank — so the Managing Director routinely sits below four independent
// directors. Key People is the section a reader scans on the way into a meeting
// ("who runs this company?"), and that question is answered top-down or not at
// all. So the people are ordered by the office they hold: whoever runs the
// company first, the owners next, the rest of the board after, the officers
// last, and anyone who has left the role at the bottom.
//
// Both surfaces rank through this one ladder — the dashboard's Key People list
// and the one-page brief's people table — so the two can never disagree. On the
// printed page it decides more than the order: only five rows fit, so the rank
// is what chooses WHICH five people the brief carries.

/** Anything whose designation we don't recognise — sorted after every known
 *  office, but ahead of roles the person has already left. */
const UNKNOWN_RANK = 90;
/** A role held in the past is history, not hierarchy. */
const PAST_RANK = 99;

interface Office {
  /** Seniority — lower is more senior. */
  rank: number;
  re: RegExp;
}

// Tested in order, first match wins, so the specific titles come before the
// generic ones they contain: "Independent Director" has to be recognised before
// the plain "Director" inside it, and "Non-Executive Director" before
// "Executive Director". That match order is not the seniority order, which is
// why the rank is written out on each row rather than implied by position.
const OFFICES: Office[] = [
  { rank: 0, re: /chair\w*\s*(?:&|and|cum|-)?\s*managing director|\bcmd\b/ },
  { rank: 2, re: /\b(?:vice|dy\.?|deputy)[- ]?chair/ },
  { rank: 1, re: /\bchair(?:man|person|woman|)\b/ },
  { rank: 4, re: /\b(?:joint|jt\.?|dy\.?|deputy)\s+managing director\b|\bjmd\b/ },
  { rank: 3, re: /\bmanaging director\b|\bmd\b/ },
  { rank: 5, re: /\bchief executive\b|\bceo\b/ },
  // Independent and non-executive seats are board seats without executive
  // charge — they rank below the people who actually run the company, so they
  // are matched here but ranked down at 12.
  { rank: 12, re: /\bindependent\b|\bnon[- ]?exec/ },
  { rank: 6, re: /\bwhole[- ]?time\b|\bwtd\b|\bexecutive director\b/ },
  { rank: 7, re: /\bchief\b|\bcfo\b|\bcoo\b|\bcto\b|\bpresident\b|\bmanager\b/ },
  // Control, not office: a promoter or founder outranks an ordinary board seat
  // in a pre-meeting brief, because they are who the company answers to.
  { rank: 8, re: /\bfounder\b|\bco[- ]?founder\b|\bpromoter\b/ },
  { rank: 9, re: /\bnominee\b/ },
  { rank: 11, re: /\badditional\b/ },
  { rank: 13, re: /\balternate\b/ },
  { rank: 14, re: /\bcompany secretary\b|\bsecretary\b|\bcompliance officer\b|\bcs\b/ },
  { rank: 10, re: /\bdirector\b|\bboard member\b/ },
];

const PAST_RE = /\b(?:former|ex|past|retd|retired|resigned|outgoing|erstwhile)\b/;

/** Where a designation sits in the board hierarchy — lower is more senior. */
export function roleRank(designation?: string): number {
  const d = (designation ?? "").toLowerCase().trim();
  if (!d) return UNKNOWN_RANK;
  if (PAST_RE.test(d)) return PAST_RANK;
  for (const o of OFFICES) {
    if (o.re.test(d)) return o.rank;
  }
  return UNKNOWN_RANK;
}

/** A tenure string in months, for ranking within one office. Reads both the
 *  registry's own wording ("23 years 5 months") and the compact form the
 *  printed table uses ("23y 5m"). Unreadable or absent tenure sorts last. */
export function tenureMonths(tenure?: string): number {
  const t = (tenure ?? "").toLowerCase();
  const y = t.match(/(\d+)\s*y/);
  const m = t.match(/(\d+)\s*m/);
  if (!y && !m) return -1;
  return Number(y?.[1] ?? 0) * 12 + Number(m?.[1] ?? 0);
}

/** Anything the ladder can rank: a person row carrying their office and, where
 *  the source gave one, how long they have held it. */
export interface RankablePerson {
  role?: string;
  tenure?: string;
}

/**
 * Sort comparator: by office first, then — within one office — by how long the
 * person has served, longest first. Two independent directors are equals on
 * paper; the one who has sat on the board for eleven years is the one a reader
 * asks about. Ties keep their source order (Array#sort is stable), so the
 * registry's own sequence survives wherever we have nothing better.
 */
export function compareByHierarchy(a: RankablePerson, b: RankablePerson): number {
  const rank = roleRank(a.role) - roleRank(b.role);
  if (rank !== 0) return rank;
  return tenureMonths(b.tenure) - tenureMonths(a.tenure);
}
