import type { GeneratedQuery, RawHit, Subject } from "./types";

// ── Query generation ───────────────────────────────────────────────────────
// Expands the subject (company + promoters) across the enabled keyword set into
// concrete search queries. This is the "generate queries from editable
// keywords" step of the workflow.

export interface Entity {
  name: string;
  kind: "company" | "promoter";
}

export function entitiesOf(subject: Subject): Entity[] {
  // In director mode the primary subject is a person, not a company.
  const primaryKind = subject.type === "director" ? ("promoter" as const) : ("company" as const);
  return [
    { name: subject.company, kind: primaryKind },
    ...subject.promoters.map((p) => ({ name: p, kind: "promoter" as const })),
  ].filter((e) => e.name.trim().length > 0);
}

/**
 * Red-flag queries: entity × keyword. Used by the Google / news collector.
 * e.g.  "Reliance Industries" fraud
 */
export function redFlagQueries(subject: Subject, keywords: string[]): GeneratedQuery[] {
  const out: GeneratedQuery[] = [];
  for (const e of entitiesOf(subject)) {
    for (const kw of keywords) {
      out.push({
        entity: e.name,
        entityKind: e.kind,
        keyword: kw,
        query: `"${e.name}" ${kw}`,
      });
    }
  }
  return out;
}

/**
 * Plain entity queries — one per entity, no keyword. Used for the general
 * negative-press sweep and for litigation / directorship lookups.
 */
export function entityQueries(subject: Subject): GeneratedQuery[] {
  return entitiesOf(subject).map((e) => ({
    entity: e.name,
    entityKind: e.kind,
    query: e.name,
  }));
}

/**
 * Detect which of the keyword set appear in a piece of text — whole words only.
 *
 * This was a bare substring test, which asks a much looser question than the
 * caller means by it: "legal" matched *illegal* and *paralegal*, "court"
 * matched *courtesy* and *courted*, "civil" matched *civilian*, "police"
 * matched *policed*. Each of those became a red-flag keyword hit, and the brief
 * printed "Adverse: court" over an article whose only offence was the word
 * "courtesy". In a governance report that is not a near miss — it is a false
 * statement about a person.
 *
 * A plural still counts — "defaults" is the same finding as "default". Verb
 * endings deliberately do not: the same rule that would catch "defaulted" also
 * catches "courted" for "court" and "policed" for "police", and a false adverse
 * label on a person costs more than a missed word form. Where a form genuinely
 * matters, it belongs in the keyword list, which the admin panel already makes
 * editable — that is a decision for the operator, not a guess made here.
 */
export function matchKeywords(text: string, keywords: string[]): string[] {
  return keywords.filter((kw) => keywordPattern(kw).test(text));
}

/** Compiled whole-word matchers, kept because the sweep tests the same dozen
 *  keywords against every result it reads. */
const KEYWORD_PATTERNS = new Map<string, RegExp>();

function keywordPattern(keyword: string): RegExp {
  const key = keyword.toLowerCase().trim();
  const cached = KEYWORD_PATTERNS.get(key);
  if (cached) return cached;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // No /g: a global regex carries lastIndex between calls, and this one is
  // reused across every hit in the sweep.
  const re = new RegExp(`\\b${escaped}(?:e?s)?\\b`, "i");
  KEYWORD_PATTERNS.set(key, re);
  return re;
}

// ── Entity relevance ───────────────────────────────────────────────────────
// A web/news engine returns anything that loosely matches the query string, so
// a search for "Reliance Power" pulls in "Reliance Digital" / "Reliance
// Industries" coverage too. We only stamp a hit with an entity if the result
// text actually names that entity — every significant token of the name must
// appear. This is what keeps sibling brands from being confused.

// Pure legal-form noise — stripped before matching. Distinguishing words like
// "Industries", "Power", "Digital", "Group" are deliberately KEPT.
const CORP_FORMS = new Set([
  "ltd", "limited", "pvt", "private", "plc", "inc", "incorporated",
  "corp", "corporation", "co", "company", "llp",
]);

/** Lower-case, punctuation-normalised word list. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[.,&'"()/-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Words that identify nothing on their own and are written inconsistently
 * everywhere: legal forms, and the conjunctions that come and go between one
 * source and the next. "Larsen & Toubro" and "Larsen and Toubro" are one
 * company — the ampersand is punctuation to one writer and a word to another,
 * and a matcher that counts it as a name word sees two different companies.
 */
function isNameNoise(token: string): boolean {
  return CORP_FORMS.has(token) || token === "and" || token === "the" || token === "of";
}

/** Significant name words — legal-form and conjunction noise dropped. */
function significantTokens(name: string): string[] {
  return words(name).filter((t) => t.length > 1 && !isNameNoise(t));
}

/**
 * Does this text concern *this specific* entity? The entity's significant
 * words must appear as a CONTIGUOUS PHRASE in the text — only legal-form words
 * ("Ltd", "Limited", …) may sit between them. So for "Reliance Industries":
 *   ✓ "Reliance Industries Ltd reports…"   (phrase present)
 *   ✗ "Reliance Digital opens store"        (wrong second word)
 *   ✗ "Reliance to buy stake; Tata Industries…" (words scattered, not a phrase)
 *   ✗ "Reliance posts profit"               (just the brand, not the company)
 * Names with no significant words (all noise) match permissively.
 */
export function entityMentioned(text: string, entityName: string): boolean {
  const needle = significantTokens(entityName);
  if (needle.length === 0) return true;

  // Text reduced to significant words too, so "Reliance Industries Limited"
  // collapses to [reliance, industries] and still matches [reliance, industries].
  const hay = words(text).filter((t) => !isNameNoise(t));

  // Slide the needle phrase across the haystack looking for a contiguous run.
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let all = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }

  // ── Word boundaries are not stable in company names ──────────────────────
  // The register files "IndiaMART InterMESH Limited". A cause list writes
  // "India Mart Intermesh Ltd". A headline writes "IndiaMart InterMesh". That
  // is one company, and the phrase test above sees three different ones,
  // because it compares token against token and "indiamart" is not "india".
  //
  // The consequence was not cosmetic: the subject's own court records were
  // being set aside as "a different party". For a governance pre-screen that is
  // the expensive direction to be wrong in — a near-miss shown to the reader
  // costs a glance, a discarded litigation record costs the whole point of the
  // exercise. So the compacted forms are compared as well: same letters, same
  // order, boundaries ignored.
  //
  // This does not loosen the sibling-brand guard the phrase test exists for.
  // "reliancepower" is still nowhere inside "reliancedigitalopensstore".
  const needleCompact = needle.join("");
  if (needleCompact.length >= MIN_COMPACT_MATCH && hay.join("").includes(needleCompact)) {
    return true;
  }

  return false;
}

/** Below this a compacted name is too short to look for inside a longer word —
 *  "ola" sits inside "motorola". Shorter names rely on the phrase test alone. */
const MIN_COMPACT_MATCH = 6;

// ── Identity confidence ────────────────────────────────────────────────────
// `entityMentioned` answers "does this text name the subject?". For a company
// that is close enough to identity — names are distinctive and a phrase match
// is a strong signal. For a PERSON it is not: three registered directors can
// share "Rajesh Kumar", and all three satisfy the phrase test equally.
//
// So a person's hits are graded rather than merely filtered. A hit that also
// carries the subject's DIN, or one of the companies they actually sit on, is
// about *this* person. A hit that only matched the name might be about anyone
// with that name — it is still shown, but it is marked, and it never raises
// the brief's verdict.

/** How many anchor companies to carry into QUERIES. Enough to identify the
 *  person; few enough that the query stays inside engine length limits. This is
 *  a limit on query length, and deliberately not a limit on what may confirm a
 *  hit — see `allAnchorsOf`. */
const MAX_QUERY_ANCHORS = 3;

/** The companies carried into this subject's search queries. Callers rely on
 *  the subject's own ordering, so the most useful anchors must come first. */
export function anchorsOf(subject: Subject): string[] {
  return allAnchorsOf(subject).slice(0, MAX_QUERY_ANCHORS);
}

/**
 * Every company that can vouch for this subject's identity.
 *
 * Grading is not query building, and conflating the two silently lost findings:
 * a person on six boards had only three of them able to confirm a hit, so an
 * article naming their fourth company was filed as "might be a namesake" and
 * could never raise the verdict. Queries stay short; confirmation uses the lot.
 */
export function allAnchorsOf(subject: Subject): string[] {
  return (subject.anchors ?? []).map((a) => a.trim()).filter(Boolean);
}

/**
 * Is this anchor distinctive enough to prove identity on its own?
 *
 * A one-word company ("Saarthi", "Leaf") is a word before it is a company, and
 * accepting it would confirm any article that happened to use it. Two
 * significant words is the threshold at which a name stops being a coincidence.
 */
function usableAnchor(anchor: string): boolean {
  return significantTokens(anchor).length >= 2;
}

/** Does the text carry this DIN? The padded 8-digit form counts on its own; the
 *  unpadded form only counts when "DIN" introduces it, so a bare "1695" in a
 *  sentence never passes for one. */
function dinMentioned(text: string, din: string): boolean {
  if (text.includes(din)) return true;
  const bare = din.replace(/^0+/, "");
  return bare.length > 0 && new RegExp(`\\bdin\\b[\\s:.#-]*0*${bare}\\b`, "i").test(text);
}

/**
 * Grade a hit against the subject's identity. Only meaningful once the subject
 * has something to check against — with no DIN and no anchors there is nothing
 * to confirm with, so everything is honestly "unverified" rather than being
 * dressed up as confirmed.
 */
export function subjectConfidence(text: string, subject: Subject): NonNullable<RawHit["confidence"]> {
  if (subject.din && dinMentioned(text, subject.din)) return "confirmed";
  for (const anchor of allAnchorsOf(subject)) {
    if (usableAnchor(anchor) && entityMentioned(text, anchor)) return "confirmed";
  }
  return "unverified";
}

/**
 * Whether identity grading applies at all.
 *
 * Every director subject, including one we failed to resolve. That case is the
 * whole point: with no DIN and no companies to check against, NOTHING can be
 * confirmed, so every hit is honestly "unverified" — and a brief on an
 * unresolved "Rajesh Kumar" must not charge one man's CBI case, another's graft
 * FIR and a third man's appeal to whichever Rajesh Kumar the partner is meeting.
 * Gating this on a successful resolution switched the protection off in exactly
 * the case that needs it.
 *
 * A company subject is identified well enough by its own name; grading it would
 * mark ordinary press coverage as doubtful for no reason.
 */
export function gradesIdentity(subject: Subject): boolean {
  return subject.type === "director";
}
