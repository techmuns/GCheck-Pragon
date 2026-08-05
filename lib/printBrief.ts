import type { Citation, ExcludedItem, Finding, PersonDiligence, RawHit, RenderedSection, Run, Severity } from "./types";
import { canonicalUrl } from "./collectors/types";
import { compareByHierarchy, seniorRole } from "./hierarchy";
import { nameFromTitle, samePerson, uniqueRefs } from "./people";
import { buildProfile } from "./profileView";
import { humanizeCaps } from "./text";
import { assessRisk, buildScope, riskMethodology, sourceTier, type Band, type RiskContribution } from "./risk";
import { buildNetwork } from "./network";

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
  // Deliberately small. Positives are context, and a page that lists as many
  // good things as concerns has quietly editorialised.
  positives: 3,
  sources: 8,
} as const;

export type Tone = "red" | "amber" | "green" | "neutral";

/** One line of genuinely good news, for the one-pager's Positive Signals block. */
export interface PositiveRow {
  text: string;
  sourceRef?: number;
}

/** A row of the Recent News table. A headline says a matter exists; the summary
 *  is what it actually said, which is the part a reader can act on. */
export interface NewsRow {
  headline: string;
  /** What the piece says, in a sentence — the read article's extracted finding
   *  where there is one, the search snippet otherwise. */
  summary?: string;
  date?: string;
  /** The publication, not the search engine that found it. */
  outlet?: string;
  tone: Tone;
  /** How this relates to the subject: read in full, name-matched only, or
   *  coverage of one of their companies that never names them. */
  attribution?: string;
  sourceRef?: number;
  url?: string;
}
export type ClaimType = "Verified" | "Reported" | "Alleged" | "Under review";

// ── Profile & Background (a second, detailed PDF page) ───────────────────────
// The one-page executive brief is full; the profile is the answer to "who is
// this?" and wants room, so it prints as its own detail page rather than
// clipping page one. Same derivation as the on-screen card (lib/profileView), so
// the two never disagree; every value keeps its citation.

export interface PrintProfileFact {
  label: string;
  value: string;
  sourceRef?: number;
}

export interface PrintProfileHighlight {
  text: string;
  sourceRef?: number;
}

export interface PrintProfile {
  role?: string;
  employer?: string;
  bio?: string;
  /** Headline figures — net worth, ranking, revenue… — shown as tiles. */
  metrics: PrintProfileFact[];
  /** Placing facts — nationality, born, education, HQ — shown as a band. */
  attributes: PrintProfileFact[];
  /** Career / background milestones. */
  highlights: PrintProfileHighlight[];
  /** How many milestones did not fit the page. */
  extraHighlights: number;
}

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
  /** The source(s) the person was read from, as citation numbers — so a board
   *  row on the page can be followed back to the record it came from. */
  sourceRefs?: number[];
}

/**
 * One entity the register holds against the subject's DIN.
 *
 * The fields are what the register actually publishes, and no more. It lists a
 * director's entities as identifier, name and status — there is no designation
 * on the page, and no record of directorships already ended, so neither is
 * offered here. The joining date comes from the other side: the company's own
 * board table carries a begin date, so it is known for the entities whose pages
 * the run had budget to open, and absent for the rest. Absent is shown as
 * absent rather than filled in.
 */
export interface DirectorshipRow {
  /** CIN for a company, LLPIN for an LLP. */
  id: string;
  name: string;
  /** "Active", "Strike Off", … in the register's own words. */
  status?: string;
  kind: "company" | "llp";
  /** When the subject joined this board, where the company page was read. */
  joinedOn?: string;
  tone: Tone;
  sourceRef?: number;
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
  /** Authority tier of the source ("Official register", "Court record", …). */
  tier?: string;
}

// ── Institutional blocks (parity with the on-screen dashboard) ───────────────

export interface PrintRisk {
  score: number;
  band: Band;
  bandLabel: string;
  tone: Tone;
  contributions: RiskContribution[];
  methodology: string[];
  coveragePartial: boolean;
  uncorroborated: boolean;
}

export interface PrintDiligencePerson {
  name: string;
  din?: string;
  role?: string;
  tenure?: string;
  status: PersonDiligence["status"];
  verdict?: Severity;
  verdictLabel: string;
  tone: Tone;
  headline?: string;
  concerns: Array<{ text: string; tone: Tone; sourceRef?: number }>;
  companies: string[];
  note?: string;
}

export interface PrintInterlock {
  company: string;
  status?: string;
  flagged: boolean;
  directors: string[];
}

export interface PrintNetwork {
  interlocks: PrintInterlock[];
  withRecord: number;
}

export interface PrintScopeLine {
  name: string;
  tierLabel: string;
  statusLabel: string;
  tone: Tone;
}

export interface PrintScope {
  statement: string;
  lines: PrintScopeLine[];
}

export interface PrintBrief {
  company: string;
  subtitle?: string;
  isDirector: boolean;
  generatedAt: string;
  verdictSentence: string;
  pill: { label: string; tone: Tone };
  executive: string;
  /** The optional second page — present only when a profile was read. */
  profile: PrintProfile | null;
  /** The scored governance risk read, shown on page one. */
  risk: PrintRisk;
  /** Per-director board diligence — the same data as the dashboard panel. */
  diligence: PrintDiligencePerson[];
  /** The board's related-party interlock network (company mode). */
  network: PrintNetwork | null;
  /** Scope & limitations — what was and was not checked, with source tiers. */
  scope: PrintScope;
  metrics: PrintMetric[];
  concerns: Concern[];
  extraConcerns: number;
  /** Honest wording for an empty concerns block, where "empty" needs explaining
   *  rather than reassuring. Set by the assembler; absent means it is clean. */
  concernsEmptyText?: string;
  developments: Development[];
  extraDevelopments: number;
  snapshot: SnapshotField[];
  people: Person[];
  extraPeople: number;
  cases: CaseRow[];
  extraCases: number;
  positives: PositiveRow[];
  extraPositives: number;
  news: NewsRow[];
  /** Every entity on the subject's DIN — the registry footprint as a table. */
  directorships: DirectorshipRow[];
  sourceQuality: SourceQualityRow[];
  researchGaps: string[];
  /** What was searched and produced nothing, and what came up and was set
   *  aside — the record that a quiet section was checked rather than skipped. */
  clarifications: PrintClarification[];
  sources: SourceRef[];
  extraSources: number;
  /** ref → URL for EVERY citation, not just the ones the footer lists. Lets an
   *  inline [n] be a live link straight to the source, so a reader never has to
   *  scroll to the appendix to follow a claim. */
  sourceUrls: Record<number, string>;
  disclaimer: string;
}

/**
 * One line of the "considered and not counted" record.
 *
 * A brief that reports only what it found cannot be told apart from one that
 * did not look. Worse, a filter that silently discards what it rejects leaves
 * every quiet section ambiguous: a subject with no court cases and a subject
 * whose four court cases all belonged to someone else read identically. This
 * is the other half of the finding — what was searched, what came back, and
 * what was deliberately not held against the subject.
 */
export interface PrintClarification {
  source: string;
  /** What the sweep did and what came of it, in one line. */
  text: string;
  /** The items it named and set aside, with the reason for each. */
  items: ExcludedItem[];
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
  const peopleAll = buildPeople(bySource, run.subject.promoters, isDirector, brief.citations);
  const casesAll = buildCases(bySource, brief.citations);
  const positivesAll = buildPositives(brief.sections);

  const doneSources = run.progress.filter((p) => p.status === "done").length;
  const totalSources = run.progress.length;

  const sourcesAll = buildSources(brief.citations);
  const risk = buildRiskBlock(run);

  return {
    company: run.subject.company,
    subtitle: subtitleFor(run, isDirector),
    isDirector,
    generatedAt,
    verdictSentence: brief.headline,
    pill: pillFor(brief.verdict),
    executive: buildExecutive(brief.verdict, concernsAll, doneSources, totalSources),
    profile: buildProfileBlock(collected, brief.citations),
    risk,
    diligence: buildDiligenceBlock(run),
    network: buildNetworkBlock(run),
    scope: buildScopeBlock(run),
    metrics: buildMetrics(risk, toReview, doneSources, totalSources),
    concerns,
    extraConcerns: Math.max(0, concernsAll.length - concerns.length),
    concernsEmptyText: brief.sections.find((s) => s.id === "red-flags")?.emptyText,
    developments: developmentsAll.slice(0, CAPS.developments),
    extraDevelopments: Math.max(0, developmentsAll.length - CAPS.developments),
    snapshot: buildSnapshot(run, cin),
    people: peopleAll.slice(0, CAPS.people),
    extraPeople: Math.max(0, peopleAll.length - CAPS.people),
    cases: casesAll.slice(0, CAPS.cases),
    extraCases: Math.max(0, casesAll.length - CAPS.cases),
    positives: positivesAll.slice(0, CAPS.positives),
    extraPositives: Math.max(0, positivesAll.length - CAPS.positives),
    news: buildNewsRows(bySource, brief.citations),
    directorships: buildDirectorships(bySource, brief.citations),
    sourceQuality: buildSourceQuality(run),
    researchGaps: buildResearchGaps(run, cin, peopleAll.length),
    clarifications: buildClarifications(run),
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

/** How much a hit is worth as the record behind a finding. A registry standing
 *  flag and the directorship row for the same company share one URL, and the
 *  flag is the one a concern is about — first-writer-wins handed back the
 *  directorship and the concern lost every fact the flag carried. */
function hitWeight(h: RawHit): number {
  const c = h.extra?.category;
  if (c === "governance") return 3;
  if (c === "insight") return 2;
  if (c === "directorship") return 0;
  return 1;
}

function indexHitsByUrl(collected: Run["collected"]): Map<string, HitRef> {
  const out = new Map<string, HitRef>();
  for (const c of collected ?? []) {
    for (const h of c.hits) {
      if (!h.url) continue;
      const existing = out.get(h.url);
      if (existing && hitWeight(existing.hit) >= hitWeight(h)) continue;
      out.set(h.url, { hit: h, sourceId: c.sourceId, sourceName: c.sourceName });
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
      const lead = stripPeriod(top.title);
      // A matter too long to state in full ends in an ellipsis; bolting the
      // claim type onto that makes a sentence that doesn't parse, so the tag is
      // added only where the sentence actually finished.
      parts.push(
        lead.endsWith("…")
          ? `Sharpest signal — ${lead}`
          : `Sharpest signal — ${lead} (${top.claim.toLowerCase()}).`,
      );
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

function buildMetrics(risk: PrintRisk, toReview: number, done: number, total: number): PrintMetric[] {
  // Red-flag count comes off the score's own contributions, so the tile and the
  // scored read below it never disagree about how many there were.
  const redFlags = risk.contributions.find((c) => c.label === "Red-flag findings");
  const redCount = redFlags?.detail?.match(/^(\d+)/)?.[1] ?? "0";
  return [
    { value: redCount, label: "Red flags", tone: Number(redCount) > 0 ? "red" : "neutral" },
    { value: String(toReview), label: "To review", tone: toReview > 0 ? "amber" : "neutral" },
    { value: `${done}/${total}`, label: "Sources verified", tone: done > 0 ? "green" : "neutral" },
    { value: `${risk.score}`, label: `Risk score · ${risk.bandLabel}`, tone: risk.tone },
  ];
}

// ── Key concerns ─────────────────────────────────────────────────────────────

// A concern has to answer, on its own: what happened, to whom, under which
// authority, how much, when, and what it means. A bucket label ("Regulatory /
// investigative matter") answers none of those, so the bucket is demoted to a
// chip and everything else is read out of the record itself.

/** Every concern a finished run surfaced, ranked, uncapped. The one-pager caps
 *  the list to what fits the page; the dashboard shows all of them — same
 *  derivation either way, so the two never disagree. */
export function listConcerns(run: Run): Concern[] {
  const brief = run.brief;
  if (!brief) return [];
  return buildConcerns(brief.sections, brief.citations, indexHitsByUrl(run.collected ?? []), run.subject);
}

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

    // A registry standing flag is built from the record itself rather than from
    // the sentence written about it. The two used to be assembled separately,
    // and when the model's wording named one company while its citation pointed
    // at another, the card printed a claim about SCOTTISH INFRATECH above
    // evidence quoting ASHOO INFRAESTATES. A card whose proof contradicts its
    // own headline is worse than no card.
    if (hit?.extra?.category === "governance") {
      const registryConcern = governanceConcern(f, hit, subject);
      const gKey = dedupeKey(registryConcern.title);
      if (seen.has(gKey)) continue;
      seen.add(gKey);
      concerns.push(registryConcern);
      continue;
    }

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

/** What kind of matter a piece of text describes. */
interface Kinds {
  defaulter: boolean;
  criminal: boolean;
  regulatory: boolean;
  court: boolean;
  /** Did anything match at all? */
  any: boolean;
}

// Classify by the SUBSTANCE of the claim (not just its source), so a serious
// regulatory or criminal matter reported in the press is not filed under
// generic "adverse media".
function kindsIn(t: string, sourceId: string | undefined): Kinds {
  const defaulter = sourceId === "cibil" || /defaulter|suit[- ]filed|wilful default|loan default/.test(t);
  const criminal = /\b(fraud|cbi|eow|criminal|money[ -]laundering|embezzl|arrest|charge ?sheet|scam|forgery|cheating|siphon)\b/.test(t);
  const regulatory = /\b(sfio|sebi|enforcement directorate|\bed\b|roc|registrar of companies|serious fraud|investigation|probe|raid|show cause|penalt|insolvency|nclt|ibc)\b/.test(t);
  const court = sourceId === "indiankanoon" || /\blitigation\b|court case|indian kanoon|\bcase(s)? (on|surfaced)|tribunal|high court|drt\b/.test(t);
  return { defaulter, criminal, regulatory, court, any: defaulter || criminal || regulatory || court };
}

function classifyConcern(
  severity: Severity,
  sourceId: string | undefined,
  text: string,
  hit?: RawHit,
): ConcernMeta {
  const statement = text.toLowerCase();
  const t = `${text} ${hit?.title ?? ""} ${hit?.snippet ?? ""}`.toLowerCase();

  // The finding's own sentence says what the matter is; the source's headline
  // and snippet only get a vote when the sentence names nothing. One stray
  // "default" in a news blurb was enough to file an ED asset seizure under Loan
  // default — and hand the reader advice about lenders for a criminal matter.
  const own = kindsIn(statement, sourceId);
  const { defaulter, criminal, regulatory, court } = own.any ? own : kindsIn(t, sourceId);

  // An order already passed (a ban, an attachment, a penalty) is a fact; a probe
  // still running is not. Read that off the language of the record — the
  // sentence first, on the same reasoning, then the record behind it.
  const stageIn = (s: string) => ({
    ordered: /\b(bars?|barred|banned|attach(ed|es|ment)|penalt(y|ies) (of|imposed)|imposed|convicted|disqualif|order(ed)? (against|passed)|restrain)\b/.test(s),
    probing: /\b(prob(e|es|ing)|investigat|enquiry|inquiry|summon|questioned|raid|search(es)?|show cause|scrutin)\b/.test(s),
  });
  const ownStage = stageIn(statement);
  const { ordered, probing } = ownStage.ordered || ownStage.probing ? ownStage : stageIn(t);

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
  if (sourceId === "google" || sourceId === "news" || /news|media|report(ed)?|article/.test(t)) {
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
      title: trimToPhrase(headline, 92),
      evidence: snippet ? trimToPhrase(snippet, 92) : undefined,
      countFact: { label: "Records", value: `${count[1]} on file` },
    };
  }

  if (!statement || restatesHeadline) {
    return { title: trimToPhrase(headline || statement, 92), evidence: snippet ? trimToPhrase(snippet, 92) : undefined };
  }
  const evidence = headline || snippet;
  const duplicate = evidence && dedupeKey(evidence) === dedupeKey(statement);
  return {
    title: trimToPhrase(statement, 92),
    evidence: evidence && !duplicate ? trimToPhrase(evidence, 92) : undefined,
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
  // The number must actually START with a digit. `[\d,]+` alone matched a bare
  // comma, so a sentence containing "Rs ," produced the amount "Rs ," — a fact
  // card asserting a figure that does not exist.
  const m = t.match(/(?:rs\.?|inr|₹)\s?(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr\b|lakhs?|lacs?|billion|bn\b|million|mn\b)?/i);
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
  // Read from the matter's own text, never from which query found it: see the
  // note on `namesSubject` below for why those are not the same question.
  const promoter = subject.promoters.find((p) => combined.includes(norm(p)));
  if (promoter) return `${promoter}, promoter`;

  // The record may name a promoter without naming which one ("CBI names the
  // promoter…"). Say that, rather than misattributing it to the company.
  if (/\b(promoter|director|chairman|managing director|founder|md)\b/i.test(statement) && !isDirector) {
    return "A promoter / director";
  }

  // Whose matter this is can only be read from the matter itself.
  //
  // `hit.entity` records which entity's QUERY produced the hit, not who the
  // hit concerns — and those come apart precisely where it matters most. A
  // director sweep searches the person, the search engine returns cases their
  // COMPANY is party to, and every one of them arrives stamped with the
  // director's name. Trusting that stamp is how "Reliance Jio Infocomm Limited
  // vs State Of Kerala" came to be reported as the individual's own exposure,
  // in a brief that then priced it into his risk score.
  const namesSubject = shortSubject.length > 3 && combined.includes(shortSubject);

  // The sweep already grades whether a director hit could be tied to this
  // person or only to their name. A hit it graded "unverified" is the namesake
  // it was warning about, so it cannot be attributed to the subject here.
  const gradedAway = isDirector && hit?.confidence === "unverified";

  // The subject's name is already the page title — repeating it in every card
  // costs a line and tells the reader nothing. What matters is whether the
  // matter attaches to the subject itself or to someone around it.
  if (namesSubject && !gradedAway) return isDirector ? "The individual" : "The company itself";

  // Not the subject's own matter. A case title names its parties, and naming
  // the real one is both true and more useful to the reader than falling back
  // to whichever query happened to surface it.
  const party = leadParty(hit?.title);
  if (party) return shorten(party, 30);

  return entity ? shorten(entity, 30) : undefined;
}

/** The first-named party of a case title, when the title reads like one —
 *  "X Ltd vs Union Of India" is X's matter, whoever searched for it. */
function leadParty(title: string | undefined): string | undefined {
  const party = title?.match(/^(.{3,80}?)\s+(?:vs\.?|versus|v\.)\s+/i)?.[1]?.trim();
  return party && party.length >= 3 ? party : undefined;
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
        headline: trimToPhrase(stripQuotes(h.title), 90),
        // One keyword: the status column shares a narrow portrait column with
        // the headline, and the headline is what carries the news.
        status: flagged ? `Flagged: ${h.matchedKeywords![0]}` : "Routine filing",
        tone: flagged ? "amber" : "neutral",
        sourceRef: h.url ? refByUrl.get(h.url) : undefined,
      });
    }
  }

  // Then press / news coverage. The dedicated news sweep leads — it carries
  // publication dates the web sweep does not — and the shared `seen` set keeps
  // a story indexed by both from appearing twice.
  for (const sourceId of ["news", "google"] as const) {
    const press = bySource[sourceId];
    if (press?.status !== "done") continue;
    for (const h of press.hits) {
      const key = canonicalUrl(h.url) ?? h.title;
      if (seen.has(key)) continue;
      seen.add(key);
      const kws = h.matchedKeywords ?? [];
      // "Adverse" is a claim about the subject, so it may only be made where
      // the item was actually tied to them. On a director run the sweep grades
      // that for us: an "unverified" hit matched the name and nothing else, and
      // may be about a different person of that name entirely. Calling it
      // adverse would put a stranger's court matter on this person's page, so
      // it is reported as a mention — which is all we know it to be.
      const attributed = h.confidence !== "unverified";
      const hard = attributed && kws.some((k) => HARD_KEYWORDS.has(k.toLowerCase()));
      out.push({
        date: normaliseDate(h.date),
        headline: trimToPhrase(stripQuotes(h.title), 90),
        status: kws.length === 0 ? "Coverage" : attributed ? `Adverse: ${kws[0]}` : `Mentions: ${kws[0]}`,
        tone: hard ? "red" : kws.length > 0 && attributed ? "amber" : "neutral",
        sourceRef: h.url ? refByUrl.get(h.url) : undefined,
      });
    }
  }

  // Rank: adverse (red, then amber) before routine, keeping order within a tier.
  const toneRank: Record<Tone, number> = { red: 3, amber: 2, green: 1, neutral: 0 };
  return out.sort((a, b) => toneRank[b.tone] - toneRank[a.tone]);
}

// ── Subject snapshot (available fields only) ─────────────────────────────────

/**
 * The identity panel, for whichever kind of subject this run has.
 *
 * A director run used to be handed the first CIN found anywhere in the
 * collected data — which is a company the person sits on, not the person — and
 * printed it under the heading "Company Snapshot" directly beneath their name.
 * A reader has every reason to take a CIN printed under a person's name as
 * that person's registration, and it never was one.
 *
 * So the panel now answers the question the run actually asked: for a company,
 * the company's registration; for a director, the registry identity that
 * settles WHICH person of that name this brief covers.
 */
function buildSnapshot(run: Run, cin?: string): SnapshotField[] {
  // The subject name is already the header title, so it is not repeated here —
  // the snapshot carries only source-backed identity facts.
  const fields: SnapshotField[] = [];

  if (run.subject.type === "director") return directorSnapshot(run);

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

/**
 * A director subject's registry identity: the DIN, its standing on the
 * register, and how many entities the register has against it.
 *
 * Read from the registry collector's own identity hit rather than from
 * `subject.din`, because the two can disagree — the pre-fan-out lookup is time
 * boxed and the collector is not, so a run can carry a DIN the subject never
 * received. Falling back to `subject.din` covers the reverse case.
 */
function directorSnapshot(run: Run): SnapshotField[] {
  const identity = registryIdentityHit(run.collected ?? []);
  const fields: SnapshotField[] = [];

  const din = str(identity?.extra?.din) || run.subject.din;
  if (din) fields.push({ label: "DIN", value: din });

  const status = str(identity?.extra?.dinStatus);
  if (status) fields.push({ label: "DIN status", value: humanizeCaps(status) });

  const approved = str(identity?.extra?.approvedOn);
  if (approved) fields.push({ label: "On register since", value: approved });

  const entities = (run.collected ?? [])
    .flatMap((c) => c.hits)
    .filter((h) => h.extra?.category === "directorship").length;
  if (entities > 0) fields.push({ label: "Entities on record", value: String(entities) });

  return fields;
}

/** The sources that publish a registry identity, best first. */
const REGISTRY_IDS = ["indiafilings", "registry"] as const;

/** The registry collector's record of WHO the subject is, if it resolved one. */
function registryIdentityHit(collected: Run["collected"]): RawHit | undefined {
  for (const c of collected ?? []) {
    if (!REGISTRY_IDS.includes(c.sourceId as (typeof REGISTRY_IDS)[number])) continue;
    const hit = c.hits.find((h) => h.extra?.category === "identity" && str(h.extra?.din));
    if (hit) return hit;
  }
  return undefined;
}

// ── Key people ────────────────────────────────────────────────────────────────

function buildPeople(
  bySource: SourceIndex,
  promoters: string[],
  isDirector: boolean,
  citations: Citation[],
): Person[] {
  const refByUrl = new Map(citations.filter((c) => c.url).map((c) => [c.url as string, c.ref]));
  const out: Person[] = [];

  // Merge rather than skip: the registry's "Mukesh Dhirubhai Ambani" and
  // Wikidata's "Mukesh Ambani" are one director, and on a five-row table the
  // second row would cost a real one its place (lib/people). The first row seen
  // keeps the line, which is why the registry — the richest source, with the DIN
  // and the tenure — is read first.
  const add = (p: Person) => {
    const name = p.name.trim();
    if (!name) return;
    const existing = out.find((q) => samePerson(q, p));
    if (!existing) {
      out.push({ ...p, name });
      return;
    }
    existing.din ??= p.din;
    existing.tenure ??= p.tenure;
    existing.flag ??= p.flag;
    // One role column, so it names the most senior office anyone gives them.
    existing.role = seniorRole(existing.role, p.role);
    existing.sourceRefs = uniqueRefs([...(existing.sourceRefs ?? []), ...(p.sourceRefs ?? [])]);
  };

  // Directors of record from the public registry — the primary board list.
  const registry = bySource["registry"];
  if (registry?.status === "done") {
    for (const h of registry.hits) {
      // Only rows that describe a PERSON on a board. A directorship row
      // describes an entity, and carries the subject's own name in `name` —
      // read as a person it put the subject into their own list of associated
      // people, which is how a director brief came to name one person: the one
      // it was about.
      if (h.extra?.category !== "director") continue;
      const name = str(h.extra?.name) ?? nameFromTitle(h.title);
      if (!name) continue;
      const tenure = str(h.extra?.tenure);
      add({
        name: humanizeCaps(name) || name,
        role: str(h.extra?.designation),
        tenure: compactTenure(tenure),
        din: str(h.extra?.din),
        flag: longTenureFlag(tenure),
        sourceRefs: uniqueRefs([h.url ? refByUrl.get(h.url) : undefined]),
      });
    }
  }

  // Leadership from Wikidata (company mode only) fills gaps for larger groups.
  const wikidata = bySource["wikidata"];
  if (wikidata?.status === "done" && !isDirector) {
    for (const h of wikidata.hits) {
      // Wikidata company hits read "Name — Role".
      const [name, role] = h.title.split(" — ");
      if (name) {
        add({
          name: name.trim(),
          role: role?.trim(),
          sourceRefs: uniqueRefs([h.url ? refByUrl.get(h.url) : undefined]),
        });
      }
    }
  }

  // Promoters the user named, if not already captured by a source.
  for (const p of promoters) if (p.trim()) add({ name: p.trim(), role: "Promoter (named)" });

  // Ordered by office, not by which collector answered first — and because the
  // page has room for five rows, this is also what decides who makes the page:
  // the Managing Director, not the fifth independent director. (lib/hierarchy)
  return out.sort(compareByHierarchy);
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

/**
 * The Positive Signals section, taken straight from the assembled brief.
 *
 * Read from the section rather than re-derived from hits, so the page and the
 * screen cannot disagree about what counts as good news — the previous split
 * between the two derivations is exactly how the surfaces drifted apart.
 */
function buildPositives(sections: RenderedSection[]): PositiveRow[] {
  const section = sections.find((s) => s.id === "positives");
  if (!section || section.empty) return [];
  return section.findings
    .filter((f) => f.text.trim().length > 0)
    .map((f) => ({ text: trimToPhrase(stripQuotes(f.text), 110), sourceRef: f.sourceRef }));
}

/**
 * The Profile & Background detail page, derived from the collector's own hits.
 *
 * Read through lib/profileView so the printed page and the on-screen card share
 * one derivation — a net worth cannot read one way on screen and another on
 * paper. Each value is matched back to its citation by the URL it was read from,
 * so every fact on the page carries a live [n] to its own source. Returns null
 * when no profile was read, so the second page simply does not print.
 */
function buildProfileBlock(collected: Run["collected"], citations: Citation[]): PrintProfile | null {
  const hits = (collected ?? []).find((c) => c.sourceId === "profile")?.hits ?? [];
  const view = buildProfile(hits);
  if (!view) return null;

  const refByUrl = new Map(citations.filter((c) => c.url).map((c) => [c.url as string, c.ref]));
  const ref = (url?: string) => (url ? refByUrl.get(url) : undefined);

  // Bounded, not capped to a handful: this is the detailed page, but a runaway
  // list still must not overflow a fixed sheet.
  const HIGHLIGHT_CAP = 12;
  const highlights = view.highlights
    .slice(0, HIGHLIGHT_CAP)
    .map((h) => ({ text: trimToPhrase(stripQuotes(h.text), 200), sourceRef: ref(h.url) }));

  return {
    role: view.role,
    employer: view.employer,
    bio: view.bio ? trimToPhrase(view.bio, 600) : undefined,
    metrics: view.metrics.map((m) => ({ label: m.label, value: m.value, sourceRef: ref(m.url) })),
    attributes: view.attributes.map((m) => ({ label: m.label, value: m.value, sourceRef: ref(m.url) })),
    highlights,
    extraHighlights: Math.max(0, view.highlights.length - highlights.length),
  };
}

// ── Institutional blocks ─────────────────────────────────────────────────────
// The dashboard's risk score, board diligence, network and scope, mapped to the
// fixed print shapes. Same derivations as the screen (lib/risk, lib/network), so
// the exported report says exactly what the dashboard did — nothing on screen is
// left out of the file.

const BAND_LABEL: Record<Band, string> = { high: "High", elevated: "Elevated", moderate: "Moderate", low: "Low" };
const BAND_TONE: Record<Band, Tone> = { high: "red", elevated: "amber", moderate: "amber", low: "green" };

function buildRiskBlock(run: Run): PrintRisk {
  const r = assessRisk(run);
  return {
    score: r.score,
    band: r.band,
    bandLabel: BAND_LABEL[r.band],
    tone: BAND_TONE[r.band],
    contributions: r.contributions.slice(0, 7),
    methodology: riskMethodology(),
    coveragePartial: r.coverage.partial,
    uncorroborated: r.uncorroborated,
  };
}

const DILIGENCE_VERDICT_LABEL: Record<Severity, string> = {
  red: "Red flag",
  amber: "Review",
  clear: "Clear",
  info: "Unresolved",
};

function buildDiligenceBlock(run: Run): PrintDiligencePerson[] {
  const people = run.diligence ?? [];
  const urlByRef = new Map(run.brief?.citations.filter((c) => c.url).map((c) => [c.url as string, c.ref]) ?? []);
  return people.map((p) => {
    const v = p.verdict ?? "info";
    return {
      name: p.name,
      din: p.din,
      role: p.role,
      tenure: p.tenure,
      status: p.status,
      verdict: p.verdict,
      verdictLabel: p.status === "error" ? "n/a" : p.status !== "done" ? "checking" : DILIGENCE_VERDICT_LABEL[v],
      tone: p.status === "done" ? SEVERITY_TONE[v] : "neutral",
      headline: p.headline,
      concerns: p.concerns.map((c) => ({
        text: trimToPhrase(stripQuotes(c.text), 150),
        tone: SEVERITY_TONE[c.severity],
        sourceRef: c.url ? urlByRef.get(c.url) : undefined,
      })),
      companies: (p.companies ?? []).map((c) => c.name).slice(0, 8),
      note: p.note,
    };
  });
}

function buildNetworkBlock(run: Run): PrintNetwork | null {
  const net = buildNetwork(run);
  if (!net || net.interlocks.length === 0) return null;
  return {
    withRecord: net.withRecord,
    interlocks: net.interlocks.map((i) => ({
      company: i.company,
      status: i.status,
      flagged: i.flagged,
      directors: i.directors,
    })),
  };
}

function buildScopeBlock(run: Run): PrintScope {
  const scope = buildScope(run);
  const toneOf = (status: string): Tone =>
    status === "covered" ? "green" : status === "partial" ? "amber" : status === "upgrade" ? "amber" : "neutral";
  const label: Record<string, string> = {
    covered: "Covered",
    partial: "Partial",
    "not-run": "Not run",
    upgrade: "Upgrade",
  };
  return {
    statement: scope.statement,
    lines: scope.lines.map((l) => ({
      name: l.name,
      tierLabel: l.tierLabel,
      statusLabel: label[l.status] ?? l.status,
      tone: toneOf(l.status),
    })),
  };
}

/**
 * A registry standing flag, written from the record.
 *
 * The old card said "Flagged by the source as adverse to the individual —
 * confirm the underlying facts", three times over, which tells a reader
 * nothing they could act on. Everything below is a fact the register actually
 * published and this pipeline already fetched: which company, its CIN, where
 * it is registered, when it was incorporated, when the subject joined its
 * board, and when it last filed. That is the who / what / where / when a
 * partner needs to open the conversation.
 */
function governanceConcern(f: Finding, hit: RawHit, subject: Run["subject"]): Concern {
  const x = hit.extra ?? {};
  const company = str(x.company) ?? "This company";
  const status = str(x.status) ?? "not in good standing";
  const person = str(x.person) ?? subject.company;

  const facts: ConcernFact[] = [];
  const add = (label: string, value?: string) => {
    if (value) facts.push({ label, value });
  };
  add("Status", status);
  add("CIN", str(x.cin));
  add("Registrar", str(x.roc));
  add("Incorporated", str(x.incorporatedOn));
  add("Subject joined", str(x.joinedOn));
  add("Last AGM", str(x.lastAgm));
  add("Registered", str(x.address));

  const struck = /strike|struck/i.test(status);
  const why = struck
    ? `A struck-off company is off the register and cannot legally trade. ${person} is on its board of record, so ask when it ceased operating, whether it was struck off for non-filing, and whether any restoration or director-disqualification proceedings followed — striking off for default can disqualify a director for five years under s.164(2).`
    : `The register does not show ${company} in good standing. Ask ${person} what its current position is and whether any filing or restoration is outstanding.`;

  return {
    severity: f.severity,
    tone: SEVERITY_TONE[f.severity] ?? "amber",
    category: "Governance flag",
    title: humanizeCaps(`${company} — ${status} on the MCA register`),
    facts,
    // The register's own words for it, so the quote can never describe a
    // different company from the one in the title.
    evidence: `${company} — ${status}`,
    evidenceSource: "MCA register, via IndiaFilings",
    whyItMatters: why,
    claim: "Verified",
    sourceRef: f.sourceRef,
  };
}


/**
 * The Recent News table.
 *
 * A list of headlines is a list of things that exist. What a reader needs is
 * what each one said — so every row carries a summary: the extracted finding
 * where the article was actually opened and read, and the search snippet where
 * it was not. A row with neither says so rather than pretending.
 */
/** A registered entity not in good standing reads differently from an active
 *  one, and the difference is the whole reason to print the status column. */
const ADVERSE_ENTITY_STATUS = /strike|liquidat|dissolv|defunct|amalgamat|dormant/i;

/**
 * Every entity on the subject's DIN, worst standing first.
 *
 * The board list was already collected and only ever surfaced as prose. What a
 * reader wants from it is the shape of the footprint — how many entities, which
 * are not in good standing, and how long the subject has been on each — and
 * that is a table, not a sentence.
 */
function buildDirectorships(bySource: SourceIndex, citations: Citation[]): DirectorshipRow[] {
  const refByUrl = new Map(citations.filter((c) => c.url).map((c) => [c.url as string, c.ref]));
  const rows: DirectorshipRow[] = [];
  const seen = new Set<string>();

  for (const sourceId of REGISTRY_IDS) {
    const source = bySource[sourceId];
    if (source?.status !== "done") continue;
    for (const h of source.hits) {
      if (h.extra?.category !== "directorship") continue;
      const id = str(h.extra?.cin) ?? "";
      const name = str(h.extra?.company) ?? "";
      if (!name || seen.has(id || name)) continue;
      seen.add(id || name);

      const status = str(h.extra?.status);
      rows.push({
        id,
        name,
        status,
        kind: h.extra?.entityKind === "llp" ? "llp" : "company",
        joinedOn: str(h.extra?.joinedOn),
        tone: status && ADVERSE_ENTITY_STATUS.test(status) ? "amber" : "neutral",
        sourceRef: h.url ? refByUrl.get(h.url) : undefined,
      });
    }
  }

  // Anything not in good standing first — it is the only row on this table a
  // reader must not miss — then alphabetically, so the list is scannable.
  const rank = (r: DirectorshipRow) => (r.tone === "amber" ? 0 : 1);
  return rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Keywords that describe a matter no reader should have to find further down
 *  the page. Everything else is worth a flag, not the top of the table. */
const HARD_KEYWORDS = new Set(["fraud", "cbi", "eow", "criminal", "wilful", "defaulter"]);

function buildNewsRows(bySource: SourceIndex, citations: Citation[]): NewsRow[] {
  const refByUrl = new Map<string, number>();
  for (const c of citations) if (c.url) refByUrl.set(c.url, c.ref);

  // Insights first: they were read, so their summary is the real one, and they
  // supersede the bare headline they came from.
  const insightByUrl = new Map<string, RawHit>();
  for (const id of ["news", "google"]) {
    for (const h of bySource[id]?.hits ?? []) {
      if (h.extra?.category === "insight" && h.url) insightByUrl.set(canonicalUrl(h.url) ?? h.url, h);
    }
  }

  const rows: NewsRow[] = [];
  const seen = new Set<string>();

  for (const id of ["news", "google"]) {
    const source = bySource[id];
    if (source?.status !== "done") continue;

    for (const h of source.hits) {
      if (h.extra?.category === "insight") continue;
      const key = canonicalUrl(h.url) ?? h.title.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);

      const insight = insightByUrl.get(key);
      const kws = h.matchedKeywords ?? [];
      const hard = kws.some((k) => ["fraud", "cbi", "eow", "criminal", "wilful", "defaulter"].includes(k.toLowerCase()));
      const role = str(insight?.extra?.subjectRole);

      rows.push({
        headline: humanizeCaps(trimToPhrase(stripQuotes(insight?.extra?.sourceTitle ? String(insight.extra.sourceTitle) : h.title), 120)),
        summary: insight ? insight.title : h.snippet ? trimToPhrase(stripQuotes(h.snippet), 240) : undefined,
        date: normaliseDate(insight?.date ?? h.date),
        outlet: hostOf(h.url) ?? publisherOf(source.name),
        tone: insight?.extra?.polarity === "positive" ? "green" : hard ? "red" : kws.length > 0 ? "amber" : "neutral",
        attribution:
          role && role !== "unclear" && role !== "not_mentioned"
            ? `Read in full — the subject is the ${role}`
            : insight
              ? "Read in full"
              : h.confidence === "unverified"
                ? "Name match only — not confirmed as this person"
                : h.extra?.namesSubject === false && h.entity
                  ? `Coverage of ${h.entity}; the subject is not named`
                  : undefined,
        sourceRef: h.url ? refByUrl.get(h.url) : undefined,
        url: h.url,
      });
    }
  }

  // Adverse first, then anything dated, then the rest — a reader scanning the
  // top of the table should meet the sharpest item first.
  const rank: Record<Tone, number> = { red: 3, amber: 2, green: 1, neutral: 0 };
  return rows.sort((a, b) => rank[b.tone] - rank[a.tone]).slice(0, 12);
}

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

// The buckets ARE the authority tiers from `risk.ts`, in descending rank, plus
// one overlay: a source that ran on the keyless fallback engine is counted as
// unverified rather than at its nominal tier.
//
// This panel used to keep a second, private id → bucket map of its own, which
// drifted from the tiers the citation list and the scope table were already
// using. Two faults came out of that drift, both visible on the same page:
//
//   • The same MCA registry read as "Official register" beside every citation
//     and "Company registry" here, so a run whose sources were mostly official
//     could report "Official / regulatory — 0" directly under six citations
//     labelled OFFICIAL REGISTER.
//   • `profile` was missing from the map altogether, so a source that had
//     completed was silently dropped and the buckets summed to one less than
//     the "N of M sources completed" stated beside them.
//
// One taxonomy, read from one place, cannot disagree with itself.
const UNVERIFIED_BUCKET = "Low-confidence / unverified";

const BUCKET_ORDER = [
  "Official register",
  "Court record",
  "Reference / profile",
  "Press",
  UNVERIFIED_BUCKET,
] as const;

function buildSourceQuality(run: Run): SourceQualityRow[] {
  const counts: Record<string, number> = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0]));

  for (const p of run.progress) {
    if (p.status !== "done") continue;
    const note = (p.note ?? "").toLowerCase();
    // A keyless fallback engine ran but its results are not high-confidence.
    if (note.includes("keyless fallback")) {
      counts[UNVERIFIED_BUCKET] += 1;
      continue;
    }
    const { label } = sourceTier(p.sourceId);
    // A source we cannot place on the tier ladder is counted as unverified
    // rather than dropped: an uncounted source reads as one that never ran,
    // which is the more misleading of the two.
    counts[label in counts ? label : UNVERIFIED_BUCKET] += 1;
  }

  const toneFor = (bucket: string, n: number): Tone => {
    if (bucket === UNVERIFIED_BUCKET) return n > 0 ? "amber" : "neutral";
    return n > 0 ? "green" : "neutral";
  };

  return BUCKET_ORDER.map((b) => ({ label: b, count: counts[b], tone: toneFor(b, counts[b]) }));
}

/**
 * What each source searched, and what it set aside.
 *
 * Two kinds of line, because there are two kinds of silence worth explaining:
 * a source that ran and genuinely found nothing, and a source that found
 * things and rejected them as belonging to someone else. Only the second can
 * name items, and naming them is the point — "4 results set aside" is a
 * number, whereas the titles are something the reader can check.
 */
function buildClarifications(run: Run): PrintClarification[] {
  const out: PrintClarification[] = [];

  for (const c of run.collected ?? []) {
    if (c.status !== "done") continue;
    const items = c.excluded ?? [];
    const searched = c.queries?.length ?? 0;
    // What the source returned, not what this copy of it kept — a brief
    // re-opened from the archive holds a trimmed hit list, and reading its
    // length would turn "42 results" into a smaller number and, for a source
    // trimmed to nothing, into "nothing on record".
    const found = c.originalHits ?? c.hits.length;

    if (found === 0) {
      out.push({
        source: c.sourceName,
        text: searched > 0
          ? `${searched} search${searched === 1 ? "" : "es"} run — nothing on record.`
          : "Searched — nothing on record.",
        items,
      });
    } else if (items.length > 0) {
      out.push({
        source: c.sourceName,
        text: `${found} result${found === 1 ? "" : "s"} kept. Also came up, and not counted against the subject:`,
        items,
      });
    }
  }

  return out;
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
    tier: sourceTier(c.sourceName).label,
  }));
}

/** The publication, from its own domain — "indiankanoon.org", not the whole URL
 *  spilling across the column it is supposed to fit in. */
function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
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
  if (s.includes("news deep dive")) return "news";
  if (s.includes("google") || s.includes("news")) return "google";
  if (s.includes("indiafilings") || s.includes("mca registry")) return "indiafilings";
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
  // The register files in capitals; a concern titled in them reads as shouting.
  return humanizeCaps(stripQuotes(out)) || stripQuotes(out);
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

function stripQuotes(s: string): string {
  return s.replace(/^["“'\s]+|["”'\s]+$/g, "").trim();
}

function shorten(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

// ── Trimming prose to fit ────────────────────────────────────────────────────
// A finding is a written sentence, and a sentence cut at character 92 stops
// mid-thought: "Rajesh Exports is implicated in a Rs.2,485 crore default,
// raising serious concerns about it…". Read alone that is merely ugly; read
// inside the executive verdict, which appends the claim type, it becomes a
// sentence that doesn't parse — "…concerns about it… (alleged)."
//
// So prose is cut where the language already breaks: at the end of the first
// sentence, else at the last clause boundary that still leaves a substantial
// phrase. Only when neither exists does it fall back to an ellipsis, and even
// then on a word boundary. Names and labels keep the plain cut above — a
// clause-trimmed case name would misstate the case.

/** Words that leave a phrase hanging if it ends on them. */
const DANGLING =
  /\s+(?:and|or|but|with|for|of|in|on|at|to|by|from|as|that|which|while|after|before|amid|over|into|under|against|about|including|following|alleging|raising|citing|belonging|relating|regarding|concerning|involving|pertaining|its|their|the|a|an)$/i;

function stripDangling(s: string): string {
  let out = s.trim();
  // Repeatedly, because trimming "the" exposes "to" beneath it, and "belonging"
  // beneath that — a phrase can end on a run of them.
  for (let i = 0; i < 4; i += 1) {
    const next = out.replace(/[\s,;:.—–-]+$/, "").replace(DANGLING, "");
    if (next === out) break;
    out = next;
  }
  return out.trim();
}

function trimToPhrase(s: string, max: number): string {
  return balanceQuotes(trimToLength(s, max));
}

function trimToLength(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return stripDangling(t) || t;

  // Every cut has to leave enough behind to still say something — a two-word
  // opener followed by an ellipsis is not a finding.
  const floor = Math.floor(max * 0.4);

  // The first sentence, when there is more than one and it carries the matter.
  const end = t.search(/[.?!]\s+\S/);
  if (end > 0) {
    const first = t.slice(0, end + 1);
    if (first.length <= max && first.length >= floor) return stripDangling(first) || first;
  }

  // Otherwise the last clause boundary inside the budget.
  const head = t.slice(0, max);
  const cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(" — "), head.lastIndexOf(" – "));
  if (cut >= floor) {
    const clause = stripDangling(head.slice(0, cut));
    if (clause) return clause;
  }

  // Nothing to break on: cut on a word and say so with the ellipsis.
  const space = head.lastIndexOf(" ");
  const words = space >= floor ? head.slice(0, space) : head.slice(0, max - 1);
  return `${stripDangling(words) || words.trim()}…`;
}

/** An opening quote whose closing half was trimmed away reads as a typo. Drop
 *  the orphan rather than leave the line half-quoted. */
function balanceQuotes(s: string): string {
  const quotes = s.match(/["“”]/g) ?? [];
  return quotes.length % 2 === 0 ? s : s.replace(/["“”]/, "").replace(/\s{2,}/g, " ").trim();
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
