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
    .filter((s): s is RenderedSection => s !== null)
    // Hide any section that found no data — a skipped/locked/errored source or a
    // "nothing found" result adds noise, not signal, and keeps the brief from
    // being a true one-pager. Key Concerns always stays: it's the summary and
    // still reports which sources were unavailable, so nothing is lost.
    .filter((s) => s.id === "red-flags" || !s.empty);

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
      return snapshotSection(id, title, ctx);
    case "management":
      return managementSection(id, title, ctx);
    case "litigation":
      return sourceSection(id, title, "indiankanoon", ctx, "amber");
    case "defaulters":
      return defaulterSection(id, title, ctx);
    case "directorships":
      return directorshipsSection(id, title, ctx);
    case "filings":
      return filingsSection(id, title, ctx);
    case "press":
      return pressSection(id, title, ctx);
    default:
      return { id, title, findings: [], empty: true };
  }
}

// The verdict section — a distilled top-of-page summary of the sharpest findings.
function redFlagSection(title: string, ctx: Ctx): RenderedSection {
  const findings: Finding[] = [];

  // Who this brief is about. For a company the name settles it; for a person it
  // does not, so the DIN is stated when we have one — and its absence is stated
  // just as plainly, because then everything below is only name-matched.
  if (ctx.subject.type === "director") findings.push(identityFinding(ctx));

  // Keyword hits from Google.
  const google = ctx.byId["google"];
  if (google?.status === "done") {
    const flagged = google.hits.filter((h) => (h.matchedKeywords?.length ?? 0) > 0);
    // A hit that matched only the subject's NAME may be about a namesake. It is
    // still worth showing — but it is not charged to this person: only hits
    // tied to their DIN or one of their companies get a risk severity, and so
    // only those can move the verdict.
    const attributable = flagged.filter((h) => h.confidence !== "unverified");
    const nameOnly = flagged.length - attributable.length;
    for (const h of attributable.slice(0, 4)) {
      const ref = ctx.cite("Google / News", h.title, h.url);
      findings.push({
        severity: severityForKeywords(h.matchedKeywords ?? []),
        text: `${h.entity ?? "Subject"}: "${h.title}" — matched ${h.matchedKeywords!.join(", ")}.`,
        sourceRef: ref,
      });
    }
    if (nameOnly > 0) {
      findings.push({
        severity: "info",
        text: `${nameOnly} further keyword hit(s) matched the name only — not confirmed as this person, and not counted in the verdict.`,
      });
    }
  }

  // Defaulter presence from CIBIL.
  const cibil = ctx.byId["cibil"];
  if (cibil?.status === "done" && cibil.hits.length > 0) {
    findings.push({ severity: "red", text: `CIBIL suit-filed / defaulter records found (${cibil.hits.length}). Review before meeting.` });
  }

  // Litigation presence — same split as the keyword hits above. A case naming
  // some other Rajesh Kumar is not this Rajesh Kumar's case.
  const ik = ctx.byId["indiankanoon"];
  if (ik?.status === "done" && ik.hits.length > 0) {
    const attributable = ik.hits.filter((h) => h.confidence !== "unverified").length;
    const nameOnly = ik.hits.length - attributable;
    if (attributable > 0) {
      findings.push({ severity: "amber", text: `${attributable} litigation record(s) surfaced on Indian Kanoon.` });
    }
    if (nameOnly > 0) {
      findings.push({
        severity: "info",
        text: `${nameOnly} further case(s) matched the name only — not confirmed as this person, and not counted in the verdict.`,
      });
    }
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

/** The registry record's identity row, if the person resolved to one. */
function identityHit(ctx: Ctx) {
  return ctx.byId["registry"]?.hits.find((h) => h.extra?.category === "identity");
}

/**
 * The line that says which person this brief covers. This is the one finding a
 * director brief cannot do without: a name search that could not be pinned to a
 * DIN may have swept up a namesake, and the reader has to be told that in the
 * same breath as the findings — not left to assume otherwise.
 */
function identityFinding(ctx: Ctx): Finding {
  const registry = ctx.byId["registry"];
  const identity = identityHit(ctx);
  if (!ctx.subject.din || !identity || !registry) {
    return {
      severity: "info",
      text: "Could not confirm a unique registry record for this name — the findings below are name-matched and may include other people with the same name.",
    };
  }
  // Counted from the record's own directorship rows, not from subject.anchors —
  // those may be the company the user typed in to disambiguate, and reporting a
  // typed hint back as a registry finding would be claiming more than we read.
  const linked = registry.hits.filter((h) => h.extra?.category === "directorship").length;
  const name = typeof identity.extra?.name === "string" ? identity.extra.name : ctx.subject.company;
  return {
    severity: "info",
    text: `Identified as ${name}, DIN ${ctx.subject.din}${linked > 0 ? ` — ${linked} company record(s) linked` : ""}.`,
    sourceRef: ctx.cite(registry.sourceName, `DIN ${ctx.subject.din}`, identity.url),
  };
}

// Company snapshot — identity of the subject as it appears on the public
// registry record: the CIN and a link to the record itself. Directors surface
// under Key People, so they are deliberately not repeated here. Honest states
// when the registry record could not be found.
function snapshotSection(id: string, title: string, ctx: Ctx): RenderedSection {
  const c = ctx.byId["registry"];
  if (!c) return { id, title, findings: [], empty: true };
  // Director mode: the "snapshot" is the person's own registry identity — the
  // name as the register spells it, and the DIN that makes it unambiguous.
  if (ctx.subject.type === "director") {
    const identity = identityHit(ctx);
    if (!identity) {
      return { id, title, findings: [{ severity: "info", text: c.note ?? "No registry record found." }], empty: true };
    }
    const name = typeof identity.extra?.name === "string" ? identity.extra.name : ctx.subject.company;
    const din = typeof identity.extra?.din === "string" ? identity.extra.din : undefined;
    return {
      id,
      title,
      findings: [
        { severity: "info", text: name, sourceRef: ctx.cite(c.sourceName, name, identity.url) },
        ...(din ? [{ severity: "info" as Severity, text: `DIN ${din}`, sourceRef: ctx.cite(c.sourceName, `DIN ${din}`, identity.url) }] : []),
      ],
    };
  }
  if (c.status === "skipped") return { id, title, findings: [{ severity: "info", text: c.note ?? "Registry not run." }], empty: true };
  if (c.status === "error") return { id, title, findings: [{ severity: "info", text: `Registry unavailable — ${c.note ?? "unknown error"}` }], empty: true };

  // Any registry hit carries the record's CIN and URL; one is enough to identify
  // the company. Master data beyond that isn't free, so we don't pretend to it.
  const record = c.hits.find((h) => h.extra?.cin) ?? c.hits[0];
  if (!record) {
    return { id, title, findings: [{ severity: "info", text: c.note ?? "No registry record found." }], empty: true };
  }

  const findings: Finding[] = [
    { severity: "info", text: ctx.subject.company, sourceRef: ctx.cite(c.sourceName, ctx.subject.company, record.url) },
  ];
  const cin = record.extra?.cin;
  if (typeof cin === "string" && cin) {
    findings.push({ severity: "info", text: `CIN ${cin}`, sourceRef: ctx.cite(c.sourceName, `CIN ${cin}`, record.url) });
  }
  return { id, title, findings };
}

function managementSection(id: string, title: string, ctx: Ctx): RenderedSection {
  const findings: Finding[] = [];

  // Promoters the user supplied (the meeting subjects).
  for (const p of ctx.subject.promoters) {
    findings.push({ severity: "info", text: p });
  }

  // Directors from the free public registry record — the board of record,
  // including for unlisted companies. Cited to the aggregator that publishes it.
  // In director mode the same collector returns the subject themselves plus the
  // companies they sit on; the companies are directorships, not people, so only
  // the identity row belongs here.
  const registry = ctx.byId["registry"];
  if (registry?.status === "done") {
    const rows = ctx.subject.type === "director" ? registry.hits.filter((h) => h.extra?.category === "identity") : registry.hits;
    for (const d of rows) {
      findings.push({ severity: "info", text: d.title, sourceRef: ctx.cite(registry.sourceName, d.title, d.url) });
    }
  }

  // Leadership from Wikidata (free) — CEO / chairperson / founders. In company
  // mode these are the people to know; in director mode the collector returns
  // the companies the person leads, which belong under Company & Directors, so
  // only fold Wikidata in here for a company subject.
  const wikidata = ctx.byId["wikidata"];
  if (wikidata?.status === "done" && ctx.subject.type !== "director") {
    for (const h of wikidata.hits) {
      findings.push({ severity: "info", text: h.title, sourceRef: ctx.cite(wikidata.sourceName, h.title, h.url) });
    }
  }

  if (findings.length === 0) {
    // Honest, and points at the two director sources when neither returned data.
    const wd = wikidata?.status === "done" ? " Wikidata had no leadership on record" : "";
    return {
      id,
      title,
      findings: [{ severity: "info", text: `No registered directors were returned${wd}.`.replace(/\s+\./, ".") }],
      empty: true,
    };
  }
  return { id, title, findings };
}

// Generic per-source section — lists hits, or an honest status line.
// A source error is "unavailable" (info), never a risk signal.
function sourceSection(id: string, title: string, sourceId: string, ctx: Ctx, hitSeverity: Severity): RenderedSection {
  const c = ctx.byId[sourceId];
  if (!c) return { id, title, findings: [], empty: true };
  if (c.status === "locked") return { id, title, findings: [{ severity: "info", text: `🔒 Upgrade to enable — ${c.note ?? "paid source"}` }], empty: true };
  if (c.status === "skipped") return { id, title, findings: [{ severity: "info", text: c.note ?? "Source not run." }], empty: true };
  if (c.status === "error") return { id, title, findings: [{ severity: "info", text: `Source unavailable — ${c.note ?? "unknown error"}` }], empty: true };
  if (c.hits.length === 0) {
    return { id, title, findings: [{ severity: "clear", text: c.note ?? "Nothing found." }], empty: true };
  }
  return {
    id,
    title,
    findings: c.hits.slice(0, 6).map((h) => ({
      // Shown, but demoted and labelled: a record that only matched the
      // subject's name is evidence about *a* person of that name, not proof it
      // is this one. Info severity keeps it out of the verdict.
      severity: h.confidence === "unverified" ? ("info" as Severity) : hitSeverity,
      text: h.confidence === "unverified" ? `${h.title} — name match only, not confirmed as this person` : h.title,
      sourceRef: ctx.cite(c.sourceName, h.title, h.url),
    })),
  };
}

// Other / past companies the directors are involved with. PrivateCircle (paid,
// registry-grade) is the primary source; Wikidata (free) adds the companies a
// person leads — the main signal in director mode, where there's no company to
// probe on PrivateCircle. Both are cited; honest states when neither returns.
function directorshipsSection(id: string, title: string, ctx: Ctx): RenderedSection {
  const findings: Finding[] = [];

  // The registry record's own company list. In director mode this is the
  // strongest directorship signal available, because it is keyed to the
  // person's DIN rather than to the spelling of their name — Wikidata below
  // covers well-known figures, this covers the unlisted ones.
  const registry = ctx.byId["registry"];
  if (registry?.status === "done" && ctx.subject.type === "director") {
    for (const h of registry.hits.filter((r) => r.extra?.category === "directorship").slice(0, 12)) {
      findings.push({ severity: "info", text: h.title, sourceRef: ctx.cite(registry.sourceName, h.title, h.url) });
    }
  }

  // Wikidata's leadership hits only belong here in DIRECTOR mode — there they
  // are the companies the person leads. In company mode the same hits are the
  // company's officers and already render under Key People, so don't duplicate.
  const wikidata = ctx.byId["wikidata"];
  if (wikidata?.status === "done" && ctx.subject.type === "director") {
    for (const h of wikidata.hits) {
      findings.push({ severity: "info", text: h.title, sourceRef: ctx.cite(wikidata.sourceName, h.title, h.url) });
    }
  }

  const pc = ctx.byId["privatecircle"];
  if (pc?.status === "done") {
    for (const h of pc.hits.slice(0, 6)) {
      findings.push({ severity: "info", text: h.title, sourceRef: ctx.cite(pc.sourceName, h.title, h.url) });
    }
  }

  if (findings.length === 0) {
    // No real directorship data — hide the section (empty). Locked/skipped/error
    // states are surfaced in Key Concerns, so nothing is lost by hiding here.
    return { id, title, findings: [{ severity: "clear", text: "No related directorships found." }], empty: true };
  }
  return { id, title, findings };
}

function defaulterSection(id: string, title: string, ctx: Ctx): RenderedSection {
  const c = ctx.byId["cibil"];
  if (!c) return { id, title, findings: [], empty: true };
  if (c.status === "locked") return { id, title, findings: [{ severity: "info", text: `🔒 Upgrade to enable — ${c.note ?? "paid source"}` }], empty: true };
  if (c.status === "skipped") return { id, title, findings: [{ severity: "info", text: c.note ?? "Not run." }], empty: true };
  if (c.status === "error") return { id, title, findings: [{ severity: "info", text: `Source unavailable — ${c.note ?? "unknown error"}` }], empty: true };
  if (c.hits.length === 0) {
    return { id, title, findings: [{ severity: "clear", text: "No suit-filed / defaulter records found." }], empty: true };
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

// Exchange filings & disclosures. A filing whose text hits a concern term
// (resignation, SEBI penalty, auditor qualification, insolvency…) is amber;
// routine filings are info. Honest states for skip/error/empty.
function filingsSection(id: string, title: string, ctx: Ctx): RenderedSection {
  const c = ctx.byId["filings"];
  if (!c) return { id, title, findings: [], empty: true };
  if (c.status === "locked") return { id, title, findings: [{ severity: "info", text: `🔒 Upgrade to enable — ${c.note ?? "paid source"}` }], empty: true };
  if (c.status === "skipped") return { id, title, findings: [{ severity: "info", text: c.note ?? "Not run." }], empty: true };
  if (c.status === "error") return { id, title, findings: [{ severity: "info", text: `Source unavailable — ${c.note ?? "unknown error"}` }], empty: true };
  if (c.hits.length === 0) return { id, title, findings: [{ severity: "clear", text: c.note ?? "No filings in the period." }], empty: true };

  return {
    id,
    title,
    findings: c.hits.slice(0, 8).map((h) => {
      const flagged = (h.matchedKeywords?.length ?? 0) > 0;
      const when = h.date ? ` (${h.date})` : "";
      const text = flagged
        ? `${h.title}${when} — flags: ${h.matchedKeywords!.join(", ")}.`
        : `${h.title}${when}`;
      return {
        severity: (flagged ? "amber" : "info") as Severity,
        text,
        sourceRef: ctx.cite(c.sourceName, h.title, h.url),
      };
    }),
  };
}

function pressSection(id: string, title: string, ctx: Ctx): RenderedSection {
  const c = ctx.byId["google"];
  if (!c) return { id, title, findings: [], empty: true };
  if (c.status === "locked") return { id, title, findings: [{ severity: "info", text: `🔒 Upgrade to enable — ${c.note ?? "paid source"}` }], empty: true };
  if (c.status === "skipped") return { id, title, findings: [{ severity: "info", text: c.note ?? "Not run." }], empty: true };
  if (c.status === "error") return { id, title, findings: [{ severity: "info", text: `Source unavailable — ${c.note ?? "unknown error"}` }], empty: true };
  const hits = c.hits.slice(0, 6);
  if (hits.length === 0) return { id, title, findings: [{ severity: "clear", text: "No notable coverage found." }], empty: true };
  return {
    id,
    title,
    findings: hits.map((h) => ({
      severity:
        h.confidence === "unverified"
          ? ("info" as Severity)
          : (h.matchedKeywords?.length ?? 0) > 0
            ? severityForKeywords(h.matchedKeywords ?? [])
            : ("info" as Severity),
      text: h.confidence === "unverified" ? `${h.title} — name match only, not confirmed as this person` : h.title,
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
