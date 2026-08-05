import type { CollectorResult, RawHit } from "../types";
import type { Collector } from "./types";
import { searchWeb } from "./google";
import { entityMentioned, entitiesOf } from "../queries";

// ── Credit rating actions ───────────────────────────────────────────────────
// Rating rationales are public, free, and written prose ABOUT governance —
// CRISIL/ICRA/CARE explain leverage, promoter conduct and liquidity in plain
// sentences. Two phrases in them are among the strongest distress signals that
// exist for an Indian private company, so they are flagged outright:
//
//   "issuer not cooperating" — the company stopped talking to its own rating
//   agency, which almost always precedes worse news; and a withdrawal or
//   downgrade, which is the agency saying it no longer stands behind the name.
//
// None of the manual governance checks we benchmarked against used this
// source. It is the cheapest depth this report gains anywhere.

const ADVERSE = /issuer not cooperating|rating withdrawn|withdraws.{0,20}rating|downgrad|default grade|\bD\b grade/i;

export const ratingsCollector: Collector = async ({ subject, emit }) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "ratings",
    sourceName: "Credit Rating Actions",
    kind: "api",
  };
  const company = entitiesOf(subject).find((e) => e.kind === "company")?.name ?? subject.company;
  if (!company.trim()) return { ...base, status: "skipped", note: "No company to look up.", hits: [] };

  const query = `"${company}" (CRISIL OR ICRA OR "CARE Ratings" OR "India Ratings") rating`;
  emit?.(`Searching rating-agency actions for "${company}"`);

  let results;
  try {
    results = await searchWeb(query);
  } catch (err) {
    return {
      ...base,
      status: "error",
      note: `Rating search failed: ${err instanceof Error ? err.message : String(err)}`,
      hits: [],
      queries: [query],
    };
  }

  const hits: RawHit[] = [];
  for (const r of results) {
    if (hits.length >= 6) break;
    const hay = `${r.title} ${r.snippet ?? ""}`;
    if (!entityMentioned(hay, company)) continue;
    const adverse = ADVERSE.exec(hay)?.[0];
    hits.push({
      title: r.title,
      url: r.url,
      snippet: r.snippet,
      entity: company,
      extra: adverse
        ? { category: "governance", flag: "rating-action", signal: adverse.toLowerCase() }
        : { category: "rating" },
    });
  }

  const flagged = hits.filter((h) => h.extra?.flag === "rating-action").length;
  return {
    ...base,
    status: "done",
    note:
      hits.length === 0
        ? "No rating-agency coverage surfaced — common for unrated private companies."
        : flagged > 0
          ? `${flagged} adverse rating action(s) — "issuer not cooperating" and withdrawals are strong distress signals.`
          : `${hits.length} rating mention(s), none adverse on their face.`,
    hits,
    queries: [query],
  };
};
