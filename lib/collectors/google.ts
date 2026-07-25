import type { CollectorResult, RawHit } from "../types";
import { entitiesOf, matchKeywords, entityMentioned } from "../queries";
import { env } from "./env";
import { fetchWithTimeout, stripHtml, type Collector } from "./types";

// ── Google / News collector ────────────────────────────────────────────────
// Sweeps each entity against the red-flag keyword set. Three backends, picked
// by which keys are configured:
//   1. SerpAPI            (SERPAPI_KEY)
//   2. Programmable Search (GOOGLE_API_KEY + GOOGLE_CX)
//   3. Keyless fallback    (DuckDuckGo HTML) — so the sweep works out of the box
//
// One combined OR-query per entity keeps request volume bounded; matched
// keywords are detected per result.

export interface WebResult {
  title: string;
  url?: string;
  snippet?: string;
}

const MAX_PER_ENTITY = 8;

export type Backend = "munshot" | "serpapi" | "programmable" | "fallback";

export function backendName(): Backend {
  if (env.munshotToken) return "munshot";
  if (env.serpApiKey) return "serpapi";
  if (env.googleApiKey && env.googleCx) return "programmable";
  return "fallback";
}

const BACKEND_NOTE: Record<Backend, string | undefined> = {
  munshot: undefined,
  serpapi: undefined,
  programmable: undefined,
  fallback: "Keyless fallback engine (blocked from most servers — set MUNSHOT_TOKEN, SERPAPI_KEY, or GOOGLE_API_KEY).",
};

export const googleCollector: Collector = async ({ subject, keywords }) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "google",
    sourceName: "Google / News",
    kind: "api",
  };

  const entities = entitiesOf(subject);
  if (entities.length === 0) {
    return { ...base, status: "skipped", note: "No entities to search.", hits: [] };
  }

  const kw = keywords.length > 0 ? keywords : [];
  const backend = backendName();
  const hits: RawHit[] = [];
  const ranQueries: string[] = [];
  let anyError: string | undefined;
  // Results the engine returned that don't actually name the searched entity
  // (e.g. sibling brands like Reliance Digital vs Reliance Power) — dropped so
  // findings aren't misattributed. Counted for an honest note.
  let offTarget = 0;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const orClause = kw.length > 0 ? ` (${kw.join(" OR ")})` : "";
    const query = `"${e.name}"${orClause}`;
    ranQueries.push(query);
    // Space requests to avoid the keyless engine's burst rate-limiting.
    if (i > 0) await sleep(500);
    try {
      const results = await withRetry(() => runBackend(backend, query));
      for (const r of results.slice(0, MAX_PER_ENTITY)) {
        const haystack = `${r.title} ${r.snippet ?? ""}`;
        // Only keep a hit that genuinely names this entity — guards against
        // brand-family bleed (Reliance Power ≠ Reliance Digital).
        if (!entityMentioned(haystack, e.name)) {
          offTarget += 1;
          continue;
        }
        hits.push({
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          entity: e.name,
          matchedKeywords: matchKeywords(haystack, kw),
        });
      }
    } catch (err) {
      anyError = err instanceof Error ? err.message : String(err);
    }
  }

  // News pass (Munshot only) — recent press per entity, for the client's
  // "search for news on the company + promoter, highlight negative press".
  if (env.munshotToken) {
    const seen = new Set(hits.map((h) => h.url).filter(Boolean) as string[]);
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      ranQueries.push(`news: ${e.name}`);
      if (i > 0) await sleep(300);
      try {
        const news = await withRetry(() => searchMunshotNews(e.name));
        for (const r of news.slice(0, MAX_PER_ENTITY)) {
          if (r.url && seen.has(r.url)) continue;
          const haystack = `${r.title} ${r.snippet ?? ""}`;
          if (!entityMentioned(haystack, e.name)) {
            offTarget += 1;
            continue;
          }
          if (r.url) seen.add(r.url);
          hits.push({ title: r.title, url: r.url, snippet: r.snippet, entity: e.name, matchedKeywords: matchKeywords(haystack, kw) });
        }
      } catch (err) {
        anyError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  if (hits.length === 0 && anyError) {
    return { ...base, status: "error", note: `Search failed: ${anyError}`, hits: [], queries: ranQueries };
  }

  const filterNote =
    offTarget > 0
      ? `Filtered ${offTarget} result(s) that named a different entity (e.g. a sibling brand).`
      : undefined;
  const note = [BACKEND_NOTE[backend], filterNote].filter(Boolean).join(" ") || undefined;

  return {
    ...base,
    status: "done",
    note,
    hits,
    queries: ranQueries,
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// One retry with backoff — smooths over transient aborts / rate-limit blips.
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await sleep(1200);
    return fn();
  }
}

export async function runBackend(backend: Backend, query: string): Promise<WebResult[]> {
  switch (backend) {
    case "munshot":
      return searchMunshot(query);
    case "serpapi":
      return searchSerpApi(query);
    case "programmable":
      return searchProgrammable(query);
    default:
      return searchDuckDuckGo(query);
  }
}

// Munshot web-search (Brave-powered). POST { query, country } with a bearer
// token. Parses the common result shapes defensively.
async function searchMunshot(query: string): Promise<WebResult[]> {
  const res = await fetchWithTimeout(env.munshotSearchUrl, {
    method: "POST",
    timeoutMs: 15000,
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      Authorization: `Bearer ${env.munshotToken}`,
    },
    body: JSON.stringify({ query, country: env.munshotCountry }),
  });
  if (!res.ok) throw new Error(`Munshot search ${res.status}`);
  const data = await res.json();
  return parseMunshot(data);
}

// Munshot news-search (recent articles). Same auth + body shape as web-search.
async function searchMunshotNews(query: string): Promise<WebResult[]> {
  const res = await fetchWithTimeout(env.munshotNewsUrl, {
    method: "POST",
    timeoutMs: 15000,
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      Authorization: `Bearer ${env.munshotToken}`,
    },
    body: JSON.stringify({ query, country: env.munshotCountry }),
  });
  if (!res.ok) throw new Error(`Munshot news ${res.status}`);
  return parseMunshot(await res.json());
}

// Handle the likely response shapes: Brave-native ({web:{results:[]}}),
// a flat {results:[]}, a bare array, or a {data:...} wrapper of any of these.
function parseMunshot(data: unknown): WebResult[] {
  const rows = extractRows(data);
  return rows
    .map((r) => {
      const o = r as Record<string, unknown>;
      const title = String(o.title ?? o.name ?? "").trim();
      const url = o.url ?? o.link ?? o.href;
      const snippet = o.description ?? o.snippet ?? o.text ?? o.desc;
      return {
        title,
        url: url ? String(url) : undefined,
        snippet: snippet ? stripHtml(String(snippet)) : undefined,
      };
    })
    .filter((r) => r.title.length > 0 || r.url);
}

function extractRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    // Unwrap a { data: ... } envelope first.
    if (o.data !== undefined) return extractRows(o.data);
    const web = o.web as Record<string, unknown> | undefined;
    if (web && Array.isArray(web.results)) return web.results;
    if (Array.isArray(o.results)) return o.results;
    if (Array.isArray(o.web_results)) return o.web_results;
  }
  return [];
}

async function searchSerpApi(query: string): Promise<WebResult[]> {
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=10&api_key=${env.serpApiKey}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);
  const data = await res.json();
  const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
  return organic.map((o: Record<string, unknown>) => ({
    title: String(o.title ?? ""),
    url: o.link ? String(o.link) : undefined,
    snippet: o.snippet ? String(o.snippet) : undefined,
  }));
}

async function searchProgrammable(query: string): Promise<WebResult[]> {
  const url = `https://www.googleapis.com/customsearch/v1?key=${env.googleApiKey}&cx=${env.googleCx}&q=${encodeURIComponent(query)}&num=10`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Programmable Search ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map((o: Record<string, unknown>) => ({
    title: String(o.title ?? ""),
    url: o.link ? String(o.link) : undefined,
    snippet: o.snippet ? String(o.snippet) : undefined,
  }));
}

// Keyless fallback — DuckDuckGo HTML endpoint. No key, ToS-tolerant for a
// bounded governance sweep. Parses the lightweight HTML result list.
async function searchDuckDuckGo(query: string): Promise<WebResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 15000 });
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
  const html = await res.text();
  // A 202 (or a body with no result anchors) is the keyless engine's
  // rate-limit challenge — surface it so the retry can back off.
  if (res.status === 202 || !html.includes("result__a")) {
    throw new Error("Keyless engine rate-limited (retry or add an API key)");
  }
  return parseDuckDuckGo(html);
}

function parseDuckDuckGo(html: string): WebResult[] {
  const results: WebResult[] = [];
  // Result anchors carry class "result__a"; snippets "result__snippet".
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(stripHtml(sm[1]));
  let lm: RegExpExecArray | null;
  let i = 0;
  while ((lm = linkRe.exec(html)) !== null) {
    results.push({
      title: stripHtml(lm[2]),
      url: decodeDuckUrl(lm[1]),
      snippet: snippets[i],
    });
    i += 1;
  }
  return results;
}

// DuckDuckGo wraps outbound links as /l/?uddg=<encoded>.
function decodeDuckUrl(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return href;
    }
  }
  return href.startsWith("//") ? `https:${href}` : href;
}
