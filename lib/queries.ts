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

/** Detect which of the keyword set appear in a piece of text. */
export function matchKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw.toLowerCase()));
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

/** Significant name words — legal-form noise ("Ltd", "Pvt", …) dropped. */
function significantTokens(name: string): string[] {
  return words(name).filter((t) => t.length > 1 && !CORP_FORMS.has(t));
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
  const hay = words(text).filter((t) => !CORP_FORMS.has(t));

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
  return false;
}

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

/** How many anchor companies to carry into queries. Enough to identify the
 *  person; few enough that the query stays inside engine length limits. */
const MAX_ANCHORS = 3;

/** The companies available to anchor this subject's searches. */
export function anchorsOf(subject: Subject): string[] {
  return (subject.anchors ?? []).map((a) => a.trim()).filter(Boolean).slice(0, MAX_ANCHORS);
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
  for (const anchor of anchorsOf(subject)) {
    if (entityMentioned(text, anchor)) return "confirmed";
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
