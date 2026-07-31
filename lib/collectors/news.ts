import type { CollectorResult, ExcludedItem, RawHit, Subject } from "../types";
import { allAnchorsOf, entitiesOf, entityMentioned, gradesIdentity, matchKeywords, subjectConfidence } from "../queries";
import { env, hasReader, maxArticleReads } from "./env";
import { canonicalUrl, fetchWithTimeout, noteExcluded, stripHtml, type Collector, type CollectorContext } from "./types";
import { EmptyAnswer, describe, extractRows, sleep, withRetry, type Backend, type WebResult } from "./google";
import { readArticles } from "./reader";
import { extractInsights, readerTask } from "../insights";
import { cachedWithMeta } from "../searchCache";

// ── News deep dive ──────────────────────────────────────────────────────────
// The old news pass ran one query per entity — the subject's name, and nothing
// else. On a person with hundreds of articles that returns whatever is most
// recent, which is almost never what a governance brief needs.
//
// What it missed is the point. Chiraag Kapil's litigation is reported as a
// Saarthi story: the headline names the company, and his name appears in the
// body. A sweep that only ever searched "Chiraag Kapil" could not find it, and
// no amount of reading further down the results would have helped. The fix is
// not a longer result list, it is asking the right questions — and the right
// questions only exist once the registry has said which companies are his.
//
// So the ladder below searches the person, the person against each company, and
// each company alone, before it ever spends a query on keywords. It is ordered
// sharpest-first because the cap truncates from the tail.

const MAX_PER_QUERY = 8;
/** Spacing between queries — the same politeness the web sweep uses. */
const SPACING_MS = 400;

export const newsCollector: Collector = async (ctx) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "news",
    sourceName: "News Deep Dive",
    kind: "api",
  };
  const { subject, keywords, emit } = ctx;

  if (newsChain().length === 0) {
    return {
      ...base,
      status: "skipped",
      note: "No news backend configured — set MUNSHOT_TOKEN or SERPAPI_KEY.",
      hits: [],
    };
  }

  const plan = queryLadder(subject, keywords);
  if (plan.length === 0) {
    return { ...base, status: "skipped", note: "No entities to search.", hits: [] };
  }

  emit?.(`Planned ${plan.length} news searches across ${new Set(plan.map((p) => p.entity)).size} entities`);

  const graded = gradesIdentity(subject);
  const byKey = new Map<string, RawHit>();
  const ran: string[] = [];
  let failure: string | undefined;
  let succeeded = 0;
  let offTarget = 0;
  // A sample of the stories set aside, so the brief can say what came up under
  // the name and why it was not counted against the subject.
  const excluded: ExcludedItem[] = [];

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    ran.push(step.query);
    if (i > 0) await sleep(SPACING_MS);

    emit?.(`Search ${i + 1}/${plan.length} — ${step.label}`, { level: "query" });
    try {
      const { results, reused } = await runNewsChain(step.query);
      succeeded += 1;
      if (reused) emit?.(`  already had this one — reused it, no search spent`, { level: "cache" });
      let kept = 0;
      for (const r of results.slice(0, MAX_PER_QUERY)) {
        const haystack = `${r.title} ${r.snippet ?? ""}`;
        const confidence = graded ? subjectConfidence(haystack, subject) : undefined;

        // Does this piece actually name the entity it was found under? A news
        // engine answers loosely, and a story about a different company is
        // worse than no story at all.
        if (!entityMentioned(haystack, step.entity) && confidence !== "confirmed") {
          offTarget += 1;
          noteExcluded(excluded, {
            title: r.title,
            url: r.url,
            reason: `Does not name ${step.entity} — a different entity`,
          });
          continue;
        }

        // Whether the SUBJECT is named, as distinct from whether the hit is
        // about their world. A company-tier story that never names the person
        // is real context and must not be written as something they did.
        const namesSubject = entityMentioned(haystack, subject.company);
        collect(byKey, {
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          entity: step.entity,
          date: r.date,
          matchedKeywords: matchKeywords(haystack, keywords),
          confidence,
          extra: { namesSubject, via: step.tier === "company" ? "company" : "subject" },
        });
        kept += 1;
      }
      emit?.(`  ${results.length} result(s), ${kept} kept`);
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      emit?.(`  search failed — ${failure}`, { level: "warn" });
    }
  }

  const hits = [...byKey.values()];

  // Every query failed: that is a broken source, and it must not be reported as
  // a quiet subject. This distinction is the whole reason news is its own source.
  if (succeeded === 0 && failure) {
    return { ...base, status: "error", note: `News search unavailable: ${failure}`, hits: [], queries: ran };
  }

  const read = await readTheImportantOnes(ctx, hits);
  hits.push(...read.hits);

  const flagged = hits.filter((h) => (h.matchedKeywords?.length ?? 0) > 0).length;
  const note =
    `${plan.length} searches across the subject and their companies; ${hits.length - read.hits.length} distinct article(s)` +
    (flagged > 0 ? `, ${flagged} matching a red-flag keyword` : "") +
    (offTarget > 0 ? `. Dropped ${offTarget} naming a different entity` : "") +
    `. ${read.note}` +
    (failure ? ` Some searches failed: ${failure}` : "");

  return { ...base, status: "done", note, hits, queries: [...ran, ...read.urls], excluded };
};

// ── Reading the ones that matter ────────────────────────────────────────────

/**
 * Open the highest-signal articles and turn them into structured findings.
 *
 * Reading is the expensive step — a fetch and an LLM call each — so it is spent
 * where the answer is most likely to change the brief: on stories that hit a
 * red-flag keyword, that are confirmed as this person's, or whose wording
 * suggests a proceeding. Everything else stays a headline, and the note says
 * how many were left that way rather than implying the whole sweep was read.
 */
async function readTheImportantOnes(
  ctx: CollectorContext,
  hits: RawHit[],
): Promise<{ hits: RawHit[]; urls: string[]; note: string }> {
  const { subject, emit } = ctx;

  if (!hasReader()) {
    return { hits: [], urls: [], note: "Articles were not opened — no reader configured, so findings are from headlines only." };
  }

  const ranked = hits
    .filter((h) => h.url)
    .map((h) => ({ hit: h, score: readScore(h) }))
    .filter((r) => r.score >= 3)
    .sort((a, b) => b.score - a.score);

  const cap = maxArticleReads();
  const chosen = ranked.slice(0, cap);
  if (chosen.length === 0) {
    return { hits: [], urls: [], note: "No article scored high enough to be worth opening." };
  }

  const skipped = ranked.length - chosen.length;
  emit?.(
    `Opening ${chosen.length} of ${hits.length} article(s)` + (skipped > 0 ? ` — ${skipped} more qualified but were over the cap of ${cap}` : ""),
  );

  const urls = chosen.map((c) => c.hit.url!);
  const articles = await readArticles(urls, readerTask(subject), emit);
  if (articles.length === 0) {
    return { hits: [], urls, note: `Tried to open ${urls.length} article(s); none could be read.` };
  }

  emit?.(`Read ${articles.length} article(s) — extracting what concerns the subject`);
  const insights = await extractInsights(subject, articles, emit);

  const byUrl = new Map(hits.map((h) => [canonicalUrl(h.url), h] as const));
  const out: RawHit[] = insights.map((insight) => {
    const origin = byUrl.get(canonicalUrl(insight.url));
    return {
      title: insight.what,
      url: insight.url,
      snippet: insight.quote,
      entity: insight.entity ?? origin?.entity,
      date: insight.date ?? origin?.date,
      matchedKeywords: origin?.matchedKeywords,
      // The article was opened and read, so attribution rests on what it says
      // rather than on whether the name happened to appear in a snippet.
      confidence: insight.role === "not_mentioned" ? origin?.confidence : "confirmed",
      extra: {
        category: "insight",
        subjectRole: insight.role,
        roleEvidence: insight.roleEvidence,
        about: insight.about,
        severity: insight.severity,
        polarity: insight.polarity,
        authority: insight.authority,
        status: insight.status,
        amount: insight.amount,
        readBy: articles.find((a) => canonicalUrl(a.url) === canonicalUrl(insight.url))?.readBy,
        sourceTitle: insight.title,
      },
    };
  });

  const note =
    `Opened ${articles.length} of ${urls.length} article(s) and extracted ${out.length} finding(s)` +
    (skipped > 0 ? `; ${skipped} further article(s) qualified but were over the read cap` : "") +
    ".";
  return { hits: out, urls, note };
}

/** Wording that means a proceeding, not merely a mention. */
const PROCEEDING =
  /allegation|complaint|\bFIR\b|police|court|suit|petition|probe|arrest|cheating|extortion|breach of trust|default|insolvency|NCLT|SEBI|\bED\b|tribunal|summons|injunction/i;

const HARD_KEYWORDS = ["fraud", "wilful", "defaulter", "cbi", "criminal", "eow"];

/** Low-signal hosts: aggregators and directories restate a headline without
 *  adding the facts a read exists to recover. */
const LOW_VALUE_HOST = /blogspot|wordpress|\.pdf$|zaubacorp|indiafilings|tofler|justdial|linkedin|facebook|twitter|x\.com/i;

function readScore(h: RawHit): number {
  const kws = h.matchedKeywords ?? [];
  const text = `${h.title} ${h.snippet ?? ""}`;
  let score = 0;

  if (kws.some((k) => HARD_KEYWORDS.includes(k.toLowerCase()))) score += 4;
  else if (kws.length > 0) score += 2;
  if (h.confidence === "confirmed") score += 2;
  if (PROCEEDING.test(text)) score += 2;
  if (h.extra?.namesSubject) score += 2;
  // Found by searching one of the subject's companies: the company IS the link,
  // so the person being absent from the headline is expected rather than
  // suspicious. This is the shape the sharpest story takes — a report that
  // names the company in the headline and the director in the body.
  if (h.extra?.via === "company") score += 1;
  // An unconfirmed hit is worth less, but only mildly: reading it is precisely
  // how we find out whether it is a namesake, and the LLM pass says so
  // explicitly when it is. Penalising it heavily would skip the article that
  // would have settled the question.
  if (h.confidence === "unverified" && !h.extra?.namesSubject) score -= 1;
  if (LOW_VALUE_HOST.test(h.url ?? "")) score -= 2;

  return score;
}

// ── The ladder ──────────────────────────────────────────────────────────────

interface Step {
  /** The entity a result must name to be kept. */
  entity: string;
  query: string;
  /** What this rung is asking about — used for attribution, not display. */
  tier: "din" | "subject" | "pair" | "company" | "keyword";
  /** Human wording for the activity log. */
  label: string;
}

/**
 * Build the whole plan up front.
 *
 * Known in advance so the log can say "search 7 of 18" rather than counting
 * blind, and so the cap truncates a plan whose order already puts the sharpest
 * questions first.
 *
 * Keywords are always combined into ONE `OR` clause per entity. Twelve keywords
 * against seven entities as separate searches would be eighty-four metered
 * calls for a single brief — the cost alone would force the sweep back to being
 * shallow, which is the problem this is meant to solve.
 */
export function queryLadder(subject: Subject, keywords: string[]): Step[] {
  const steps: Step[] = [];
  const seen = new Set<string>();
  const push = (s: Step) => {
    const key = s.query.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) return;
    seen.add(key);
    steps.push(s);
  };

  const person = subject.company.trim();
  const orClause = keywords.length > 0 ? ` (${keywords.join(" OR ")})` : "";

  if (subject.type !== "director") {
    // Company mode: the subject is the company, promoters ride alongside it.
    for (const e of entitiesOf(subject)) {
      push({ entity: e.name, query: `"${e.name}"`, tier: "subject", label: `news on ${e.name}` });
      if (orClause) {
        push({ entity: e.name, query: `"${e.name}"${orClause}`, tier: "keyword", label: `${e.name} + red-flag terms` });
      }
    }
    return steps.slice(0, maxQueries());
  }

  if (!person && !subject.din) return steps;

  // A DIN in a news story is unimpeachable — nobody else has it.
  if (subject.din) {
    push({ entity: person, query: `"DIN ${subject.din}"`, tier: "din", label: `DIN ${subject.din}` });
  }

  if (person) {
    push({ entity: person, query: `"${person}"`, tier: "subject", label: `news on ${person}` });
  }

  // The rung that finds what the old sweep could not: the person paired with
  // each company the register says is theirs.
  const companies = allAnchorsOf(subject);
  for (const company of companies) {
    push({
      entity: person,
      query: `"${person}" "${company}"`,
      tier: "pair",
      label: `${person} + ${company}`,
    });
  }

  // Then each company alone, for the stories that never name the person — the
  // company is in the brief's frame even when they are not in the headline.
  for (const company of companies) {
    push({ entity: company, query: `"${company}"`, tier: "company", label: `news on ${company}` });
  }

  if (orClause) {
    if (person) {
      push({ entity: person, query: `"${person}"${orClause}`, tier: "keyword", label: `${person} + red-flag terms` });
    }
    for (const company of companies.slice(0, 3)) {
      push({ entity: company, query: `"${company}"${orClause}`, tier: "keyword", label: `${company} + red-flag terms` });
    }
  }

  return steps.slice(0, maxQueries());
}

function maxQueries(): number {
  const raw = Number(process.env.MAX_NEWS_QUERIES);
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
}

/** Fold a repeat sighting into the hit we already have — never downgrade it. */
function collect(byKey: Map<string, RawHit>, hit: RawHit): void {
  const key = canonicalUrl(hit.url) ?? `title:${hit.title.toLowerCase()}`;
  const existing = byKey.get(key);
  if (!existing) {
    byKey.set(key, hit);
    return;
  }
  if (existing.confidence === "unverified" && hit.confidence === "confirmed") existing.confidence = "confirmed";
  existing.matchedKeywords = [...new Set([...(existing.matchedKeywords ?? []), ...(hit.matchedKeywords ?? [])])];
  if (!existing.snippet && hit.snippet) existing.snippet = hit.snippet;
  if (!existing.date && hit.date) existing.date = hit.date;
  // Being named anywhere counts: one query found the story via the company,
  // another via the person, and the second is the stronger attribution.
  if (hit.extra?.namesSubject) existing.extra = { ...existing.extra, namesSubject: true, via: "subject" };
}

// ── Backends ────────────────────────────────────────────────────────────────
//
// No keyless option, deliberately. A news sweep is only as good as the index
// behind it, and scraping one badly would produce confident nonsense — so with
// no credential this source skips and says so.

export function newsChain(): Backend[] {
  const chain: Backend[] = [];
  if (env.munshotToken) chain.push("munshot");
  if (env.serpApiKey) chain.push("serpapi");
  return chain;
}

/**
 * No date window is passed.
 *
 * Governance history does not expire. The Classplus litigation is from 2023,
 * and a "recent news" filter is exactly how a two-year-old allegation gets
 * missed by a check meant to surface it.
 */
async function runNewsChain(query: string): Promise<{ results: NewsResult[]; reused: boolean }> {
  let failure: string | undefined;
  let sawEmpty = false;
  for (const backend of newsChain()) {
    try {
      const { value, reused } = await cachedWithMeta(`news:${backend}:${query}`, async () => {
        const r = await withRetry(() => (backend === "munshot" ? searchMunshotNews(query) : searchSerpApiNews(query)));
        // Prefer a backend with something to say, and never retain an empty
        // that a changed response shape could have caused.
        if (r.length === 0) throw new EmptyAnswer(backend);
        return r;
      });
      return { results: value, reused };
    } catch (err) {
      if (err instanceof EmptyAnswer) {
        sawEmpty = true;
        continue;
      }
      failure = err instanceof Error ? err.message : String(err);
    }
  }
  // Nothing anywhere, but nothing broke — a quiet subject, not a dead source.
  if (sawEmpty) return { results: [], reused: false };
  throw new Error(failure ?? "No news backend configured.");
}

interface NewsResult extends WebResult {
  date?: string;
}

// Munshot news-search. Same auth and body shape as web-search; the response
// additionally carries a publication age, which the brief uses to date a story.
async function searchMunshotNews(query: string): Promise<NewsResult[]> {
  const res = await fetchWithTimeout(env.munshotNewsUrl, {
    method: "POST",
    timeoutMs: 20000,
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      Authorization: `Bearer ${env.munshotToken}`,
    },
    body: JSON.stringify({ query, country: env.munshotCountry }),
  });
  if (!res.ok) throw new Error(`Munshot news ${await describe(res)}`);
  return parseNews(await res.json());
}

/** The same defensive shape handling as the web parser, plus a date. */
function parseNews(data: unknown): NewsResult[] {
  return extractRows(data)
    .map((row) => {
      const o = row as Record<string, unknown>;
      const url = o.url ?? o.link ?? o.href;
      const snippet = o.description ?? o.snippet ?? o.text ?? o.desc;
      const date = o.age ?? o.page_age ?? o.published ?? o.date ?? o.published_date;
      return {
        title: String(o.title ?? o.name ?? "").trim(),
        url: url ? String(url) : undefined,
        snippet: snippet ? stripHtml(String(snippet)) : undefined,
        date: date ? String(date) : undefined,
      };
    })
    .filter((r) => r.title.length > 0 || r.url);
}

// SerpAPI's Google News engine — so the sweep survives a dead Munshot token.
async function searchSerpApiNews(query: string): Promise<NewsResult[]> {
  const url = `https://serpapi.com/search.json?engine=google_news&q=${encodeURIComponent(query)}&gl=in&hl=en&api_key=${env.serpApiKey}`;
  const res = await fetchWithTimeout(url, { timeoutMs: 20000 });
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
      snippet: o.snippet
        ? String(o.snippet)
        : typeof o.source === "object" && o.source
          ? String((o.source as Record<string, unknown>).name ?? "")
          : undefined,
      date: o.date ? String(o.date) : undefined,
    }))
    .filter((r: NewsResult) => r.title.length > 0 || r.url);
}
