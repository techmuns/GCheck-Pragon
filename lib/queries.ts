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
  return [
    { name: subject.company, kind: "company" as const },
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
