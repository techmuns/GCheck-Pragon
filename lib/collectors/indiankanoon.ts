import type { CollectorResult, ExcludedItem, RawHit, Subject } from "../types";
import { anchorsOf, entitiesOf, entityMentioned, gradesIdentity, subjectConfidence } from "../queries";
import { env } from "./env";
import { searchWeb, withRetry } from "./google";
import { fetchWithTimeout, noteExcluded, stripHtml, type Collector } from "./types";
import { cached } from "../searchCache";
import { readArticles } from "./reader";
import { hasReader } from "./env";
import { isDefendingSide, parseJudgment, sideOf, summariseJudgment } from "./judgment";
import { readJudgmentSubstance } from "../judgmentSubstance";

// ── Indian Kanoon collector ────────────────────────────────────────────────
// Litigation search for the company and each promoter. Per the checklist:
// sort by relevance, capture the top 5 cases as heading + link.
//
// Every backend is a RUNG, not a mode. This source used to pick one backend up
// front — Munshot if its token was set — and stand or fall with it: a transient
// "Munshot search 502" then took the whole Court Cases box down with "Couldn't
// reach", even though a SerpAPI/keyless web search or the public site could have
// answered it. It now walks the backends in order until one answers, so a single
// gateway blip degrades instead of failing:
//   1. Official Indian Kanoon API      (INDIANKANOON_API_TOKEN) — most authoritative
//   2. Resilient web search, site-scoped (Munshot → SerpAPI → Google → keyless)
//   3. Public indiankanoon.org search   (keyless; blocked from most servers)

const MAX_CASES = 5;

interface CaseHit {
  title: string;
  url?: string;
  court?: string;
}

interface Strategy {
  id: string;
  label: string;
  run: (term: string) => Promise<CaseHit[]>;
}

/** The ordered backends for this run's configuration. */
function strategies(): Strategy[] {
  const out: Strategy[] = [];
  if (env.indianKanoonToken) out.push({ id: "api", label: "Indian Kanoon API", run: searchApi });
  // The resilient web sweep already chains Munshot → SerpAPI → Google → keyless,
  // cached and retried — routing through it is exactly what makes a 502 on any
  // one backend degrade to the next instead of breaking the source.
  out.push({ id: "web", label: "web search (site:indiankanoon.org)", run: searchViaWeb });
  out.push({ id: "public", label: "public indiankanoon.org search", run: searchPublic });
  return out;
}

export const indianKanoonCollector: Collector = async ({ subject, emit }) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "indiankanoon",
    sourceName: "Indian Kanoon",
    kind: "api",
  };

  const entities = entitiesOf(subject);
  if (entities.length === 0) {
    return { ...base, status: "skipped", note: "No entities to search.", hits: [] };
  }

  const chain = strategies();
  const hits: RawHit[] = [];
  const ranQueries: string[] = [];
  const errors: string[] = [];
  const servedBy = new Set<string>();
  let anyAnswered = false;
  let offTarget = 0;
  // A sample of the cases set aside, so the brief can name what it read and
  // dismissed rather than leaving a bare count the reader cannot check.
  const excluded: ExcludedItem[] = [];

  // A director subject resolved to an identity gets its litigation graded, so a
  // namesake's case can be shown without being charged to this person.
  const graded = gradesIdentity(subject);
  const seen = new Set<string>();

  for (const e of entities) {
    for (const term of searchTerms(e.name, subject)) {
      ranQueries.push(term);

      // Walk the backends until one answers. An ANSWER — even an empty one — is
      // accepted: a party with no cases is a real result, not a reason to spend
      // the next backend's quota. Only a THROW falls through to the next rung.
      let cases: CaseHit[] | undefined;
      for (const s of chain) {
        try {
          cases = await cached(`kanoon:${s.id}:${term}`, () => withRetry(() => s.run(term)));
          anyAnswered = true;
          servedBy.add(s.label);
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!errors.includes(msg)) errors.push(msg);
          emit?.(`Indian Kanoon ${s.label} unavailable (${msg}) — trying the next backend`, { level: "warn" });
        }
      }
      if (cases === undefined) continue; // every backend failed for this term

      let kept = 0;
      for (const c of cases) {
        if (kept >= MAX_CASES) break;
        const confidence = graded ? subjectConfidence(c.title, subject) : undefined;
        // Only keep cases whose title actually names this party — a relevance
        // search returns neighbouring parties (sibling brands) too. A case
        // carrying the subject's DIN or company identifies them without it.
        if (!entityMentioned(c.title, e.name) && confidence !== "confirmed") {
          offTarget += 1;
          noteExcluded(excluded, {
            title: c.title,
            url: c.url,
            reason: `Case names a different party, not ${e.name}`,
          });
          continue;
        }
        const key = c.url ?? c.title;
        if (seen.has(key)) continue;
        seen.add(key);
        kept += 1;
        hits.push({ title: c.title, url: c.url, entity: e.name, confidence, extra: { court: c.court } });
      }
    }
  }

  // A real failure is one where NOTHING answered anywhere. A subject every
  // backend agreed had no cases is "done" and quiet — never "couldn't reach".
  if (!anyAnswered && errors.length > 0) {
    return {
      ...base,
      status: "error",
      note: `Search unavailable across every backend: ${errors.join(" / ")}`,
      hits: [],
      queries: ranQueries,
    };
  }

  // ── Read the judgments, not just the cause titles ────────────────────────
  // A title says a matter exists. The judgment says which side the subject is
  // on, before which court, under which number, heard by whom — the facts the
  // meeting is actually about. Bounded: reads are metered, and the top matters
  // are the ones a partner will ask about.
  const readCount = await enrichWithJudgments(hits, subject, emit);

  const servedNote = servedBy.size > 0 ? `via ${[...servedBy].join(", ")}` : undefined;
  const readNote =
    readCount > 0 ? `Read ${readCount} judgment(s) for parties, bench and case numbers.` : undefined;
  // Some backends stumbled but another carried the search — say so, so a partial
  // degrade is visible without being alarming.
  const degradeNote = errors.length > 0 ? `Some backends were unavailable this run (${errors.join("; ")}).` : undefined;
  const filterNote = offTarget > 0 ? `Filtered ${offTarget} case(s) naming a different party.` : undefined;
  const unverified = hits.filter((h) => h.confidence === "unverified").length;
  const gradeNote =
    graded && unverified > 0
      ? `${unverified} case(s) matched the name only and are not confirmed as this director.`
      : undefined;

  return {
    ...base,
    status: "done",
    note: [servedNote, readNote, filterNote, gradeNote, degradeNote].filter(Boolean).join(" ") || undefined,
    hits,
    queries: ranQueries,
    excluded,
  };
};

/** The Indian Kanoon document id inside a /doc/<id>/ URL. */
export function kanoonDocId(url: string): string | undefined {
  return /indiankanoon\.org\/doc(?:fragment)?\/(\d+)/i.exec(url)?.[1];
}

/**
 * Scrape one judgment through Firecrawl.
 *
 * Separate from the general article reader on purpose: that reader asks for
 * main content only, which is correct for an article and destroys a judgment,
 * and it puts the Munshot reader first — a door Indian Kanoon keeps shut.
 */
async function scrapeJudgment(url: string): Promise<string | undefined> {
  return cached(`kanoon:doc:${url}`, async () => {
    const res = await fetchWithTimeout(env.firecrawlUrl, {
      method: "POST",
      timeoutMs: 45000,
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
        Authorization: `Bearer ${env.firecrawlApiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        // Keep the whole page — see the note at the call site.
        onlyMainContent: false,
        // These pages are server-rendered; a short settle is enough and keeps
        // a judgment read from costing the run half a minute.
        waitFor: 1200,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Firecrawl ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
    }
    const data = (await res.json()) as { data?: { markdown?: string } };
    const text = (data.data?.markdown ?? "").trim();
    return text.length > 200 ? text : undefined;
  });
}

/**
 * Open one judgment, by whichever door answers first.
 *
 * The general article reader was the only route here, and on a real run all
 * five reads came back unusable — Indian Kanoon actively blocks automated
 * readers, and its official API is paid. So the chain leads with a Firecrawl
 * scrape tuned for judgments, then the official API if a token ever exists,
 * then a plain page fetch, then the generic reader. Every failure is named,
 * because "could not be opened" with no reason burned a whole run of
 * debugging time.
 */
async function fetchJudgmentText(
  url: string,
  emit?: (text: string, meta?: { url?: string; level?: "step" | "skip" | "warn" }) => void,
): Promise<{ text?: string; via?: string; fail?: string }> {
  const fails: string[] = [];
  const docId = kanoonDocId(url);

  // 1. Firecrawl, called directly. Indian Kanoon blocks plain automated
  //    readers, and its official API is paid, so a rendering scraper is the
  //    route that actually works — it is the primary here rather than a last
  //    resort behind two doors that are known to be shut.
  //
  //    `onlyMainContent` is deliberately OFF. It is the right setting for a
  //    news article and the wrong one here: the cause title, the CORAM block
  //    and the case number sit in the page's header furniture, which is
  //    exactly what "main content only" throws away — and those five fields
  //    are the entire point of opening the judgment. The noise it leaves
  //    behind is what `judgmentBody()` was written to cut.
  if (env.firecrawlApiKey) {
    try {
      const text = await scrapeJudgment(url);
      if (text) {
        emit?.("Read the judgment via Firecrawl", { url, level: "step" });
        return { text, via: "Firecrawl" };
      }
      fails.push("Firecrawl returned no readable text");
    } catch (err) {
      fails.push(`Firecrawl: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    fails.push("no FIRECRAWL_API_KEY set — it is the route that reads these pages");
  }

  // 2. The official API, when a token happens to be configured. Authoritative
  //    and immune to scraper-blocking, but paid, so it is never assumed.
  if (docId && env.indianKanoonToken) {
    try {
      const res = await fetchWithTimeout(`https://api.indiankanoon.org/doc/${docId}/`, {
        method: "POST",
        timeoutMs: 20000,
        headers: { Authorization: `Token ${env.indianKanoonToken}` },
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const text = stripHtml(String(data.doc ?? ""));
      if (text.length > 200) {
        emit?.(`Read the judgment via the Indian Kanoon API`, { url, level: "step" });
        return { text, via: "the Indian Kanoon API" };
      }
      fails.push("API answered without a document");
    } catch (err) {
      fails.push(`Indian Kanoon API: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. The page itself. Free, and works from some networks; one GET to find out.
  try {
    const res = await fetchWithTimeout(url, { timeoutMs: 15000, headers: { accept: "text/html" } });
    if (!res.ok) throw new Error(`page ${res.status}`);
    const text = stripHtml(await res.text());
    if (text.length > 200) return { text, via: "the public page" };
    fails.push("page answered empty");
  } catch (err) {
    fails.push(`public page: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 4. The general article-reader chain (Munshot reader).
  if (hasReader()) {
    try {
      const articles = await readArticles(
        [url],
        "Return the judgment verbatim, including the cause title, the parties and the sides they appear on, the coram, the case number and the date.",
        (text, meta) => emit?.(text, { url: meta?.url, level: meta?.level === "warn" ? "warn" : "step" }),
      );
      const text = articles[0]?.text;
      if (text && text.length > 200) return { text, via: "the article reader" };
      fails.push("article reader returned nothing usable");
    } catch (err) {
      fails.push(`article reader: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { fail: fails.join("; ") };
}

/** How many judgments one run may open. Each costs a reader call, so this is
 *  the cost dial on the source — the cases are already ranked by relevance, so
 *  the ones read are the ones a partner is most likely to raise. */
function maxJudgmentReads(): number {
  const raw = Number(process.env.MAX_JUDGMENT_READS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5;
}

/**
 * Open the top judgments and attach what they state about themselves.
 *
 * Everything written onto the hit is read off the document — court, number,
 * date, parties, bench, counsel. Nothing is inferred, because the fact this is
 * really for is which SIDE the subject is on, and a brief that gets that
 * backwards files a company's own appeal as a case against it.
 *
 * Failures are silent by design: a judgment that will not open leaves the hit
 * exactly as the cause list gave it, which is what the brief showed before this
 * existed. Enrichment can add to a finding; it must never be able to lose one.
 */
async function enrichWithJudgments(
  hits: RawHit[],
  subject: Subject,
  emit?: (text: string, meta?: { url?: string; level?: "step" | "skip" | "warn" }) => void,
): Promise<number> {
  const targets = hits.filter((h) => h.url).slice(0, maxJudgmentReads());
  if (targets.length === 0) return 0;

  emit?.(`Opening ${targets.length} judgment(s) for the facts behind the cause title`);

  let read = 0;

  for (const hit of targets) {
    const url = hit.url as string;
    const got = await fetchJudgmentText(url, emit);
    if (!got.text) {
      // Say WHY on the hit itself, so the case row can tell the reader what
      // stood in the way instead of a bare "could not be opened" — and so a
      // failing route is diagnosable from the report alone.
      hit.extra = { ...hit.extra, readFail: got.fail };
      continue;
    }

    const facts = parseJudgment(got.text);
    if (facts.parties.length === 0 && !facts.court) {
      hit.extra = { ...hit.extra, readFail: `opened via ${got.via}, but the page did not read as a judgment` };
      continue;
    }

    const name = hit.entity ?? subject.company;
    const side = sideOf(facts, name, entityMentioned);
    read += 1;

    // The header is parsed; why the matter arose and what is at stake are prose,
    // so they are read. Amounts inside come from the text by regex rather than
    // from the model — a hallucinated figure would be quoted in a meeting as the
    // exposure. Failure here costs the substance and keeps the header.
    const substance = await readJudgmentSubstance(name, got.text, (note) =>
      emit?.(note, { level: "warn" }),
    );

    hit.extra = {
      ...hit.extra,
      // `court` already feeds the brief's authority line — prefer the court the
      // judgment names over whatever the search result guessed.
      court: facts.court ?? hit.extra?.court,
      caseNumber: facts.caseNumber,
      decidedOn: facts.decidedOn,
      side,
      defending: side ? isDefendingSide(side) : undefined,
      parties: facts.parties.map((p) => `${p.name} (${p.side})`),
      bench: facts.bench,
      counsel: facts.counsel.map((c) => `${c.side}: ${c.advocates}`),
      judgmentSummary: summariseJudgment(facts, side, name),
      dispute: substance.dispute,
      reliefSought: substance.reliefSought,
      outcome: substance.outcome,
      stake: substance.stake,
      amounts: substance.amounts,
      evidence: substance.evidence,
    };

    if (side) {
      emit?.(
        `${name} is the ${side} in ${facts.caseNumber ?? "this matter"}` +
          (facts.court ? ` before the ${facts.court}` : ""),
        { url: hit.url },
      );
    }
  }

  return read;
}

/**
 * The terms to search this party under. The name alone for a company or a
 * promoter; for a resolved director, also the DIN — which appears verbatim in
 * disqualification orders and company-petition cause titles and cannot belong
 * to a namesake — and the name paired with a company they sit on.
 *
 * The companies are also searched on their own. A cause title names the parties
 * to the suit, and when a company litigates it is the company that is named:
 * a petition filed by a director's company appears under the company, and a
 * search for the person alone will never return it.
 */
function searchTerms(name: string, subject: Subject): string[] {
  const terms = [name];
  if (subject.type !== "director" || name !== subject.company) return terms;
  if (subject.din) terms.push(`DIN ${subject.din}`);
  const anchors = anchorsOf(subject);
  if (anchors[0]) terms.push(`${name} ${anchors[0]}`);
  terms.push(...anchors);
  return [...new Set(terms)];
}

// Resilient web search scoped to Indian Kanoon — returns case pages by
// relevance. Runs through the shared chain (Munshot → SerpAPI → Google →
// keyless), so no single backend's outage can take this source down.
async function searchViaWeb(entity: string): Promise<CaseHit[]> {
  const results = await searchWeb(`site:indiankanoon.org "${entity}"`);
  return results
    .map((r) => ({ title: stripHtml(r.title ?? ""), url: r.url ?? "" }))
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
