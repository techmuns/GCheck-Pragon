import type {
  AppConfig,
  Citation,
  CollectorResult,
  Finding,
  RenderedSection,
  Run,
  Severity,
  Subject,
} from "./types";

// ── Deterministic brief assembler ──────────────────────────────────────────
// Turns raw collector output into an honest, source-linked brief. No
// fabrication: sources that were skipped say so; empty done-sources render a
// genuine "clear"/n-a. Phase 3 layers OpenAI narrative synthesis on top of this
// same structured input.

// Keywords that, when they appear, warrant a hard red flag vs a softer watch.
const RED_KEYWORDS = ["fraud", "wilful", "defaulter", "cbi", "criminal", "eow"];

function severityForKeywords(matched: string[]): Severity {
  if (matched.length === 0) return "info";
  const hard = matched.some((k) => RED_KEYWORDS.includes(k.toLowerCase()));
  return hard ? "red" : "amber";
}

const RANK: Record<Severity, number> = { red: 3, amber: 2, clear: 1, info: 0 };
function worst(a: Severity, b: Severity): Severity {
  return RANK[a] >= RANK[b] ? a : b;
}

interface Ctx {
  subject: Subject;
  byId: Record<string, CollectorResult | undefined>;
  citations: Citation[];
  cite: (sourceName: string, label: string, url?: string) => number;
}

export function assembleBrief(
  subject: Subject,
  collected: CollectorResult[],
  config: AppConfig,
): NonNullable<Run["brief"]> {
  const byId: Record<string, CollectorResult | undefined> = {};
  for (const c of collected) byId[c.sourceId] = c;

  const citations: Citation[] = [];
  const seen = new Map<string, number>();
  const cite = (sourceName: string, label: string, url?: string): number => {
    const key = url ?? `${sourceName}:${label}`;
    const existing = seen.get(key);
    if (existing) return existing;
    const ref = citations.length + 1;
    citations.push({ ref, sourceName, label, url });
    seen.set(key, ref);
    return ref;
  };

  const ctx: Ctx = { subject, byId, citations, cite };

  const sections: RenderedSection[] = config.sections
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order)
    .map((s) => buildSection(s.id, s.title, ctx))
    .filter((s): s is RenderedSection => s !== null);

  // Verdict = worst severity across real findings. Source errors/skips are
  // "unknown", not risk — they never inflate the verdict. And "clear" is only
  // honest if at least one source actually completed.
  let verdict: Severity = "clear";
  let anyFinding = false;
  for (const sec of sections) {
    for (const f of sec.findings) {
      if (f.severity === "info") continue;
      anyFinding = true;
      verdict = worst(verdict, f.severity);
    }
  }
  const anyCompleted = collected.some((c) => c.status === "done");
  if (!anyFinding) verdict = anyCompleted ? "clear" : "info";

  const headline = buildHeadline(verdict, ctx);

  return { verdict, headline, sections, citations };
}

function buildSection(id: string, title: string, ctx: Ctx): RenderedSection {
  switch (id) {
    case "red-flags":
      return redFlagSection(title, ctx);
    case "snapshot":
      return { id, title, findings: [], empty: true }; // needs a company-profile source (future)
    case "management":
      return managementSection(id, title, ctx);
    case "litigation":
      return sourceSection(id, title, "indiankanoon", ctx, "amber");
    case "defaulters":
      return defaulterSection(id, title, ctx);
    case "directorships":
      return sourceSection(id, title, "privatecircle", ctx, "info");
    case "press":
      return pressSection(id, title, ctx);
    default:
      return { id, title, findings: [], empty: true };
  }
}

// The verdict section — a distilled top-of-page summary of the sharpest findings.
function redFlagSection(title: string, ctx: Ctx): RenderedSection {
  const findings: Finding[] = [];

  // Keyword hits from Google.
  const google = ctx.byId["google"];
  if (google?.status === "done") {
    const flagged = google.hits.filter((h) => (h.matchedKeywords?.length ?? 0) > 0);
    for (const h of flagged.slice(0, 4)) {
      const ref = ctx.cite("Google / News", h.title, h.url);
      findings.push({
        severity: severityForKeywords(h.matchedKeywords ?? []),
        text: `${h.entity ?? "Subject"}: "${h.title}" — matched ${h.matchedKeywords!.join(", ")}.`,
        sourceRef: ref,
      });
    }
  }

  // Defaulter presence from CIBIL.
  const cibil = ctx.byId["cibil"];
  if (cibil?.status === "done" && cibil.hits.length > 0) {
    findings.push({ severity: "red", text: `CIBIL suit-filed / defaulter records found (${cibil.hits.length}). Review before meeting.` });
  }

  // Litigation presence.
  const ik = ctx.byId["indiankanoon"];
  if (ik?.status === "done" && ik.hits.length > 0) {
    findings.push({ severity: "amber", text: `${ik.hits.length} litigation record(s) surfaced on Indian Kanoon.` });
  }

  // Honest notes for sources that didn't return data.
  for (const c of Object.values(ctx.byId)) {
    if (c?.status === "locked") findings.push({ severity: "info", text: `${c.sourceName}: 🔒 Upgrade to enable — ${c.note ?? "paid source"}.` });
    else if (c?.status === "skipped") findings.push({ severity: "info", text: `${c.sourceName}: ${c.note ?? "not run"}.` });
    else if (c?.status === "error") findings.push({ severity: "info", text: `${c.sourceName}: unavailable — ${c.note ?? "error"}.` });
  }

  const hasRisk = findings.some((f) => f.severity === "red" || f.severity === "amber");
  const anyCompleted = Object.values(ctx.byId).some((c) => c?.status === "done");
  if (!hasRisk) {
    findings.unshift(
      anyCompleted
        ? { severity: "clear", text: "No red flags surfaced across the sources that completed." }
        : { severity: "info", text: "No sources completed — results below are incomplete. Configure credentials/keys and re-run." },
    );
  }
  return { id: "red-flags", title, findings };
}

function managementSection(id: string, title: string, ctx: Ctx): RenderedSection {
  if (ctx.subject.promoters.length === 0) {
    return { id, title, findings: [{ severity: "info", text: "No promoters were provided for this pre-screen." }] };
  }
  return {
    id,
    title,
    findings: ctx.subject.promoters.map((p) => ({ severity: "info" as Severity, text: p })),
  };
}

// Generic per-source section — lists hits, or an honest status line.
// A source error is "unavailable" (info), never a risk signal.
function sourceSection(id: string, title: string, sourceId: string, ctx: Ctx, hitSeverity: Severity): RenderedSection {
  const c = ctx.byId[sourceId];
  if (!c) return { id, title, findings: [], empty: true };
  if (c.status === "locked") return { id, title, findings: [{ severity: "info", text: `🔒 Upgrade to enable — ${c.note ?? "paid source"}` }] };
  if (c.status === "skipped") return { id, title, findings: [{ severity: "info", text: c.note ?? "Source not run." }] };
  if (c.status === "error") return { id, title, findings: [{ severity: "info", text: `Source unavailable — ${c.note ?? "unknown error"}` }] };
  if (c.hits.length === 0) {
    return { id, title, findings: [{ severity: "clear", text: c.note ?? "Nothing found." }] };
  }
  return {
    id,
    title,
    findings: c.hits.slice(0, 6).map((h) => ({
      severity: hitSeverity,
      text: h.title,
      sourceRef: ctx.cite(c.sourceName, h.title, h.url),
    })),
  };
}

function defaulterSection(id: string, title: string, ctx: Ctx): RenderedSection {
  const c = ctx.byId["cibil"];
  if (!c) return { id, title, findings: [], empty: true };
  if (c.status === "locked") return { id, title, findings: [{ severity: "info", text: `🔒 Upgrade to enable — ${c.note ?? "paid source"}` }] };
  if (c.status === "skipped") return { id, title, findings: [{ severity: "info", text: c.note ?? "Not run." }] };
  if (c.status === "error") return { id, title, findings: [{ severity: "info", text: `Source unavailable — ${c.note ?? "unknown error"}` }] };
  if (c.hits.length === 0) {
    return { id, title, findings: [{ severity: "clear", text: "No suit-filed / defaulter records found." }] };
  }
  return {
    id,
    title,
    findings: c.hits.slice(0, 8).map((h) => ({
      severity: "red" as Severity,
      text: `${h.entity ?? ""} — ${h.title} (${(h.extra?.category as string) ?? "defaulter"})`.trim(),
      sourceRef: ctx.cite(c.sourceName, h.title, h.url),
    })),
  };
}

function pressSection(id: string, title: string, ctx: Ctx): RenderedSection {
  const c = ctx.byId["google"];
  if (!c) return { id, title, findings: [], empty: true };
  if (c.status === "locked") return { id, title, findings: [{ severity: "info", text: `🔒 Upgrade to enable — ${c.note ?? "paid source"}` }] };
  if (c.status === "skipped") return { id, title, findings: [{ severity: "info", text: c.note ?? "Not run." }] };
  if (c.status === "error") return { id, title, findings: [{ severity: "info", text: `Source unavailable — ${c.note ?? "unknown error"}` }] };
  const hits = c.hits.slice(0, 6);
  if (hits.length === 0) return { id, title, findings: [{ severity: "clear", text: "No notable coverage found." }] };
  return {
    id,
    title,
    findings: hits.map((h) => ({
      severity: (h.matchedKeywords?.length ?? 0) > 0 ? severityForKeywords(h.matchedKeywords ?? []) : ("info" as Severity),
      text: h.title,
      sourceRef: ctx.cite(c.sourceName, h.title, h.url),
    })),
  };
}

function buildHeadline(verdict: Severity, ctx: Ctx): string {
  const name = ctx.subject.company;
  const skipped = Object.values(ctx.byId).filter((c) => c?.status === "skipped").length;
  const tail = skipped > 0 ? ` ${skipped} source(s) not configured.` : "";
  switch (verdict) {
    case "red":
      return `Red flags found for ${name} — review the highlighted items before the meeting.${tail}`;
    case "amber":
      return `${name}: items to review before the meeting, no hard red flags.${tail}`;
    case "clear":
      return `No red flags surfaced for ${name} across the sources that ran.${tail}`;
    default:
      return `Pre-screen for ${name} — limited sources ran.${tail}`;
  }
}
