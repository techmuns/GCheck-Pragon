import type { Citation, RawHit, RenderedSection, Run, Severity } from "./types";

// ── Print-brief derivation ──────────────────────────────────────────────────
// Turns a finished Run into the fixed, decision-grade shape the one-page A4
// pre-meeting brief renders. All ranking, capping, claim-typing and honest
// empty-state handling lives here so the print component stays pure layout.
//
// Two inputs are combined:
//   • run.brief   — the analytical distillation (verdict, headline, the
//                   Key-Concerns findings, citations). AI-written when OpenAI
//                   is configured, deterministic otherwise.
//   • run.collected — the raw, structured source output (directors with DIN and
//                   tenure, court cases, filings, news, the company's CIN…),
//                   which carries far more than the flattened findings do.
//
// Nothing is fabricated: fields with no source-backed value are omitted, not
// faked, and every claim is tagged Verified / Reported / Alleged / Under review
// so an allegation is never shown as a confirmed fact.

// Hard display maximums — the visual structure is fixed regardless of dataset.
export const CAPS = {
  concerns: 4,
  people: 5,
  cases: 4,
  developments: 5,
  sources: 8,
} as const;

export type Tone = "red" | "amber" | "green" | "neutral";
export type ClaimType = "Verified" | "Reported" | "Alleged" | "Under review";

export interface PrintMetric {
  value: string;
  label: string;
  tone: Tone;
}

/** One hard fact pulled out of the underlying record — who / which authority /
 *  how much / when. Only source-backed values are emitted. */
export interface ConcernFact {
  label: string;
  value: string;
}

export interface Concern {
  severity: Severity;
  tone: Tone;
  /** Short bucket label ("Regulatory action", "Loan default") — a chip, not the
   *  headline. The headline is the specific matter itself. */
  category: string;
  /** What the issue actually is, in one specific line. */
  title: string;
  /** Who it names, which authority, how much, when — the specifics a reader
   *  needs to act on the concern without opening the source. */
  facts: ConcernFact[];
  /** The source's own words backing the title, so the claim is checkable. */
  evidence?: string;
  evidenceSource?: string;
  /** The consequence, written from this matter's stage and quantum — never a
   *  per-category platitude. */
  whyItMatters: string;
  claim: ClaimType;
  sourceRef?: number;
}

export interface Development {
  date?: string;
  headline: string;
  status: string;
  tone: Tone;
  sourceRef?: number;
}

export interface SnapshotField {
  label: string;
  value: string;
}

export interface Person {
  name: string;
  role?: string;
  tenure?: string;
  din?: string;
  flag?: string;
}

export interface CaseRow {
  date?: string;
  name: string;
  authority?: string;
  status: string;
  tone: Tone;
  sourceRef?: number;
}

export interface SourceQualityRow {
  label: string;
  count: number;
  tone: Tone;
}

export interface SourceRef {
  ref: number;
  label: string;
  url?: string;
}

export interface PrintBrief {
  company: string;
  subtitle?: string;
  isDirector: boolean;
  generatedAt: string;
  verdictSentence: string;
  pill: { label: string; tone: Tone };
  executive: string;
  metrics: PrintMetric[];
  concerns: Concern[];
  extraConcerns: number;
  developments: Development[];
  extraDevelopments: number;
  snapshot: SnapshotField[];
  people: Person[];
  extraPeople: number;
  cases: CaseRow[];
  extraCases: number;
  sourceQuality: SourceQualityRow[];
  researchGaps: string[];
  sources: SourceRef[];
  extraSources: number;
  /** ref → URL for EVERY citation, not just the ones the footer lists. Lets an
   *  inline [n] be a live link straight to the source, so a reader never has to
   *  scroll to the appendix to follow a claim. */
  sourceUrls: Record<number, string>;
  disclaimer: string;
}

const DISCLAIMER =
  "AI-assisted pre-screen based on live source data. Verify material findings before relying on them.";

const SEVERITY_TONE: Record<Severity, Tone> = {
  red: "red",
  amber: "amber",
  clear: "green",
  info: "neutral",
};

const RANK: Record<Severity, number> = { red: 3, amber: 2, clear: 1, info: 0 };

// ── Public entry point ──────────────────────────────────────────────────────

export function buildPrintBrief(run: Run, generatedAt: string): PrintBrief | null {
  const brief = run.brief;
  if (!brief) return null;

  const collected = run.collected ?? [];
  const bySource = indexBySource(collected);
  const hitByUrl = indexHitsByUrl(collected);

  const isDirector = run.subject.type === "director";
  const cin = findCin(collected);

  const concernsAll = buildConcerns(brief.sections, brief.citations, hitByUrl, run.subject);
  const concerns = concernsAll.slice(0, CAPS.concerns);
  const redFlags = concernsAll.filter((c) => c.severity === "red").length;
  const toReview = concernsAll.filter((c) => c.severity === "amber").length;

  const developmentsAll = buildDevelopments(bySource, brief.citations);
  const peopleAll = buildPeople(bySource, run.subject.promoters, isDirector);
  const casesAll = buildCases(bySource, brief.citations);

  const doneSources = run.progress.filter((p) => p.status === "done").length;
  const totalSources = run.progress.length;

  const sourcesAll = buildSources(brief.citations);

  return {
    company: run.subject.company,
    subtitle: subtitleFor(run, isDirector),
    isDirector,
    generatedAt,
    verdictSentence: brief.headline,
    pill: pillFor(brief.verdict),
    executive: buildExecutive(brief.verdict, concernsAll, doneSources, totalSources),
    metrics: buildMetrics(brief.verdict, redFlags, toReview, doneSources, totalSources),
    concerns,
    extraConcerns: Math.max(0, concernsAll.length - concerns.length),
    developments: developmentsAll.slice(0, CAPS.developments),
    extraDevelopments: Math.max(0, developmentsAll.length - CAPS.developments),
    snapshot: buildSnapshot(run, cin),
    people: peopleAll.slice(0, CAPS.people),
    extraPeople: Math.max(0, peopleAll.length - CAPS.people),
    cases: casesAll.slice(0, CAPS.cases),
    extraCases: Math.max(0, casesAll.length - CAPS.cases),
    sourceQuality: buildSourceQuality(run),
    researchGaps: buildResearchGaps(run, cin, peopleAll.length),
    sources: sourcesAll.slice(0, CAPS.sources),
    extraSources: Math.max(0, sourcesAll.length - CAPS.sources),
    sourceUrls: Object.fromEntries(
      brief.citations.filter((c) => c.url).map((c) => [c.ref, c.url as string]),
    ),
    disclaimer: DISCLAIMER,
  };
}

// ── Indexing helpers ────────────────────────────────────────────────────────

interface SourceIndex {
  [sourceId: string]: { name: string; status: string; note?: string; hits: RawHit[] } | undefined;
}

function indexBySource(collected: Run["collected"]): SourceIndex {
  const out: SourceIndex = {};
  for (const c of collected ?? []) {
    out[c.sourceId] = { name: c.sourceName, status: c.status, note: c.note, hits: c.hits };
  }
  return out;
}

interface HitRef {
  hit: RawHit;
  sourceId: string;
  sourceName: string;
}

function indexHitsByUrl(collected: Run["collected"]): Map<string, HitRef> {
  const out = new Map<string, HitRef>();
  for (const c of collected ?? []) {
    for (const h of c.hits) {
      if (h.url && !out.has(h.url)) out.set(h.url, { hit: h, sourceId: c.sourceId, sourceName: c.sourceName });
    }
  }
  return out;
}

// ── Header / verdict ─────────────────────────────────────────────────────────

function subtitleFor(run: Run, isDirector: boolean): string | undefined {
  if (isDirector) return "Individual / director pre-screen";
  const p = run.subject.promoters.filter((x) => x.trim());
  return p.length > 0 ? p.join(" · ") : undefined;
}

function pillFor(verdict: Severity): { label: string; tone: Tone } {
  switch (verdict) {
    case "red":
      return { label: "High governance risk", tone: "red" };
    case "amber":
      return { label: "Moderate — review required", tone: "amber" };
    case "clear":
      return { label: "No material risk identified", tone: "green" };
    default:
      return { label: "Limited data — incomplete", tone: "neutral" };
  }
}

function buildExecutive(
  verdict: Severity,
  concerns: Concern[],
  done: number,
  total: number,
): string {
  const action: Record<Severity, string> = {
    red: "Recommend deeper diligence and direct clarification with the principals before proceeding.",
    amber: "Clarify the flagged items with management ahead of the meeting.",
    clear: "No blocking issues for the meeting; proceed with standard confirmatory checks.",
    info: "Coverage is limited — configure the remaining sources and re-run before relying on this.",
  };

  const parts: string[] = [];

  if (verdict === "red" || verdict === "amber") {
    const top = concerns[0];
    if (top) {
      // Lead with the matter itself, not its bucket — the reader should learn
      // what the issue is from the first clause. Left capitalised: the titles
      // start with names and acronyms that must not be de-capitalised.
      parts.push(`Sharpest signal — ${stripPeriod(top.title)} (${top.claim.toLowerCase()}).`);
    }
    const n = concerns.length;
    if (n > 1) parts.push(`${n} itemised concern${n === 1 ? "" : "s"} rank above the review threshold.`);
  } else if (verdict === "clear") {
    parts.push(`${done} of ${total} configured source${total === 1 ? "" : "s"} completed and surfaced no red flags.`);
  } else {
    parts.push(`Only ${done} of ${total} source${total === 1 ? "" : "s"} returned data, so this is a partial picture.`);
  }

  parts.push(action[verdict]);
  return parts.join(" ");
}

function buildMetrics(
  verdict: Severity,
  redFlags: number,
  toReview: number,
  done: number,
  total: number,
): PrintMetric[] {
  const riskLabel: Record<Severity, string> = { red: "High", amber: "Moderate", clear: "Low", info: "Limited" };
  return [
    { value: String(redFlags), label: "Red flags", tone: redFlags > 0 ? "red" : "neutral" },
    { value: String(toReview), label: "To review", tone: toReview > 0 ? "amber" : "neutral" },
    { value: `${done}/${total}`, label: "Sources verified", tone: done > 0 ? "green" : "neutral" },
    { value: riskLabel[verdict], label: "Overall risk", tone: SEVERITY_TONE[verdict] },
  ];
}

// ── Key concerns ─────────────────────────────────────────────────────────────

// A concern has to answer, on its own: what happened, to whom, under which
// authority, how much, when, and what it means. A bucket label ("Regulatory /
// investigative matter") answers none of those, so the bucket is demoted to a
// chip and everything else is read out of the record itself.

function buildConcerns(
  sections: RenderedSection[],
  citations: Citation[],
  hitByUrl: Map<string, HitRef>,
  subject: Run["subject"],
): Concern[] {
  const summary = sections.find((s) => s.id === "red-flags");
  if (!summary) return [];

  const citationByRef = new Map(citations.map((c) => [c.ref, c]));

  const concerns: Concern[] = [];
  const seen = new Set<string>();

  for (const f of summary.findings) {
    if (f.severity !== "red" && f.severity !== "amber") continue;

    const citation = f.sourceRef !== undefined ? citationByRef.get(f.sourceRef) : undefined;
    const hitRef = citation?.url ? hitByUrl.get(citation.url) : undefined;
    const hit = hitRef?.hit;
    const sourceId = hitRef?.sourceId ?? guessSourceId(citation?.sourceName, f.text);

    const meta = classifyConcern(f.severity, sourceId, f.text, hit);
    const { title, evidence, countFact } = statementAndEvidence(f.text, hit);
    const facts = extractFacts(f.text, hit, subject, countFact);

    // Two findings can describe the same underlying matter (a news hit and the
    // court record of it). Keep the first — it ranks higher.
    const key = dedupeKey(title);
    if (seen.has(key)) continue;
    seen.add(key);

    concerns.push({
      severity: f.severity,
      tone: SEVERITY_TONE[f.severity],
      category: meta.category,
      title,
      facts,
      evidence,
      evidenceSource: evidence ? publisherOf(hitRef?.sourceName ?? citation?.sourceName ?? "") : undefined,
      whyItMatters: composeWhy(meta.stage, facts),
      claim: meta.claim,
      sourceRef: f.sourceRef,
    });
  }

  // Rank by severity (red before amber); preserve source order within a tier.
  return concerns.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
}

/** How far the matter has travelled — an open probe, a passed order and a
 *  confirmed default carry very different consequences. */
type Stage = "investigation" | "order" | "default" | "case" | "allegation" | "flag";

interface ConcernMeta {
  category: string;
  stage: Stage;
  claim: ClaimType;
}

function classifyConcern(
  severity: Severity,
  sourceId: string | undefined,
  text: string,
  hit?: RawHit,
): ConcernMeta {
  const t = `${text} ${hit?.title ?? ""} ${hit?.snippet ?? ""}`.toLowerCase();

  // Classify by the SUBSTANCE of the claim (not just its source), so a serious
  // regulatory or criminal matter reported in the press is not filed under
  // generic "adverse media". Order matters: most-specific first.
  const defaulter = sourceId === "cibil" || /defaulter|suit[- ]filed|wilful default|loan default/.test(t);
  const criminal = /\b(fraud|cbi|eow|criminal|money[ -]laundering|embezzl|arrest|charge ?sheet|scam|forgery|cheating|siphon)\b/.test(t);
  const regulatory = /\b(sfio|sebi|enforcement directorate|\bed\b|roc|registrar of companies|serious fraud|investigation|probe|raid|show cause|penalt|insolvency|nclt|ibc)\b/.test(t);
  const court = sourceId === "indiankanoon" || /\blitigation\b|court case|indian kanoon|\bcase(s)? (on|surfaced)|tribunal|high court|drt\b/.test(t);

  // An order already passed (a ban, an attachment, a penalty) is a fact; a probe
  // still running is not. Read that off the language of the record.
  const ordered = /\b(bars?|barred|banned|attach(ed|es|ment)|penalt(y|ies) (of|imposed)|imposed|convicted|disqualif|order(ed)? (against|passed)|restrain)\b/.test(t);
  const probing = /\b(prob(e|es|ing)|investigat|enquiry|inquiry|summon|questioned|raid|search(es)?|show cause|scrutin)\b/.test(t);

  if (defaulter) {
    return { category: "Loan default", stage: "default", claim: "Reported" };
  }
  if (criminal) {
    return {
      category: "Criminal / fraud matter",
      stage: ordered ? "order" : probing ? "investigation" : "allegation",
      claim: ordered ? "Reported" : "Alleged",
    };
  }
  if (regulatory) {
    return {
      category: "Regulatory action",
      stage: ordered ? "order" : "investigation",
      claim: ordered ? "Reported" : severity === "red" ? "Under review" : "Reported",
    };
  }
  if (court) {
    return { category: "Litigation on record", stage: ordered ? "order" : "case", claim: "Under review" };
  }
  if (sourceId === "filings") {
    return { category: "Exchange disclosure", stage: "flag", claim: "Verified" };
  }
  if (sourceId === "google" || /news|media|report(ed)?|article/.test(t)) {
    return {
      category: "Adverse media",
      stage: probing ? "investigation" : "allegation",
      claim: severity === "red" ? "Alleged" : "Reported",
    };
  }
  return { category: "Governance flag", stage: "flag", claim: severity === "red" ? "Alleged" : "Reported" };
}

// ── Concern specifics ────────────────────────────────────────────────────────

/** The analyst statement is the issue; the source headline is the proof. Use
 *  whichever is available for each role, and never print the same line twice. */
function statementAndEvidence(
  text: string,
  hit?: RawHit,
): { title: string; evidence?: string; countFact?: ConcernFact } {
  const statement = cleanStatement(text);
  // Court titles carry a trailing "on 8 August, 2022" — the date is a fact, not
  // part of the matter, and it survives in the facts row.
  const headline = hit?.title ? cleanStatement(splitCaseTitle(hit.title).name) : "";
  const snippet = hit?.snippet ? cleanStatement(hit.snippet) : "";

  // The deterministic summariser writes `Entity: "<headline>" — matched x, y`,
  // which is the headline wearing a hat. Prefer the headline itself then.
  const restatesHeadline = headline.length > 0 && dedupeKey(statement).includes(dedupeKey(headline));

  // "2 litigation record(s) surfaced on Indian Kanoon" tells the reader nothing
  // about the matter. When the record behind the count is available, lead with
  // it and keep the count as a fact.
  const count = statement.match(/^(\d+)\s+([a-z ]+?)\s+record\(?s?\)?\s+(?:surfaced|found)/i);
  if (count && headline) {
    return {
      title: shorten(headline, 92),
      evidence: snippet ? shorten(snippet, 92) : undefined,
      countFact: { label: "Records", value: `${count[1]} on file` },
    };
  }

  if (!statement || restatesHeadline) {
    return { title: shorten(headline || statement, 92), evidence: snippet ? shorten(snippet, 92) : undefined };
  }
  const evidence = headline || snippet;
  const duplicate = evidence && dedupeKey(evidence) === dedupeKey(statement);
  return {
    title: shorten(statement, 92),
    evidence: evidence && !duplicate ? shorten(evidence, 92) : undefined,
  };
}

/** Named authorities, longest/most specific first. The label is what a partner
 *  would recognise, not the raw match. */
const AUTHORITIES: Array<[RegExp, string]> = [
  [/serious fraud investigation office|\bsfio\b/i, "SFIO"],
  [/central bureau of investigation|\bcbi\b/i, "CBI"],
  [/enforcement directorate|\bed\b/i, "Enforcement Directorate"],
  [/securities appellate tribunal|\bsat\b/i, "Securities Appellate Tribunal"],
  [/securities and exchange board|\bsebi\b/i, "SEBI"],
  [/reserve bank|\brbi\b/i, "RBI"],
  [/\bnclat\b/i, "NCLAT"],
  [/\bnclt\b/i, "NCLT"],
  [/debts? recovery tribunal|\bdrt\b/i, "Debts Recovery Tribunal"],
  [/income tax appellate tribunal|\bitat\b/i, "Income Tax Appellate Tribunal"],
  [/tax tribunal/i, "Tax tribunal"],
  [/income[- ]tax|\bcbdt\b/i, "Income Tax department"],
  [/\bgst\b/i, "GST authority"],
  [/economic offences wing|\beow\b/i, "EOW"],
  [/competition commission|\bcci\b/i, "CCI"],
  [/registrar of companies|\broc\b|\bmca\b/i, "Registrar of Companies"],
  [/supreme court/i, "Supreme Court"],
  [/([A-Za-z]+ )?high court/i, "High Court"],
  [/\bfir\b|\bpolice\b/i, "Police / FIR"],
  // Last resorts — better than "the forum" when the record only says this much.
  [/\btribunal\b/i, "Tribunal"],
  [/\bcourt\b/i, "Court"],
];

function matchAuthority(text: string): string | undefined {
  for (const [re, label] of AUTHORITIES) {
    const m = text.match(re);
    if (!m) continue;
    // "Delhi High Court" reads better than a bare "High Court".
    if (label === "High Court" && m[1]) return shorten(`${m[1].trim()} High Court`, 34);
    return label;
  }
  return undefined;
}

/** Whoever the finding itself names wins: a statement about an ED probe must
 *  not be attributed to the court whose record happens to cite it. Only when
 *  the statement names nobody do we fall back to the record's own forum. */
function extractAuthority(statement: string, combined: string, hit?: RawHit): string | undefined {
  const named = matchAuthority(statement);
  if (named) return named;
  const court = str(hit?.extra?.court);
  if (court) return shorten(court, 34);
  return matchAuthority(combined);
}

function extractAmount(t: string): string | undefined {
  const m = t.match(/(?:rs\.?|inr|₹)\s?([\d,]+(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lacs?|billion|bn\b|million|mn\b)?/i);
  if (!m) return undefined;
  const unit = (m[2] ?? "").toLowerCase();
  const label = unit.startsWith("cr")
    ? " crore"
    : unit.startsWith("la")
      ? " lakh"
      : unit.startsWith("b")
        ? " billion"
        : unit.startsWith("m")
          ? " million"
          : "";
  return `Rs ${m[1]}${label}`;
}

/** Who the matter names — the subject itself, or a promoter/associate. The
 *  distinction changes what the reader does about it. */
function extractWho(statement: string, hit: RawHit | undefined, subject: Run["subject"]): string | undefined {
  const isDirector = subject.type === "director";
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const combined = norm(`${statement} ${hit?.title ?? ""} ${hit?.snippet ?? ""}`);
  const shortSubject = norm(subject.company).split(" ").slice(0, 2).join(" ");
  const entity = hit?.entity;

  // A named promoter beats everything — it says exactly whose matter this is.
  const promoter = subject.promoters.find(
    (p) => (entity && norm(entity) === norm(p)) || combined.includes(norm(p)),
  );
  if (promoter) return `${promoter}, promoter`;

  // The record may name a promoter without naming which one ("CBI names the
  // promoter…"). Say that, rather than misattributing it to the company.
  if (/\b(promoter|director|chairman|managing director|founder|md)\b/i.test(statement) && !isDirector) {
    return "A promoter / director";
  }

  const namesSubject =
    (entity && norm(entity).includes(shortSubject)) ||
    (shortSubject.length > 3 && combined.includes(shortSubject));
  // The subject's name is already the page title — repeating it in every card
  // costs a line and tells the reader nothing. What matters is whether the
  // matter attaches to the subject itself or to someone around it.
  if (namesSubject) return isDirector ? "The individual" : "The company itself";

  return entity ? shorten(entity, 30) : undefined;
}

function extractFacts(
  text: string,
  hit: RawHit | undefined,
  subject: Run["subject"],
  countFact?: ConcernFact,
): ConcernFact[] {
  const t = `${text} ${hit?.title ?? ""} ${hit?.snippet ?? ""}`;
  const facts: ConcernFact[] = [];

  const who = extractWho(text, hit, subject);
  if (who) facts.push({ label: "Names", value: who });

  const authority = extractAuthority(text, t, hit);
  if (authority) facts.push({ label: "Before", value: authority });

  const amount = extractAmount(t);
  if (amount) facts.push({ label: "Amount", value: amount });

  if (countFact) facts.push(countFact);

  const when = normaliseDate(hit?.date) ?? dateInText(t);
  if (when) facts.push({ label: "As of", value: when });

  // Four short facts is the row's budget at print size; more would wrap and
  // cost the card a line.
  return facts.slice(0, 4);
}

/** The consequence, written from THIS matter's stage and quantum. */
function composeWhy(stage: Stage, facts: ConcernFact[]): string {
  const value = (label: string) => facts.find((f) => f.label === label)?.value;
  const authority = value("Before");
  const amount = value("Amount");
  const names = value("Names");
  const onWhom = names ? names.replace(/,\s*promoter$/, "").replace(/^The /, "the ") : "the subject";

  switch (stage) {
    case "default":
      return `A lender has already recorded${amount ? ` ${amount} of` : ""} unpaid dues against ${onWhom} — expect it to bind fresh credit, covenants and promoter guarantees. Ask for the settlement position and the lender's current stand.`;
    case "order":
      return `${authority ?? "The authority"} has already acted, so this is decided, not alleged${amount ? ` (${amount})` : ""} — confirm what was imposed on ${onWhom}, whether it has been complied with, and whether an appeal is pending.`;
    case "investigation":
      return `${authority ?? "The authority"} has not concluded, so nothing is proven and the exposure is unquantified — get the current status of the ${amount ? `${amount} ` : ""}matter in writing before committing.`;
    case "case":
      return `Live before ${authority ?? "the forum"}, so exposure on ${onWhom} runs until judgment${amount ? ` and ${amount} is claimed` : ""} — ask for the claim amount, the defence, and the next hearing date.`;
    case "allegation":
      return `Reported but not adjudicated — treat it as unverified against ${onWhom} and check the primary record${authority ? ` with ${authority}` : ""} before relying on it.`;
    default:
      return `Flagged by the source as adverse to ${onWhom} — confirm the underlying facts and the current status before the meeting.`;
  }
}

// ── Recent developments ──────────────────────────────────────────────────────

function buildDevelopments(bySource: SourceIndex, citations: Citation[]): Development[] {
  const refByUrl = new Map(citations.filter((c) => c.url).map((c) => [c.url as string, c.ref]));
  const out: Development[] = [];
  const seen = new Set<string>();

  // Exchange filings first — they carry real dates and regulatory weight.
  const filings = bySource["filings"];
  if (filings?.status === "done") {
    for (const h of filings.hits) {
      const key = h.url ?? h.title;
      if (seen.has(key)) continue;
      seen.add(key);
      const flagged = (h.matchedKeywords?.length ?? 0) > 0;
      out.push({
        date: normaliseDate(h.date),
        headline: shorten(stripQuotes(h.title), 90),
        // One keyword: the status column shares a narrow portrait column with
        // the headline, and the headline is what carries the news.
        status: flagged ? `Flagged: ${h.matchedKeywords![0]}` : "Routine filing",
        tone: flagged ? "amber" : "neutral",
        sourceRef: h.url ? refByUrl.get(h.url) : undefined,
      });
    }
  }

  // Then press / news coverage.
  const google = bySource["google"];
  if (google?.status === "done") {
    for (const h of google.hits) {
      const key = h.url ?? h.title;
      if (seen.has(key)) continue;
      seen.add(key);
      const kws = h.matchedKeywords ?? [];
      const hard = kws.some((k) => ["fraud", "cbi", "eow", "criminal", "wilful", "defaulter"].includes(k.toLowerCase()));
      out.push({
        date: normaliseDate(h.date),
        headline: shorten(stripQuotes(h.title), 90),
        status: kws.length > 0 ? `Adverse: ${kws[0]}` : "Coverage",
        tone: hard ? "red" : kws.length > 0 ? "amber" : "neutral",
        sourceRef: h.url ? refByUrl.get(h.url) : undefined,
      });
    }
  }

  // Rank: adverse (red, then amber) before routine, keeping order within a tier.
  const toneRank: Record<Tone, number> = { red: 3, amber: 2, green: 1, neutral: 0 };
  return out.sort((a, b) => toneRank[b.tone] - toneRank[a.tone]);
}

// ── Company snapshot (available fields only, CIN-derived) ────────────────────

function buildSnapshot(run: Run, cin?: string): SnapshotField[] {
  // The subject name is already the header title, so it is not repeated here —
  // the snapshot carries only source-backed identity facts.
  const fields: SnapshotField[] = [];

  if (cin) {
    fields.push({ label: "CIN", value: cin });
    const parsed = parseCin(cin);
    if (parsed.listing) fields.push({ label: "Listing", value: parsed.listing });
    if (parsed.incorporated) fields.push({ label: "Incorporated", value: parsed.incorporated });
    if (parsed.state) fields.push({ label: "Registered", value: parsed.state });
    if (parsed.ownership) fields.push({ label: "Structure", value: parsed.ownership });
  } else if (run.subject.ticker) {
    fields.push({ label: "Listing", value: `Listed · ${run.subject.ticker.toUpperCase()}` });
  }

  return fields;
}

// ── Key people ────────────────────────────────────────────────────────────────

function buildPeople(bySource: SourceIndex, promoters: string[], isDirector: boolean): Person[] {
  const out: Person[] = [];
  const seen = new Set<string>();
  const add = (p: Person) => {
    const key = p.name.toLowerCase().trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };

  // Directors of record from the public registry — the primary board list.
  const registry = bySource["registry"];
  if (registry?.status === "done") {
    for (const h of registry.hits) {
      const name = str(h.extra?.name) ?? nameFromTitle(h.title);
      if (!name) continue;
      const tenure = str(h.extra?.tenure);
      add({
        name,
        role: str(h.extra?.designation),
        tenure: compactTenure(tenure),
        din: str(h.extra?.din),
        flag: longTenureFlag(tenure),
      });
    }
  }

  // Leadership from Wikidata (company mode only) fills gaps for larger groups.
  const wikidata = bySource["wikidata"];
  if (wikidata?.status === "done" && !isDirector) {
    for (const h of wikidata.hits) {
      // Wikidata company hits read "Name — Role".
      const [name, role] = h.title.split(" — ");
      if (name) add({ name: name.trim(), role: role?.trim() });
    }
  }

  // Promoters the user named, if not already captured by a source.
  for (const p of promoters) if (p.trim()) add({ name: p.trim(), role: "Promoter (named)" });

  return out;
}

function longTenureFlag(tenure?: string): string | undefined {
  if (!tenure) return undefined;
  const m = tenure.match(/(\d+)\s*year/i);
  if (m && Number(m[1]) >= 20) return `Unusually long tenure (${m[1]} yrs)`;
  return undefined;
}

// "23 years 5 months" → "23y 5m" so it fits the narrow tenure column.
function compactTenure(t?: string): string | undefined {
  if (!t) return undefined;
  const y = t.match(/(\d+)\s*year/i);
  const m = t.match(/(\d+)\s*month/i);
  if (y || m) return [y ? `${y[1]}y` : "", m ? `${m[1]}m` : ""].filter(Boolean).join(" ");
  return shorten(t, 12);
}

// ── Court & regulatory cases ──────────────────────────────────────────────────

function buildCases(bySource: SourceIndex, citations: Citation[]): CaseRow[] {
  const refByUrl = new Map(citations.filter((c) => c.url).map((c) => [c.url as string, c.ref]));
  const out: CaseRow[] = [];

  const ik = bySource["indiankanoon"];
  if (ik?.status === "done") {
    for (const h of ik.hits) {
      const { name, date } = splitCaseTitle(h.title);
      const authority = str(h.extra?.court);
      out.push({
        date,
        name: shorten(name, 48),
        authority: authority ? shorten(authority, 30) : undefined,
        status: caseStatus(h.title),
        tone: "amber",
        sourceRef: h.url ? refByUrl.get(h.url) : undefined,
      });
    }
  }

  // Defaulter records are regulatory matters too — surface them alongside cases.
  const cibil = bySource["cibil"];
  if (cibil?.status === "done") {
    for (const h of cibil.hits) {
      out.push({
        name: shorten(`${h.entity ? `${h.entity}: ` : ""}${h.title}`, 64),
        authority: str(h.extra?.category) ?? "CIBIL suit-filed",
        status: "On record",
        tone: "red",
        sourceRef: undefined,
      });
    }
  }

  const toneRank: Record<Tone, number> = { red: 3, amber: 2, green: 1, neutral: 0 };
  return out.sort((a, b) => toneRank[b.tone] - toneRank[a.tone]);
}

function splitCaseTitle(title: string): { name: string; date?: string } {
  // Indian Kanoon titles often end "... on 12 March, 2019".
  const m = title.match(/\son\s+(\d{1,2}\s+\w+,?\s+\d{4}|\d{4})\s*$/i);
  if (m) {
    return { name: title.slice(0, m.index).trim(), date: shortDate(m[1]) };
  }
  const y = title.match(/\b(19|20)\d{2}\b/);
  return { name: title.trim(), date: y ? y[0] : undefined };
}

// "12 March, 2019" → "12 Mar 2019"; "2019" → "2019".
function shortDate(raw: string): string {
  const m = raw.match(/(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/);
  if (m) return `${m[1]} ${m[2].slice(0, 3)} ${m[3]}`;
  return raw.replace(/,/g, "").trim();
}

function caseStatus(title: string): string {
  const t = title.toLowerCase();
  if (/\b(dismiss|acquit|disposed|quashed|withdrawn)\b/.test(t)) return "Disposed";
  if (/\b(order|judgment|judgement|decree)\b/.test(t)) return "Order";
  return "On record";
}

// ── Source quality & research gaps ────────────────────────────────────────────

// Which coverage bucket each configured source belongs to.
const SOURCE_BUCKET: Record<string, string> = {
  filings: "Official / regulatory",
  registry: "Company registry",
  wikidata: "Company registry",
  indiankanoon: "Court records",
  google: "Established news",
  cibil: "Official / regulatory",
  privatecircle: "Company registry",
};

const BUCKET_ORDER = [
  "Official / regulatory",
  "Company registry",
  "Court records",
  "Established news",
  "Low-confidence / unverified",
] as const;

function buildSourceQuality(run: Run): SourceQualityRow[] {
  const counts: Record<string, number> = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0]));

  for (const p of run.progress) {
    if (p.status !== "done") continue;
    const note = (p.note ?? "").toLowerCase();
    // A keyless fallback engine ran but its results are not high-confidence.
    if (note.includes("keyless fallback")) {
      counts["Low-confidence / unverified"] += 1;
      continue;
    }
    const bucket = SOURCE_BUCKET[p.sourceId];
    if (bucket) counts[bucket] += 1;
  }

  const toneFor = (bucket: string, n: number): Tone => {
    if (bucket === "Low-confidence / unverified") return n > 0 ? "amber" : "neutral";
    return n > 0 ? "green" : "neutral";
  };

  return BUCKET_ORDER.map((b) => ({ label: b, count: counts[b], tone: toneFor(b, counts[b]) }));
}

function buildResearchGaps(run: Run, cin: string | undefined, peopleCount: number): string[] {
  const gaps: string[] = [];

  // Sources that could not contribute — the honest coverage holes.
  for (const p of run.progress) {
    if (p.status === "locked") gaps.push(`${p.name} — not enabled (paid)`);
    else if (p.status === "error") gaps.push(`${p.name} — unavailable this run`);
  }

  if (!cin && run.subject.type !== "director") gaps.push("Registry / CIN record not located");
  if (peopleCount === 0) gaps.push("Directors not verified from a registry");

  // De-duplicate and keep the box compact.
  return Array.from(new Set(gaps)).slice(0, 3);
}

// ── Sources footer ─────────────────────────────────────────────────────────────

function buildSources(citations: Citation[]): SourceRef[] {
  return citations.map((c) => ({
    ref: c.ref,
    label: shorten(`${publisherOf(c.sourceName)} — ${stripQuotes(c.label)}`, 46),
    url: c.url,
  }));
}

function publisherOf(sourceName: string): string {
  // Trim parenthetical qualifiers ("Company Registry (Tofler)" → "Company Registry").
  return sourceName.replace(/\s*\([^)]*\)\s*/g, " ").trim();
}

// ── CIN parsing ────────────────────────────────────────────────────────────────
// CIN layout (21 chars): L | 5-digit industry | 2-char state | 4-digit year |
// 3-char ownership | 6-digit registration number. Everything derived here is a
// verifiable read of the CIN we already hold — never a guess.

const STATE_CODES: Record<string, string> = {
  AN: "Andaman & Nicobar", AP: "Andhra Pradesh", AR: "Arunachal Pradesh", AS: "Assam",
  BR: "Bihar", CH: "Chandigarh", CT: "Chhattisgarh", CG: "Chhattisgarh", DL: "Delhi",
  DN: "Dadra & Nagar Haveli", DD: "Daman & Diu", GA: "Goa", GJ: "Gujarat", HR: "Haryana",
  HP: "Himachal Pradesh", JK: "Jammu & Kashmir", JH: "Jharkhand", KA: "Karnataka",
  KL: "Kerala", LA: "Ladakh", LD: "Lakshadweep", MP: "Madhya Pradesh", MH: "Maharashtra",
  MN: "Manipur", ML: "Meghalaya", MZ: "Mizoram", NL: "Nagaland", OR: "Odisha", OD: "Odisha",
  PY: "Puducherry", PB: "Punjab", RJ: "Rajasthan", SK: "Sikkim", TN: "Tamil Nadu",
  TG: "Telangana", TS: "Telangana", TR: "Tripura", UP: "Uttar Pradesh", UT: "Uttarakhand",
  UK: "Uttarakhand", UA: "Uttarakhand", WB: "West Bengal",
};

const OWNERSHIP_CODES: Record<string, string> = {
  PLC: "Public limited", PTC: "Private limited", OPC: "One-person company",
  NPL: "Sec-8 / non-profit", GOI: "Government", GAP: "Government", GAT: "Government",
  SGC: "State government", FTC: "Foreign subsidiary", FLC: "Foreign", ULL: "Unlimited",
  ULT: "Unlimited",
};

interface ParsedCin {
  listing?: string;
  state?: string;
  incorporated?: string;
  ownership?: string;
}

function parseCin(cin: string): ParsedCin {
  const c = cin.toUpperCase();
  if (!/^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(c)) return {};
  const state = STATE_CODES[c.slice(6, 8)];
  const year = c.slice(8, 12);
  const ownership = OWNERSHIP_CODES[c.slice(12, 15)];
  return {
    listing: c[0] === "L" ? "Listed" : "Unlisted",
    state,
    incorporated: /^(19|20)\d{2}$/.test(year) ? year : undefined,
    ownership,
  };
}

function findCin(collected: Run["collected"]): string | undefined {
  for (const c of collected ?? []) {
    for (const h of c.hits) {
      const cin = str(h.extra?.cin);
      if (cin && /^[LU][0-9A-Z]{20}$/.test(cin.toUpperCase())) return cin.toUpperCase();
    }
  }
  return undefined;
}

// ── Small text utilities ────────────────────────────────────────────────────

function guessSourceId(sourceName: string | undefined, text: string): string | undefined {
  const s = `${sourceName ?? ""} ${text}`.toLowerCase();
  if (s.includes("kanoon")) return "indiankanoon";
  if (s.includes("cibil") || s.includes("defaulter")) return "cibil";
  if (s.includes("google") || s.includes("news")) return "google";
  if (s.includes("tofler") || s.includes("registry")) return "registry";
  if (s.includes("filing")) return "filings";
  return undefined;
}

/** Normalise a sentence from a finding, headline or snippet for display. */
function cleanStatement(text: string): string {
  let out = stripQuotes(text).replace(/\s+/g, " ").trim();
  // Drop a leading "Entity: " prefix the rule-based summary adds.
  out = out.replace(/^[^:]{2,40}:\s+/, (m) => (m.length < 30 ? m : ""));
  // Drop its keyword-matching tail — an internal detail, not a finding.
  out = out.replace(/\s*—\s*matched\s+[^.]*\.?$/i, "");
  return stripQuotes(out);
}

/** Comparison key for "is this the same matter?" — ignores punctuation, case
 *  and the filler words two phrasings of one event differ by. */
function dedupeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|a|an|of|in|on|at|to|for|and|is|are|has|have|been|over|its)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A date written into the prose ("on 8 August, 2022", "2019"), used when the
 *  source carried no date field of its own. */
function dateInText(t: string): string | undefined {
  const full = t.match(/\b(\d{1,2}\s+[A-Za-z]{3,9},?\s+(?:19|20)\d{2})\b/);
  if (full) return shortDate(full[1]);
  const year = t.match(/\b(19|20)\d{2}\b/);
  return year ? year[0] : undefined;
}

function stripPeriod(s: string): string {
  return s.replace(/[.\s]+$/, "");
}

function nameFromTitle(title: string): string {
  return title.split(" — ")[0]?.trim() ?? "";
}

function stripQuotes(s: string): string {
  return s.replace(/^["“'\s]+|["”'\s]+$/g, "").trim();
}

function shorten(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function normaliseDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  // Keep it short — a full ISO timestamp becomes a date.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${Number(iso[3])} ${months[Number(iso[2]) - 1] ?? ""} ${iso[1]}`.trim();
  }
  return shorten(s, 18);
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

// ── Indian number formatting ──────────────────────────────────────────────────
// Exposed for any figure the brief renders (2,00,000 not 200,000). Applied by the
// layout to counts and preserved monetary values so grouping stays consistent.

// Header timestamp — "27 Jul 2026, 14:30" from the run's ISO createdAt.
export function formatGenerated(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
