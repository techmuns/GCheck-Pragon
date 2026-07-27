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

export interface Concern {
  severity: Severity;
  tone: Tone;
  title: string;
  explanation: string;
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

  const concernsAll = buildConcerns(brief.sections, brief.citations, hitByUrl);
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
      parts.push(`The sharpest signal is ${lowerFirst(top.title)} (${top.claim.toLowerCase()}).`);
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

function buildConcerns(
  sections: RenderedSection[],
  citations: Citation[],
  hitByUrl: Map<string, HitRef>,
): Concern[] {
  const summary = sections.find((s) => s.id === "red-flags");
  if (!summary) return [];

  const citationByRef = new Map(citations.map((c) => [c.ref, c]));

  const concerns: Concern[] = [];
  for (const f of summary.findings) {
    if (f.severity !== "red" && f.severity !== "amber") continue;

    const citation = f.sourceRef !== undefined ? citationByRef.get(f.sourceRef) : undefined;
    const hitRef = citation?.url ? hitByUrl.get(citation.url) : undefined;
    const sourceId = hitRef?.sourceId ?? guessSourceId(citation?.sourceName, f.text);

    const meta = classifyConcern(f.severity, sourceId, f.text, hitRef?.hit);
    const explanation = cleanExplanation(hitRef?.hit?.title ?? f.text, hitRef?.hit?.snippet);

    concerns.push({
      severity: f.severity,
      tone: SEVERITY_TONE[f.severity],
      title: meta.title,
      explanation,
      whyItMatters: meta.why,
      claim: meta.claim,
      sourceRef: f.sourceRef,
    });
  }

  // Rank by severity (red before amber); preserve source order within a tier.
  return concerns.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
}

interface ConcernMeta {
  title: string;
  why: string;
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

  if (defaulter) {
    return {
      title: "Suit-filed / defaulter record",
      why: "A confirmed lending default is a serious credit-and-governance signal.",
      claim: "Reported",
    };
  }
  if (criminal) {
    return {
      title: "Alleged criminal / fraud matter",
      why: "Alleged criminal or fraud conduct must be verified before any commitment.",
      claim: "Alleged",
    };
  }
  if (regulatory) {
    return {
      title: "Regulatory / investigative matter",
      why: "Active regulatory scrutiny is a material governance risk to clarify.",
      claim: severity === "red" ? "Under review" : "Reported",
    };
  }
  if (court) {
    return {
      title: "Litigation on record",
      why: "Open legal exposure can carry financial and reputational liability.",
      claim: "Under review",
    };
  }
  if (sourceId === "filings") {
    return {
      title: "Disclosure flag in exchange filing",
      why: "Regulatory disclosures are where adverse corporate events first surface.",
      claim: "Verified",
    };
  }
  if (sourceId === "google" || /news|media|report(ed)?|article/.test(t)) {
    return {
      title: "Adverse media coverage",
      why: "Warrants review to confirm the matter's materiality and current status.",
      claim: severity === "red" ? "Alleged" : "Reported",
    };
  }
  return {
    title: "Governance flag",
    why: "Flagged for review before the meeting.",
    claim: severity === "red" ? "Alleged" : "Reported",
  };
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
        status: flagged ? `Flagged: ${h.matchedKeywords!.slice(0, 2).join(", ")}` : "Routine filing",
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
        status: kws.length > 0 ? `Adverse: ${kws.slice(0, 2).join(", ")}` : "Coverage",
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

function cleanExplanation(text: string, snippet?: string): string {
  let out = stripQuotes(text).replace(/\s+/g, " ").trim();
  // Drop a leading "Entity: " prefix the rule-based summary adds.
  out = out.replace(/^[^:]{2,40}:\s+/, (m) => (m.length < 30 ? m : ""));
  if (out.length < 45 && snippet) {
    out = `${out} — ${stripQuotes(snippet)}`.trim();
  }
  return shorten(out, 150);
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

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
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
