import type { CollectorResult, RawHit } from "../types";
import type { Collector } from "./types";
import { searchWeb } from "./google";
import { entityMentioned, entitiesOf } from "../queries";

// ── Political affiliation / exposure ────────────────────────────────────────
// Every manual governance check we benchmarked carries a "Political
// Affiliation" line — and fills it with "-", because there was nothing to
// search but ordinary news. There is more than news: the electoral-bond donor
// disclosures are public since the Supreme Court's 2024 judgment, and ADR's
// myneta.info holds every MP/MLA candidate affidavit. This turns the checklist
// line from a dash into an actual check — searched, and reported clear when
// clear.

const TERMS = '(politician OR MLA OR MP OR minister OR "electoral bond" OR "party donor" OR "political party")';

export const politicalCollector: Collector = async ({ subject, emit }) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "political",
    sourceName: "Political Affiliation",
    kind: "api",
  };
  const entities = entitiesOf(subject);
  if (entities.length === 0) return { ...base, status: "skipped", note: "No entities to check.", hits: [] };

  const hits: RawHit[] = [];
  const queries: string[] = [];
  let anyAnswered = false;
  let lastError: string | undefined;

  for (const e of entities.slice(0, 3)) {
    // The affidavit register first — a hit there is a candidacy, not a rumour —
    // then the broad sweep.
    for (const q of [`site:myneta.info "${e.name}"`, `"${e.name}" ${TERMS}`]) {
      queries.push(q);
      emit?.(`Checking political exposure for "${e.name}"`);
      try {
        const results = await searchWeb(q);
        anyAnswered = true;
        for (const r of results) {
          if (hits.length >= 6) break;
          const hay = `${r.title} ${r.snippet ?? ""}`;
          if (!entityMentioned(hay, e.name)) continue;
          const affidavit = (r.url ?? "").includes("myneta");
          hits.push({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
            entity: e.name,
            // Exposure to weigh, not an allegation — political links are a
            // disclosure item in diligence, not an adverse finding by
            // themselves.
            extra: { category: "political", flag: affidavit ? "candidate-affidavit" : undefined },
          });
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
      if (hits.length >= 6) break;
    }
  }

  if (!anyAnswered) {
    return { ...base, status: "error", note: `Political check unavailable: ${lastError ?? "search failed"}`, hits: [], queries };
  }
  return {
    ...base,
    status: "done",
    note:
      hits.length === 0
        ? "No political affiliation surfaced for the subject across the affidavit register and press."
        : `${hits.length} item(s) suggesting political exposure — a disclosure point to raise, not an allegation.`,
    hits,
    queries,
  };
};
