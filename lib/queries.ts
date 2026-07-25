import type { GeneratedQuery, Subject } from "./types";

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
