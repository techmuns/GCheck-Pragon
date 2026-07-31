import type { CollectorResult, ExcludedItem, RawHit, Subject } from "../types";
import {
  anchorsOf,
  entitiesOf,
  entityMentioned,
  gradesIdentity,
  matchKeywords,
  subjectConfidence,
  type Entity,
} from "../queries";
import { env } from "./env";
import { fetchWithTimeout, noteExcluded, stripHtml, type Collector } from "./types";
import { cached } from "../searchCache";

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

export const googleCollector: Collector = async ({ subject, keywords, emit }) => {
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
  // Results the engine returned that don't actually name the searched entity
  // (e.g. sibling brands like Reliance Digital vs Reliance Power) — dropped so
  // findings aren't misattributed. Counted for an honest note, and a sample is
  // kept so the brief can name what it looked at and set aside rather than
  // leaving the reader to wonder whether it was looked at.
  let offTarget = 0;
  const excluded: ExcludedItem[] = [];

  // Once a director subject has been resolved to an identity, hits are graded
  // rather than merely name-filtered — see `subjectConfidence`.
  const graded = gradesIdentity(subject);
  // Keyed by URL so the same article arriving from two different queries is one
  // hit, not two — and so a later, better-identified sighting can upgrade it.
  const byKey = new Map<string, RawHit>();

  const plan = queryPlan(entities, subject, kw);
  emit?.(`Planned ${plan.length} web searches via ${backend}`);
  for (let i = 0; i < plan.length; i++) {
    const { entity: e, query } = plan[i];
    ranQueries.push(query);
    // Space requests to avoid the keyless engine's burst rate-limiting.
    if (i > 0) await sleep(500);
    emit?.(`Search ${i + 1}/${plan.length} — ${query}`, { level: "query" });
    try {
      const served = await runChain(chain, query);
      const results = served.results;
      emit?.(`  ${results.length} result(s)`);
      if (served.backend !== backend) {
        emit?.(`${backend} search unavailable (${served.failure ?? "returned no results"}) — using ${served.backend}`, {
          level: "warn",
        });
        // A backend can be stepped over for either reason — it errored, or it
        // answered with nothing. Say which; "unavailable (undefined)" told the
        // reader nothing at all.
        const why = served.failure ?? "returned no results";
        degraded = `${backend} search unavailable (${why}) — fell back to ${served.backend}.`;
        backend = served.backend;
      }
      for (const r of results.slice(0, MAX_PER_ENTITY)) {
        const haystack = `${r.title} ${r.snippet ?? ""}`;
        const confidence = graded ? subjectConfidence(haystack, subject) : undefined;
        // Keep a hit that genuinely names this entity — that guards against
        // brand-family bleed (Reliance Power ≠ Reliance Digital). A hit carrying
        // the subject's own DIN or one of their companies is kept even without
        // the name: filings and orders often identify a person by id alone.
        if (!entityMentioned(haystack, e.name) && confidence !== "confirmed") {
          offTarget += 1;
          noteExcluded(excluded, {
            title: r.title,
            url: r.url,
            reason: `Does not name ${e.name} — a different entity`,
          });
          continue;
        }
        collect(byKey, {
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          entity: e.name,
          matchedKeywords: matchKeywords(haystack, kw),
          confidence,
          // Whether the subject is actually named, as distinct from whether the
          // result is on-topic. Downstream this decides both how a finding is
          // worded and whether the article is worth opening.
          extra: { namesSubject: entityMentioned(haystack, subject.company), via: "subject" },
        });
      }
    } catch (err) {
      anyError = err instanceof Error ? err.message : String(err);
      emit?.(`  search failed — ${anyError}`, { level: "warn" });
    }
  }
  // The news pass used to live here, sharing this collector's status and note.
  // It is now its own source (lib/collectors/news.ts) so that it gets its own
  // progress row, its own deadline and — the reason that matters — its own
  // error state: a dead news backend reported as part of a healthy web sweep
  // read to the user as "there is no news about this person".

  hits.push(...byKey.values());

  if (hits.length === 0 && anyError) {
    return { ...base, status: "error", note: `Search failed: ${anyError}`, hits: [], queries: ranQueries };
  }

  const filterNote =
    offTarget > 0
      ? `Filtered ${offTarget} result(s) that named a different entity (e.g. a sibling brand).`
      : undefined;
  // Say plainly how much of the sweep could be tied to *this* person. Without
  // it, a name-only hit and a DIN-confirmed one read identically in the brief.
  const unverified = hits.filter((h) => h.confidence === "unverified").length;
  const gradeNote =
    graded && unverified > 0
      ? `${hits.length - unverified} of ${hits.length} result(s) confirmed against the subject's DIN or companies; ${unverified} matched the name only.`
      : undefined;
  const note = [BACKEND_NOTE[backend], degraded, filterNote, gradeNote].filter(Boolean).join(" ") || undefined;

  return {
    ...base,
    status: "done",
    note,
    hits,
    queries: ranQueries,
    excluded,
  };
};

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * The searches this sweep will run, in order.
 *
 * Every entity gets the keyword sweep it always got. A director subject that
 * has been resolved to an identity gets two sharper ones on top:
 *   • anchored — the name AND one of the companies they actually sit on, which
 *     a namesake will not satisfy;
 *   • the DIN itself — disqualification lists, MCA notices and court orders
 *     print it verbatim, and it can belong to nobody else.
 * The plain-name query stays for recall; what it brings back is graded rather
 * than trusted, so narrowing the sweep never costs coverage.
 */
function queryPlan(entities: Entity[], subject: Subject, kw: string[]): Array<{ entity: Entity; query: string }> {
  const orClause = kw.length > 0 ? ` (${kw.join(" OR ")})` : "";
  const anchors = anchorsOf(subject);
  const plan: Array<{ entity: Entity; query: string }> = [];
  for (const entity of entities) {
    plan.push({ entity, query: `"${entity.name}"${orClause}` });
    // The extra queries identify the *subject*. A company-mode promoter has no
    // resolved identity of their own to anchor with, so they get the sweep only.
    if (subject.type !== "director" || entity.name !== subject.company) continue;
    if (anchors.length > 0) {
      plan.push({ entity, query: `"${entity.name}" (${anchors.map((a) => `"${a}"`).join(" OR ")})${orClause}` });
    }
    // No keyword clause here: any mention of the DIN is worth seeing, and
    // pairing the two would filter out the records this query exists to find.
    if (subject.din) plan.push({ entity, query: `"DIN ${subject.din}"` });
  }
  return plan;
}

/** Add a hit, folding duplicates of the same URL together. A second sighting
 *  can only improve what we know — it upgrades an unverified hit to confirmed
 *  and unions the keyword matches — never the other way round. */
function collect(byKey: Map<string, RawHit>, hit: RawHit): void {
  const key = hit.url ?? `title:${hit.title}`;
  const existing = byKey.get(key);
  if (!existing) {
    byKey.set(key, hit);
    return;
  }
  if (existing.confidence === "unverified" && hit.confidence === "confirmed") existing.confidence = "confirmed";
  existing.matchedKeywords = [...new Set([...(existing.matchedKeywords ?? []), ...(hit.matchedKeywords ?? [])])];
  if (!existing.snippet && hit.snippet) existing.snippet = hit.snippet;
}

// One retry with backoff — smooths over transient aborts / rate-limit blips.
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await sleep(1200);
    return fn();
  }
}

// A backend that answered, but with nothing in it. Not an error in itself —
// some subjects genuinely have no coverage — but not an answer worth stopping
// the chain on either, so it is thrown to fall through to the next backend and
// caught again at the bottom.
export class EmptyAnswer extends Error {
  constructor(readonly backend: Backend) {
    super("no results");
  }
}

// Walk the chain until one backend answers with something. Each gets the same
// single retry it had before; only when a backend is exhausted do we move to
// the next, so a healthy head-of-chain never pays for the fallbacks existing.
//
// An empty answer is treated as "keep walking", not as success. A keyed backend
// returning 200-with-nothing is far more often a changed response shape or a
// soft throttle than a subject the entire web is silent about — and taking it
// as success meant the chain never degraded, and (once results were cached) the
// emptiness stuck around. If EVERY backend comes back empty, that is a real
// silence and it is returned as one.
async function runChain(
  chain: Backend[],
  query: string,
): Promise<{ results: WebResult[]; backend: Backend; failure?: string }> {
  const failures: string[] = [];
  let emptyFrom: Backend | undefined;
  for (const backend of chain) {
    try {
      const results = await cached(`web:${backend}:${query}`, async () => {
        const r = await withRetry(() => runBackend(backend, query));
        // Thrown from inside the cache callback deliberately: a suspicious
        // empty must not be retained, or one bad response would be replayed
        // as "nothing found" for the rest of the window.
        if (r.length === 0) throw new EmptyAnswer(backend);
        return r;
      });
      return { results, backend, failure: failures[0] };
    } catch (err) {
      if (err instanceof EmptyAnswer) {
        emptyFrom = backend;
        continue;
      }
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  // Nothing anywhere, but nothing broke either — an honest silence.
  if (emptyFrom) return { results: [], backend: emptyFrom, failure: failures[0] };
  // Every backend is down. Report them all — the head of the chain holds the
  // actionable cause (an expired token), which a last-backend-wins message
  // would bury under the keyless engine's rate-limit notice.
  throw new Error(failures.join(" / ") || "No search backend configured.");
}

/** The web sweep as other collectors need it: full chain, cached, retried.
 *  Anything reaching for search should come through here rather than calling a
 *  single backend directly — that skips both the fallbacks and the cache. */
export async function searchWeb(query: string): Promise<WebResult[]> {
  const served = await runChain(backendChain(), query);
  return served.results;
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

// Turn a failed response into something a non-engineer can act on. The Munshot
// APIs answer 403 both for "no token sent" and "token rejected", and the body
// is the only thing that tells them apart — so it goes in the message rather
// than being thrown away.
export async function describe(res: Response): Promise<string> {
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

export function extractRows(data: unknown): unknown[] {
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
