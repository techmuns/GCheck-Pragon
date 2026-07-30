import type { CollectorResult, RawHit } from "../types";
import { entityMentioned } from "../queries";
import { hasOpenAI, hasReader } from "./env";
import { canonicalUrl, type Collector } from "./types";
import { searchWeb, sleep } from "./google";
import { readArticles } from "./reader";
import { extractProfile, profileReaderTask } from "../profile";

// ── Profile & Background collector ──────────────────────────────────────────
// The registry answers "who is this?" with a DIN; this answers it the way a
// partner means the question — the role they hold, the business behind it, the
// net worth and ranking where a source has published one, and the career facts
// that place them. It finds the subject's public profile (Forbes, Wikipedia and
// the like), reads it, and reduces it to structured, individually-cited facts.
//
// Gated on a reader AND an extractor: a profile assembled from a headline alone
// would be a guess, and a guess in a due-diligence brief is a liability. Without
// both it skips and says which is missing, in keeping with the app's rule that a
// missing capability is stated, never faked.

const MAX_READS = 3;
/** Spacing between the profile searches — the same politeness the web sweep uses. */
const SPACING_MS = 350;

interface Candidate {
  url: string;
  title: string;
  snippet?: string;
  score: number;
}

export const profileCollector: Collector = async (ctx) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "profile",
    sourceName: "Profile & Background",
    kind: "api",
  };
  const { subject, emit } = ctx;

  const name = subject.company.trim();
  if (!name) return { ...base, status: "skipped", note: "No subject to profile.", hits: [] };

  // A director we could not pin to a DIN or a company is a bare name, and a bare
  // name is exactly where a namesake's biography walks into the wrong file. Skip
  // rather than risk it — the concerns pipeline already flags the unresolved id.
  if (subject.type === "director" && !subject.din && (subject.anchors?.length ?? 0) === 0) {
    return {
      ...base,
      status: "skipped",
      note: "Identity not resolved (no DIN or associated company), so a profile is not looked up — it could belong to a namesake.",
      hits: [],
    };
  }

  if (!hasReader()) {
    return {
      ...base,
      status: "skipped",
      note: "No reader configured to open profile pages — set MUNSHOT_TOKEN or FIRECRAWL_API_KEY.",
      hits: [],
    };
  }
  if (!hasOpenAI()) {
    return {
      ...base,
      status: "skipped",
      note: "No extractor configured to structure a profile — set OPENAI_API_KEY.",
      hits: [],
    };
  }

  const isCompany = subject.type !== "director";
  const anchor = (subject.anchors ?? [])[0];
  const queries = isCompany
    ? [`"${name}" wikipedia`, `"${name}" company profile revenue employees`, `"${name}" forbes`]
    : [
        `"${name}" forbes net worth`,
        `"${name}" wikipedia`,
        anchor ? `"${name}" "${anchor}" biography` : `"${name}" biography profile`,
      ];

  emit?.(`Looking up a public profile for ${name}`);

  const candidates = new Map<string, Candidate>();
  const ran: string[] = [];
  let failure: string | undefined;
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    ran.push(q);
    if (i > 0) await sleep(SPACING_MS);
    emit?.(`Search ${i + 1}/${queries.length} — ${q}`, { level: "query" });
    try {
      const results = await searchWeb(q);
      for (const r of results) {
        if (!r.url) continue;
        const key = canonicalUrl(r.url);
        if (!key) continue;
        const score = scoreCandidate(r.url, r.title, r.snippet, name);
        if (score <= 0) continue;
        const existing = candidates.get(key);
        if (!existing || score > existing.score) {
          candidates.set(key, { url: r.url, title: r.title, snippet: r.snippet, score });
        }
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      emit?.(`  search failed — ${failure}`, { level: "warn" });
    }
  }

  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, MAX_READS);
  if (ranked.length === 0) {
    const note = failure
      ? `No profile page found (search unavailable: ${failure}).`
      : "No public profile page found for this subject.";
    return { ...base, status: failure ? "error" : "done", note, hits: [], queries: ran };
  }

  const urls = ranked.map((r) => r.url);
  emit?.(`Reading ${urls.length} profile page(s) — ${urls.map(hostOf).join(", ")}`);
  const articles = await readArticles(urls, profileReaderTask(subject), emit);
  if (articles.length === 0) {
    return {
      ...base,
      status: "done",
      note: `Found ${urls.length} profile page(s) but none could be opened.`,
      hits: [],
      queries: [...ran, ...urls],
    };
  }

  emit?.(`Read ${articles.length} page(s) — extracting the profile`);
  const profiles = await extractProfile(subject, articles, emit);

  const hits: RawHit[] = [];
  const seenHighlight = new Set<string>();
  for (const p of profiles) {
    hits.push({
      title: p.headline ?? p.role ?? `${name} — profile`,
      url: p.url,
      entity: name,
      confidence: "confirmed",
      extra: {
        category: "profile",
        role: p.role,
        employer: p.employer,
        headline: p.headline,
        bio: p.bio,
        netWorth: p.netWorth,
        worldRank: p.worldRank,
        nationality: p.nationality,
        bornYear: p.bornYear,
        education: p.education,
        foundedYear: p.foundedYear,
        revenue: p.revenue,
        employees: p.employees,
        headquarters: p.headquarters,
        sourceTitle: p.title,
      },
    });
    for (const h of p.highlights) {
      const key = h.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
      if (!key || seenHighlight.has(key)) continue;
      seenHighlight.add(key);
      hits.push({ title: h, url: p.url, entity: name, confidence: "confirmed", extra: { category: "profile-highlight" } });
    }
  }

  if (hits.length === 0) {
    return {
      ...base,
      status: "done",
      note: `Opened ${articles.length} profile page(s) but read no biographical detail about this subject.`,
      hits: [],
      queries: [...ran, ...urls],
    };
  }

  const backgroundFacts = hits.filter((h) => h.extra?.category === "profile-highlight").length;
  const note = `Read ${articles.length} profile page(s) and extracted ${backgroundFacts} background fact(s).`;
  return { ...base, status: "done", note, hits, queries: [...ran, ...urls] };
};

/**
 * How good a search result is as a profile source.
 *
 * Forbes profiles and Wikipedia articles are the canonical, structured sources
 * and are trusted on their host alone; reputable business press needs to also
 * name the subject; everything else needs the name and gets little credit. A
 * result that scores zero is dropped, so the reader is only ever spent on pages
 * likely to actually be about this person.
 */
function scoreCandidate(url: string, title: string, snippet: string | undefined, name: string): number {
  const host = hostOf(url);
  const names = entityMentioned(`${title} ${snippet ?? ""}`, name);
  let s = 0;

  if (/forbes\.com\/profile\//i.test(url)) s += 7;
  else if (/forbes\.com/i.test(host)) s += 4;
  if (/(^|\.)wikipedia\.org$/i.test(host) && /\/wiki\//i.test(url)) s += 6;
  if (/(bloomberg|reuters|business-standard|economictimes|livemint|moneycontrol|cnbc|financialexpress|thehindu|hindustantimes|forbesindia)\./i.test(host)) {
    s += names ? 3 : 0;
  }
  if (names) s += 2;

  // Aggregators, socials and file dumps restate a name without the biography a
  // read exists to recover.
  if (/(linkedin|facebook|twitter|x\.com|instagram|youtube|zaubacorp|justdial|\.pdf$)/i.test(url)) s -= 4;

  return s;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
