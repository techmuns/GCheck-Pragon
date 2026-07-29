import type { CollectorResult, RawHit } from "../types";
import { entitiesOf, entityMentioned } from "../queries";
import { env } from "./env";
import { fetchWithTimeout, stripHtml, type Collector } from "./types";
import { cached } from "../searchCache";

// ── Indian Kanoon collector ────────────────────────────────────────────────
// Litigation search for the company and each promoter. Per the checklist:
// sort by relevance, capture the top 5 cases as heading + link.
//
// Backends, in priority order:
//   1. Munshot web-search scoped to site:indiankanoon.org (works from servers,
//      uses tooling we already have) — DEFAULT when MUNSHOT_TOKEN is set
//   2. Official Indian Kanoon API (INDIANKANOON_API_TOKEN)
//   3. Public indiankanoon.org search (blocked from most servers)

const MAX_CASES = 5;

export const indianKanoonCollector: Collector = async ({ subject }) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "indiankanoon",
    sourceName: "Indian Kanoon",
    kind: "api",
  };

  const entities = entitiesOf(subject);
  if (entities.length === 0) {
    return { ...base, status: "skipped", note: "No entities to search.", hits: [] };
  }

  const mode: "munshot" | "api" | "public" = env.munshotToken ? "munshot" : env.indianKanoonToken ? "api" : "public";
  const hits: RawHit[] = [];
  const ranQueries: string[] = [];
  let anyError: string | undefined;
  let offTarget = 0;

  for (const e of entities) {
    ranQueries.push(e.name);
    try {
      // Cached like the web sweep: the munshot mode spends the same metered
      // search endpoint, and a case list is the slowest-moving thing we fetch —
      // a judgment handed down mid-window is not a thing that happens.
      const cases = await cached(`kanoon:${mode}:${e.name}`, () =>
        mode === "munshot" ? searchViaMunshot(e.name) : mode === "api" ? searchApi(e.name) : searchPublic(e.name),
      );
      // Only keep cases whose title actually names this party — a relevance
      // search returns neighbouring parties (sibling brands) too.
      const relevant = cases.filter((c) => {
        if (entityMentioned(c.title, e.name)) return true;
        offTarget += 1;
        return false;
      });
      for (const c of relevant.slice(0, MAX_CASES)) {
        hits.push({ title: c.title, url: c.url, entity: e.name, extra: { court: c.court } });
      }
    } catch (err) {
      anyError = err instanceof Error ? err.message : String(err);
    }
  }

  if (hits.length === 0 && anyError) {
    return { ...base, status: "error", note: `Search failed: ${anyError}`, hits: [], queries: ranQueries };
  }

  const modeNote =
    mode === "munshot"
      ? "via Munshot web search (site:indiankanoon.org)"
      : mode === "public"
        ? "Public search (add INDIANKANOON_API_TOKEN or MUNSHOT_TOKEN for reliable results)."
        : undefined;
  const filterNote = offTarget > 0 ? `Filtered ${offTarget} case(s) naming a different party.` : undefined;

  return {
    ...base,
    status: "done",
    note: [modeNote, filterNote].filter(Boolean).join(" ") || undefined,
    hits,
    queries: ranQueries,
  };
};

interface CaseHit {
  title: string;
  url?: string;
  court?: string;
}

// Munshot web-search scoped to Indian Kanoon — returns case pages by relevance.
async function searchViaMunshot(entity: string): Promise<CaseHit[]> {
  const res = await fetchWithTimeout(env.munshotSearchUrl, {
    method: "POST",
    timeoutMs: 15000,
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      Authorization: `Bearer ${env.munshotToken}`,
    },
    body: JSON.stringify({ query: `site:indiankanoon.org "${entity}"`, country: env.munshotCountry }),
  });
  if (!res.ok) throw new Error(`Munshot search ${res.status}`);
  const data = await res.json();
  const rows: unknown[] = Array.isArray(data?.results) ? data.results : [];
  return rows
    .map((r) => {
      const o = r as Record<string, unknown>;
      const url = String(o.link ?? o.url ?? "");
      return { title: stripHtml(String(o.title ?? "")), url };
    })
    // Keep only actual case documents (/doc/), not search/listing pages.
    .filter((c) => /indiankanoon\.org\/doc\//.test(c.url) && c.title.length > 0);
}

async function searchApi(query: string): Promise<CaseHit[]> {
  const url = `https://api.indiankanoon.org/search/?formInput=${encodeURIComponent(query)}&pagenum=0`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { Authorization: `Token ${env.indianKanoonToken}` },
  });
  if (!res.ok) throw new Error(`Indian Kanoon API ${res.status}`);
  const data = await res.json();
  const docs = Array.isArray(data.docs) ? data.docs : [];
  return docs.map((d: Record<string, unknown>) => ({
    title: stripHtml(String(d.title ?? "")),
    url: d.tid ? `https://indiankanoon.org/doc/${d.tid}/` : undefined,
    court: d.docsource ? String(d.docsource) : undefined,
  }));
}

async function searchPublic(query: string): Promise<CaseHit[]> {
  const url = `https://indiankanoon.org/search/?formInput=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Indian Kanoon ${res.status}`);
  const html = await res.text();
  return parsePublic(html);
}

function parsePublic(html: string): CaseHit[] {
  const results: CaseHit[] = [];
  const re = /<div class="result_title">\s*<a href="(\/doc\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    results.push({ title: stripHtml(m[2]), url: `https://indiankanoon.org${m[1]}` });
  }
  return results;
}
