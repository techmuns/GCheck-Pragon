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
  return backendChain()[0];
}

// Every configured backend, best first. The sweep walks this chain and keeps
// the first one that answers, so a dead credential degrades to the next source
// instead of taking search down. Munshot leads because it is the richest, but
// its bearer is a user session JWT that expires — the chain is what survives
// that expiry.
export function backendChain(): Backend[] {
  const chain: Backend[] = [];
  if (env.munshotToken) chain.push("munshot");
  if (env.serpApiKey) chain.push("serpapi");
  if (env.googleApiKey && env.googleCx) chain.push("programmable");
  chain.push("fallback");
  return chain;
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
  const chain = backendChain();
  // Which backend actually served the sweep — the head of the chain unless it
  // failed and a later one stepped in.
  let backend = chain[0];
  let degraded: string | undefined;
  const hits: RawHit[] = [];
  const ranQueries: string[] = [];
  let anyError: string | undefined;
  let newsError: string | undefined;
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
      const served = await runChain(chain, query);
      const results = served.results;
      if (served.backend !== backend) {
        degraded = `${backend} search unavailable (${served.failure}) — fell back to ${served.backend}.`;
        backend = served.backend;
      }
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

  // News pass — recent press per entity, for the client's "search for news on
  // the company + promoter, highlight negative press". Munshot serves this
  // best; SerpAPI's google_news engine covers it when Munshot's token is gone.
  if (newsChain().length > 0) {
    const seen = new Set(hits.map((h) => h.url).filter(Boolean) as string[]);
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      ranQueries.push(`news: ${e.name}`);
      if (i > 0) await sleep(300);
      try {
        const news = await runNewsChain(e.name);
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
        // Kept apart from the web pass's error: a news failure used to be
        // swallowed whenever the web pass had hits, so an expired token looked
        // like "no news existed" rather than "the news source was down".
        newsError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  if (hits.length === 0 && (anyError || newsError)) {
    return { ...base, status: "error", note: `Search failed: ${anyError ?? newsError}`, hits: [], queries: ranQueries };
  }

  const filterNote =
    offTarget > 0
      ? `Filtered ${offTarget} result(s) that named a different entity (e.g. a sibling brand).`
      : undefined;
  const newsNote = newsError ? `News search unavailable: ${newsError}` : undefined;
  const note = [BACKEND_NOTE[backend], degraded, newsNote, filterNote].filter(Boolean).join(" ") || undefined;

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

// Walk the chain until one backend answers. Each gets the same single retry it
// had before; only when a backend is exhausted do we move to the next, so a
// healthy head-of-chain never pays for the fallbacks existing.
async function runChain(
  chain: Backend[],
  query: string,
): Promise<{ results: WebResult[]; backend: Backend; failure?: string }> {
  const failures: string[] = [];
  for (const backend of chain) {
    try {
      const results = await withRetry(() => runBackend(backend, query));
      return { results, backend, failure: failures[0] };
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  // Every backend is down. Report them all — the head of the chain holds the
  // actionable cause (an expired token), which a last-backend-wins message
  // would bury under the keyless engine's rate-limit notice.
  throw new Error(failures.join(" / ") || "No search backend configured.");
}

// News backends, best first. Unlike the web chain there is no keyless option —
// if neither credential is present the news pass simply does not run.
function newsChain(): Backend[] {
  const chain: Backend[] = [];
  if (env.munshotToken) chain.push("munshot");
  if (env.serpApiKey) chain.push("serpapi");
  return chain;
}

async function runNewsChain(query: string): Promise<WebResult[]> {
  let failure: string | undefined;
  for (const backend of newsChain()) {
    try {
      return await withRetry(() =>
        backend === "munshot" ? searchMunshotNews(query) : searchSerpApiNews(query),
      );
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(failure ?? "No news backend configured.");
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
  if (!res.ok) throw new Error(`Munshot search ${await describe(res)}`);
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
  if (!res.ok) throw new Error(`Munshot news ${await describe(res)}`);
  return parseMunshot(await res.json());
}

// Turn a failed response into something a non-engineer can act on. The Munshot
// APIs answer 403 both for "no token sent" and "token rejected", and the body
// is the only thing that tells them apart — so it goes in the message rather
// than being thrown away.
async function describe(res: Response): Promise<string> {
  const detail = await res
    .text()
    .then((t) => {
      try {
        const parsed = JSON.parse(t) as { detail?: unknown };
        return typeof parsed.detail === "string" ? parsed.detail : t;
      } catch {
        return t;
      }
    })
    .catch(() => "");
  const hint =
    res.status === 401 || res.status === 403
      ? " — the bearer token is a user session JWT and expires; issue a fresh MUNSHOT_TOKEN or configure SERPAPI_KEY"
      : "";
  return `${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}${hint}`;
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

// SerpAPI's Google News engine — the news equivalent of searchSerpApi, so the
// news pass survives a dead Munshot token.
async function searchSerpApiNews(query: string): Promise<WebResult[]> {
  const url = `https://serpapi.com/search.json?engine=google_news&q=${encodeURIComponent(query)}&gl=in&hl=en&api_key=${env.serpApiKey}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 15000 });
  if (!res.ok) throw new Error(`SerpAPI news ${await describe(res)}`);
  const data = await res.json();
  const items = Array.isArray(data.news_results) ? data.news_results : [];
  // google_news groups related coverage under `stories`; flatten one level.
  const flat = items.flatMap((o: Record<string, unknown>) =>
    Array.isArray(o.stories) ? (o.stories as Record<string, unknown>[]) : [o],
  );
  return flat
    .map((o: Record<string, unknown>) => ({
      title: String(o.title ?? ""),
      url: o.link ? String(o.link) : undefined,
      snippet: o.snippet ? String(o.snippet) : typeof o.source === "object" && o.source
        ? String((o.source as Record<string, unknown>).name ?? "")
        : undefined,
    }))
    .filter((r: WebResult) => r.title.length > 0 || r.url);
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
