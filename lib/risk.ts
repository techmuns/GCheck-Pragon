import type { CollectorResult, Finding, Run, SourceProgress } from "./types";
import { boardFlagCounts, buildNetwork } from "./network";

// ── Risk methodology, source tiers & scope ───────────────────────────────────
// A verdict that only ever reports the single worst thing found is not, on its
// own, defensible: two firms both land on "amber" whether one has a lone press
// mention and the other a struck-off company, three lawsuits and a director
// under investigation. Institutional diligence wants a consistent, WRITTEN
// method — the same inputs weighted the same way every time, and every point of
// the result attributable to a specific finding.
//
// So this module scores the run additively from signals it can point at, tiers
// every source by how authoritative it is, and states plainly what the run did
// and did not reach. Nothing here is a black box: the score is the sum of its
// listed contributions, and the methodology is shipped alongside it.

export const METHODOLOGY_VERSION = "1.0";

// ── Source authority tiers ───────────────────────────────────────────────────

export type Tier = "official" | "court" | "reference" | "press" | "unknown";

export interface SourceTier {
  tier: Tier;
  label: string;
  /** Higher is more authoritative — used to weight and to corroborate. */
  rank: number;
}

const TIER_META: Record<Tier, { label: string; rank: number }> = {
  official: { label: "Official register", rank: 4 },
  court: { label: "Court record", rank: 3 },
  reference: { label: "Reference / profile", rank: 2 },
  press: { label: "Press", rank: 1 },
  unknown: { label: "Other", rank: 0 },
};

const TIER_BY_ID: Record<string, Tier> = {
  indiafilings: "official",
  registry: "official",
  cibil: "official",
  filings: "official",
  privatecircle: "official",
  indiankanoon: "court",
  wikidata: "reference",
  profile: "reference",
  news: "press",
  google: "press",
};

/** The authority tier of a source, by id or by the name a citation carries. */
export function sourceTier(idOrName: string): SourceTier {
  const s = idOrName.toLowerCase();
  let tier: Tier | undefined = TIER_BY_ID[s];
  if (!tier) {
    if (/kanoon|court/.test(s)) tier = "court";
    else if (/registr|mca|indiafilings|tofler|cibil|default|filing|exchange/.test(s)) tier = "official";
    else if (/wikidata|profile|forbes|wikipedia|background/.test(s)) tier = "reference";
    else if (/news|google|media|press/.test(s)) tier = "press";
  }
  const meta = TIER_META[tier ?? "unknown"];
  return { tier: tier ?? "unknown", label: meta.label, rank: meta.rank };
}

// ── Risk score ───────────────────────────────────────────────────────────────

export type Band = "low" | "moderate" | "elevated" | "high";

export interface RiskContribution {
  label: string;
  /** Points added to the score. Zero for a caveat that lowers confidence
   *  rather than raising risk (e.g. a single-source item). */
  points: number;
  detail?: string;
}

export interface RiskAssessment {
  score: number;
  band: Band;
  contributions: RiskContribution[];
  coverage: { completed: number; total: number; partial: boolean };
  /** A single-source, press-only sharpest finding with nothing official or
   *  judicial to corroborate it — flagged so the reader treats it as such. */
  uncorroborated: boolean;
  methodologyVersion: string;
}

const CAP = {
  redConcerns: 45,
  amberConcerns: 24,
  struckOff: 20,
  litigation: 16,
  defaulter: 40,
  boardRed: 36,
  boardAmber: 20,
  network: 8,
} as const;

function bandFor(score: number): Band {
  if (score >= 60) return "high";
  if (score >= 35) return "elevated";
  if (score >= 15) return "moderate";
  return "low";
}

/** Count governance flags of a given kind across the collected registry hits. */
function governanceCount(collected: CollectorResult[], flag: string): number {
  let n = 0;
  for (const c of collected) {
    for (const h of c.hits) {
      if (h.extra?.category === "governance" && h.extra?.flag === flag) n += 1;
    }
  }
  return n;
}

function confirmedHits(collected: CollectorResult[], sourceId: string): number {
  const c = collected.find((x) => x.sourceId === sourceId);
  if (!c || c.status !== "done") return 0;
  return c.hits.filter((h) => h.confidence !== "unverified").length;
}

export function assessRisk(run: Run): RiskAssessment {
  const collected = run.collected ?? [];
  const contributions: RiskContribution[] = [];
  const add = (label: string, raw: number, cap: number, detail?: string) => {
    const points = Math.min(raw, cap);
    if (points > 0) contributions.push({ label, points, detail });
  };

  // Company-level concerns (the itemised red/amber matters). Read straight from
  // the assembled summary section rather than through the print-brief builder,
  // so this module has no dependency on it and the two cannot import in a cycle.
  const summary = run.brief?.sections.find((s) => s.id === "red-flags");
  const concerns: Finding[] = (summary?.findings ?? []).filter((f) => f.severity === "red" || f.severity === "amber");
  const red = concerns.filter((c) => c.severity === "red").length;
  const amber = concerns.filter((c) => c.severity === "amber").length;
  add("Red-flag findings", red * 18, CAP.redConcerns, red > 0 ? `${red} item(s)` : undefined);
  add("Review-level findings", amber * 8, CAP.amberConcerns, amber > 0 ? `${amber} item(s)` : undefined);

  // Registry standing — facts on the public record, weighted heavily.
  const struck = governanceCount(collected, "entity-status");
  add("Struck-off / not-in-good-standing companies", struck * 10, CAP.struckOff, struck > 0 ? `${struck} on record` : undefined);
  const dinBad = governanceCount(collected, "din-status") + governanceCount(collected, "non-compliant");
  if (dinBad > 0) contributions.push({ label: "Director ID not in good standing", points: 20, detail: "Registry flag" });

  // Litigation and defaults.
  const litigation = confirmedHits(collected, "indiankanoon");
  add("Litigation on record", litigation * 4, CAP.litigation, litigation > 0 ? `${litigation} case(s)` : undefined);
  const defaulters = confirmedHits(collected, "cibil");
  add("Suit-filed / defaulter records", defaulters * 25, CAP.defaulter, defaulters > 0 ? `${defaulters} record(s)` : undefined);

  // The board itself — a company is only as clean as its directors.
  const board = boardFlagCounts(run.diligence ?? []);
  add("Directors with red flags", board.red * 12, CAP.boardRed, board.red > 0 ? `${board.red} director(s)` : undefined);
  add("Directors with items to review", board.amber * 5, CAP.boardAmber, board.amber > 0 ? `${board.amber} director(s)` : undefined);

  // Related-party network — a struck-off company shared by the board is a
  // channel, not a coincidence.
  const network = buildNetwork(run);
  const flaggedInterlock = network?.interlocks.find((i) => i.flagged);
  if (flaggedInterlock) {
    contributions.push({
      label: "Related-party red flag",
      points: CAP.network,
      detail: `${flaggedInterlock.company} — shared, not in good standing`,
    });
  } else if ((network?.interlocks.length ?? 0) >= 3) {
    contributions.push({ label: "Dense director interlock network", points: 3, detail: `${network!.interlocks.length} shared companies` });
  }

  const score = Math.min(100, contributions.reduce((s, c) => s + c.points, 0));

  // Coverage — a thin run's clean score is not a clean bill of health.
  const total = run.progress.length;
  const completed = run.progress.filter((p) => p.status === "done").length;
  const partial = total > 0 && completed / total < 0.6;

  // Corroboration of the sharpest finding: is the leading concern backed only by
  // a press source, with nothing on the official register or a court record to
  // stand behind it?
  const sharpest = concerns[0];
  const citations = run.brief?.citations ?? [];
  const sharpestCitation =
    sharpest?.sourceRef !== undefined ? citations.find((c) => c.ref === sharpest.sourceRef) : undefined;
  const sharpestIsPress = sharpestCitation ? sourceTier(sharpestCitation.sourceName).tier === "press" : false;
  const hasOfficialOrCourt = collected.some(
    (c) => (c.sourceId === "indiankanoon" || sourceTier(c.sourceId).tier === "official") && c.status === "done" && c.hits.length > 0,
  );
  const uncorroborated = Boolean(sharpest) && sharpestIsPress && !hasOfficialOrCourt;
  if (uncorroborated) {
    contributions.push({
      label: "Sharpest finding is single-source (press)",
      points: 0,
      detail: "No official or court record corroborates it — treat as reported, not established",
    });
  }

  return {
    score,
    band: bandFor(score),
    contributions: contributions.sort((a, b) => b.points - a.points),
    coverage: { completed, total, partial },
    uncorroborated,
    methodologyVersion: METHODOLOGY_VERSION,
  };
}

/** The written method, shipped with the score so it is auditable. */
export function riskMethodology(): string[] {
  return [
    `Paragon governance risk score v${METHODOLOGY_VERSION}. The score (0–100) is the sum of weighted signals, capped at 100; every point is attributable to a listed contribution.`,
    "Weights: each red-flag finding +18 (cap 45); each review-level finding +8 (cap 24); each struck-off / not-in-good-standing company +10 (cap 20); a director-ID registry flag +20; each litigation record +4 (cap 16); each suit-filed / defaulter record +25 (cap 40); each director carrying a red flag +12 (cap 36) and each with review items +5 (cap 20); a struck-off company shared across the board +8, or a dense interlock network +3.",
    "Bands: 0–14 Low, 15–34 Moderate, 35–59 Elevated, 60–100 High.",
    "Corroboration: a sharpest finding that is press-only, with no official-register or court record behind it, is flagged as single-source and read as reported rather than established.",
    "Coverage: where fewer than 60% of configured sources completed, the score is marked as resting on partial coverage — a low score on a thin run is not a clean bill of health.",
    "The score complements the categorical verdict; it does not replace analyst judgement, and every contribution links back to the source it was read from.",
  ];
}

// ── Scope & limitations ──────────────────────────────────────────────────────

export type ScopeStatus = "covered" | "partial" | "not-run" | "upgrade";

export interface ScopeLine {
  name: string;
  tier: Tier;
  tierLabel: string;
  status: ScopeStatus;
  detail?: string;
}

export interface Scope {
  lines: ScopeLine[];
  completed: number;
  total: number;
  statement: string;
}

function scopeStatus(p: SourceProgress): ScopeStatus {
  if (p.status === "locked") return "upgrade";
  if (p.status === "done") return (p.note ?? "").toLowerCase().includes("keyless fallback") ? "partial" : "covered";
  if (p.status === "error" || p.status === "skipped") return "not-run";
  return "not-run";
}

/** What the run reached, and what it did not — stated, not implied. */
export function buildScope(run: Run): Scope {
  const lines: ScopeLine[] = run.progress.map((p) => {
    const t = sourceTier(p.sourceId);
    return { name: p.name, tier: t.tier, tierLabel: t.label, status: scopeStatus(p), detail: p.note };
  });
  const completed = lines.filter((l) => l.status === "covered" || l.status === "partial").length;
  const total = lines.length;

  const notRun = lines.filter((l) => l.status === "not-run").map((l) => l.name);
  const upgrade = lines.filter((l) => l.status === "upgrade").map((l) => l.name);
  const parts = [`${completed} of ${total} sources completed.`];
  if (notRun.length > 0) parts.push(`Not covered this run: ${notRun.join(", ")}.`);
  if (upgrade.length > 0) parts.push(`Available on upgrade: ${upgrade.join(", ")}.`);
  if (notRun.length === 0 && upgrade.length === 0) parts.push("All configured sources contributed.");

  return { lines, completed, total, statement: parts.join(" ") };
}
