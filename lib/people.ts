// ── Person identity ─────────────────────────────────────────────────────────
// Two sources rarely spell the same director the same way. The registry carries
// the legal name off the filing ("Mukesh Dhirubhai Ambani"), Wikidata carries
// the name the world uses ("Mukesh Ambani"), and a user types whichever they
// know. Listed side by side those read as two people — and on a five-row printed
// table, the phantom displaces a real director.
//
// So names are matched on the parts that don't vary between records: the first
// and last name, with honorifics, punctuation and middle names ignored. A DIN
// settles it outright wherever both records carry one — it is issued to exactly
// one person, so two different DINs are two different people however alike the
// names read, and one shared DIN is one person however different they read.
//
// Deliberately conservative: initials are not expanded ("M. D. Ambani" is left
// as its own row), because a wrong merge hides a director from the brief, which
// is the more expensive mistake of the two.

const HONORIFIC = /^(?:mr|mrs|ms|miss|dr|prof|shri|sri|smt|shrimati|sir|late)$/;

/** A name reduced to its comparable parts: lowercase, unpunctuated, no titles. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !HONORIFIC.test(t));
}

export interface PersonIdentity {
  name: string;
  /** Director Identification Number, where the source carried one. */
  din?: string;
}

/** Is the shorter name the longer one with middle names left out? */
function isSubsequence(short: string[], long: string[]): boolean {
  let i = 0;
  for (const token of long) {
    if (token === short[i]) i += 1;
    if (i === short.length) return true;
  }
  return i === short.length;
}

/** Do these two records describe the same person? */
export function samePerson(a: PersonIdentity, b: PersonIdentity): boolean {
  const dinA = (a.din ?? "").trim();
  const dinB = (b.din ?? "").trim();
  // The registry's own identifier beats every reading of the name — including
  // when it says these are two different people who happen to share one.
  if (dinA && dinB) return dinA === dinB;

  const ta = nameTokens(a.name);
  const tb = nameTokens(b.name);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.join(" ") === tb.join(" ")) return true;

  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  // Same first name and same surname, with everything in between accounted for.
  if (short[0] !== long[0]) return false;
  if (short[short.length - 1] !== long[long.length - 1]) return false;
  return isSubsequence(short, long);
}

/** The name a source-backed row carries, when the collector didn't hand the
 *  name over as its own field: registry and Wikidata titles both lead with it,
 *  ahead of the first em-dash. */
export function nameFromTitle(title: string): string {
  return title.split(" — ")[0]?.trim() ?? "";
}

/** Citation numbers, in order, with repeats dropped — two roles read off one
 *  source page cite that page once, not twice. */
export function uniqueRefs(refs: Array<number | undefined>): number[] {
  const out: number[] = [];
  for (const r of refs) {
    if (r === undefined || out.includes(r)) continue;
    out.push(r);
  }
  return out;
}
