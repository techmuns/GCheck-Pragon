import type {
  AppConfig,
  Citation,
  CollectorResult,
  Finding,
  RawHit,
  RenderedSection,
  Run,
  Severity,
  Subject,
} from "./types";
import { canonicalUrl } from "./collectors/types";
import { compareByHierarchy, seniorRole, type RankablePerson } from "./hierarchy";
import { nameFromTitle, samePerson, uniqueRefs } from "./people";

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

/** A collector's free-form `extra` field as a non-empty string, or nothing. */
function strField(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

interface Ctx {
  subject: Subject;
  byId: Record<string, CollectorResult | undefined>;
  citations: Citation[];
  cite: (sourceName: string, label: string, url?: string) => number;
  /** Concerning material was found under the subject's name but could not be
   *  tied to them — the state an unresolved director search lands in. */
  unattributed: boolean;
}

/** Is this a director we never managed to pin to a registry record? */
function unidentified(subject: Subject): boolean {
  return subject.type === "director" && !subject.din;
}

/** Litigation, or a red-flag keyword hit, that matched the subject's name and
 *  nothing else. Neither chargeable to them nor safe to ignore. */
function hasUnattributedConcern(collected: CollectorResult[]): boolean {
  return collected.some((c) =>
    c.hits.some(
      (h) => h.confidence === "unverified" && (c.sourceId === "indiankanoon" || (h.matchedKeywords?.length ?? 0) > 0),
    ),
  );
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

  const ctx: Ctx = { subject, byId, citations, cite, unattributed: hasUnattributedConcern(collected) };

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

  // A director we could not pin to a registry record is never "clear" merely
  // because nothing could be attributed to them. Concerning material WAS found
  // under this name; we just cannot say whose it is. "No red flags surfaced for
  // Rajesh Kumar" would be the most dangerous sentence in the brief — it reads
  // as a clean bill of health for a person nobody checked.
  if (unidentified(subject) && ctx.unattributed && verdict === "clear") verdict = "info";

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

  // Keyword hits from the coverage sweeps. Both are read, deduped on the
  // canonical URL, so a story indexed by the news engine and the web engine
  // alike is one finding rather than two.
  const flagged = new Map<string, { hit: RawHit; source: CollectorResult }>();
  for (const c of PRESS_IDS.map((sid) => ctx.byId[sid])) {
    if (c?.status !== "done") continue;
    for (const h of c.hits) {
      if ((h.matchedKeywords?.length ?? 0) === 0) continue;
      const key = canonicalUrl(h.url) ?? `title:${h.title.toLowerCase()}`;
      const existing = flagged.get(key);
      if (!existing || rankHit(h) > rankHit(existing.hit)) flagged.set(key, { hit: h, source: c });
    }
  }
  if (flagged.size > 0) {
    // A hit that matched only the subject's NAME may be about a namesake. It is
    // still worth showing — but it is not charged to this person: only hits
    // tied to their DIN or one of their companies get a risk severity, and so
    // only those can move the verdict.
    const all = [...flagged.values()];
    const attributable = all.filter(({ hit }) => hit.confidence !== "unverified");
    const nameOnly = all.length - attributable.length;
    for (const { hit: h, source } of attributable.slice(0, 4)) {
      // A story about the company that never names the person is a fact about
      // the company. Saying "Subject: <headline>" of it would be an accusation
      // the source does not make.
      const subjectNamed = h.extra?.namesSubject !== false;
      const who = subjectNamed ? (h.entity ?? "Subject") : `${h.entity ?? "The company"} (subject not named)`;
      findings.push({
        severity: severityForKeywords(h.matchedKeywords ?? []),
        text: `${who}: "${h.title}" — matched ${h.matchedKeywords!.join(", ")}.`,
        sourceRef: ctx.cite(source.sourceName, h.title, h.url),
      });
    }
    if (nameOnly > 0) {
      findings.push({
        severity: "info",
        text: `${nameOnly} further keyword hit(s) matched the name only — not confirmed as this person, and not counted in the verdict.`,
      });
    }
  }

  // Registry standing. These are facts on the public record rather than press,
  // so they are never "name-matched" — the register keyed them to this DIN.
  findings.push(...governanceFindings(ctx));

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
      unidentified(ctx.subject) && ctx.unattributed
        ? {
            severity: "info",
            text: "Material worth reviewing was found under this name, but none of it could be tied to a specific registered director — so none of it is charged to this person. Search a DIN, or add a company, to resolve who this is.",
          }
        : anyCompleted
          ? { severity: "clear", text: "No red flags surfaced across the sources that completed." }
          : { severity: "info", text: "No sources completed — results below are incomplete. Configure credentials/keys and re-run." },
    );
  }
  return { id: "red-flags", title, findings };
}

/**
 * Findings drawn from the register's own view of standing.
 *
 * A director whose companies are struck off, or who carries the register's
 * non-compliance flag, is a governance question in the plainest sense — and it
 * is one the old pipeline never asked, because nothing read the register past
 * the list of names. These sit above press hits deliberately: they are filings,
 * not coverage.
 */
function governanceFindings(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const registry of registryResults(ctx)) {
    if (registry.status !== "done") continue;
    for (const h of registry.hits.filter((r) => r.extra?.category === "governance")) {
      const flag = strField(h.extra?.flag);
      // A struck-off company in someone's history is worth a look, not an
      // accusation; a DIN that is not in good standing is a harder problem.
      const severity: Severity = flag === "din-status" ? "red" : "amber";
      out.push({ severity, text: h.title, sourceRef: ctx.cite(registry.sourceName, h.title, h.url) });
    }
  }
  return out;
}

/**
 * The registry sources, best-first.
 *
 * The MCA record is keyed to the DIN and carries the entity statuses, so it
 * leads; the aggregator still contributes designation and tenure, which the MCA
 * page does not publish. Callers take the first that actually answered rather
 * than naming one source, so neither being down empties a section.
 */
const REGISTRY_IDS = ["indiafilings", "registry"] as const;

function registryResults(ctx: Ctx): CollectorResult[] {
  return REGISTRY_IDS.map((id) => ctx.byId[id]).filter((c): c is CollectorResult => c != null);
}

/** The registry record's identity row, if the person resolved to one. */
function identityHit(ctx: Ctx) {
  for (const c of registryResults(ctx)) {
    const hit = c.hits.find((h) => h.extra?.category === "identity");
    if (hit) return hit;
  }
  return undefined;
}

/** The registry result that carried the identity row, so citations name the
 *  source the fact actually came from. */
function identitySource(ctx: Ctx): CollectorResult | undefined {
  return registryResults(ctx).find((c) => c.hits.some((h) => h.extra?.category === "identity"));
}

/**
 * The line that says which person this brief covers. This is the one finding a
 * director brief cannot do without: a name search that could not be pinned to a
 * DIN may have swept up a namesake, and the reader has to be told that in the
 * same breath as the findings — not left to assume otherwise.
 */
function identityFinding(ctx: Ctx): Finding {
  const registry = identitySource(ctx);
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
  const c = identitySource(ctx) ?? registryResults(ctx)[0];
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

/** One person in the Key People list, before they are ranked and cited. */
interface PersonRow extends RankablePerson {
  name: string;
  din?: string;
  /** The line as it will read on the page. */
  text: string;
  /** Offices another source gives them that this line doesn't already state. */
  also: string[];
  /** Every source that named this person — one citation each. */
  cites: Array<{ sourceName: string; label: string; url?: string }>;
}

/**
 * Add a person, folding them into a row already on the list when it is the same
 * person under another spelling. The first row wins the line, which is why the
 * richest source is gathered first: the registry's line carries the DIN and the
 * tenure, and Wikidata's "Mukesh Ambani — CEO" has nothing to add to it but the
 * office and its own citation.
 */
function addPerson(rows: PersonRow[], row: PersonRow): void {
  const existing = rows.find((r) => samePerson(r, row));
  if (!existing) {
    rows.push(row);
    return;
  }
  existing.cites.push(...row.cites);
  existing.din ??= row.din;
  existing.tenure ??= row.tenure;
  // An office the kept line doesn't already state is real information from a
  // real source — say it, and cite it, rather than dropping it with the row.
  // (A name the user typed carries no source, so it adds no office.)
  const stated = `${existing.text} ${existing.also.join(" ")}`.toLowerCase();
  if (row.role && row.cites.length > 0 && !stated.includes(row.role.toLowerCase())) {
    existing.also.push(row.role);
  }
  // Rank on the most senior office anyone attributes to them.
  existing.role = seniorRole(existing.role, row.role);
}

function managementSection(id: string, title: string, ctx: Ctx): RenderedSection {
  // Gather everyone first, rank second. The sources hand their people over in
  // their own order — the registry's is filing order, which buries the Managing
  // Director under the independent directors — so the list is re-ordered by
  // office before it is rendered (lib/hierarchy). Gathered richest-source-first,
  // because that is the row a duplicate merges into (lib/people).
  const people: PersonRow[] = [];

  // Directors from the free public registry record — the board of record,
  // including for unlisted companies. Cited to the aggregator that publishes it.
  // In director mode the same collector returns the subject themselves plus the
  // companies they sit on; the companies are directorships, not people, so only
  // the identity row belongs here.
  for (const registry of registryResults(ctx)) {
    if (registry.status !== "done") continue;
    // Both registries emit more than people — directorships, entity statuses —
    // so the board is taken from the rows that actually describe a person.
    const rows = registry.hits.filter((h) =>
      ctx.subject.type === "director"
        ? h.extra?.category === "identity" || h.extra?.category === "director"
        : h.extra?.category !== "directorship" && h.extra?.category !== "governance",
    );
    for (const d of rows) {
      addPerson(people, {
        name: strField(d.extra?.name) ?? nameFromTitle(d.title),
        din: strField(d.extra?.din),
        text: d.title,
        also: [],
        cites: [{ sourceName: registry.sourceName, label: d.title, url: d.url }],
        role: strField(d.extra?.designation),
        tenure: strField(d.extra?.tenure),
      });
    }
  }

  // Leadership from Wikidata (free) — CEO / chairperson / founders. In company
  // mode these are the people to know; in director mode the collector returns
  // the companies the person leads, which belong under Company & Directors, so
  // only fold Wikidata in here for a company subject.
  const wikidata = ctx.byId["wikidata"];
  if (wikidata?.status === "done" && ctx.subject.type !== "director") {
    for (const h of wikidata.hits) {
      // Wikidata company hits read "Name — Role"; the ladder needs the role.
      addPerson(people, {
        name: nameFromTitle(h.title),
        text: h.title,
        also: [],
        cites: [{ sourceName: wikidata.sourceName, label: h.title, url: h.url }],
        role: strField(h.extra?.role) ?? h.title.split(" — ")[1],
      });
    }
  }

  // Promoters the user supplied (the meeting subjects). No source backs a typed
  // name, so it carries no citation — but it is still a control role, and the
  // ladder ranks it as one. A promoter already on the board merges into their
  // own board row rather than appearing twice.
  for (const p of ctx.subject.promoters) {
    addPerson(people, { name: p, text: p, role: "Promoter", also: [], cites: [] });
  }

  // Cite only after ranking, so the citation numbers run down the section in
  // reading order instead of in the order the collectors happened to return.
  const findings: Finding[] = people
    .sort(compareByHierarchy)
    .map((p) => {
      const refs = uniqueRefs(p.cites.map((c) => ctx.cite(c.sourceName, c.label, c.url)));
      return {
        severity: "info" as Severity,
        text: p.also.length > 0 ? `${p.text} — also ${p.also.join(", ")}` : p.text,
        sourceRef: refs[0],
        sourceRefs: refs.length > 1 ? refs : undefined,
      };
    });

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
  // Both registries can list the same board seat; the MCA record leads, so a
  // company already named by it is not repeated from the aggregator.
  const namedCompanies = new Set<string>();
  for (const registry of registryResults(ctx)) {
    if (registry.status !== "done" || ctx.subject.type !== "director") continue;
    for (const h of registry.hits.filter((r) => r.extra?.category === "directorship").slice(0, 12)) {
      const company = (strField(h.extra?.company) ?? h.title).toLowerCase();
      if (namedCompanies.has(company)) continue;
      namedCompanies.add(company);
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

/** Coverage comes from two sources now — the dedicated news sweep and whatever
 *  the web sweep turned up. They index the same publishers, so the same story
 *  arrives twice and is folded on its canonical URL. */
const PRESS_IDS = ["news", "google"] as const;

function pressSection(id: string, title: string, ctx: Ctx): RenderedSection {
  const sources = PRESS_IDS.map((sid) => ctx.byId[sid]).filter((c): c is CollectorResult => c != null);
  if (sources.length === 0) return { id, title, findings: [], empty: true };

  const completed = sources.filter((c) => c.status === "done");
  if (completed.length === 0) {
    // Report the sharpest reason, not merely the first: "unavailable" tells the
    // reader to fix something, "not run" tells them to configure something.
    const errored = sources.find((c) => c.status === "error");
    const locked = sources.find((c) => c.status === "locked");
    const skipped = sources.find((c) => c.status === "skipped");
    const text = errored
      ? `Source unavailable — ${errored.note ?? "unknown error"}`
      : locked
        ? `🔒 Upgrade to enable — ${locked.note ?? "paid source"}`
        : (skipped?.note ?? "Not run.");
    return { id, title, findings: [{ severity: "info", text }], empty: true };
  }

  // Best copy of each story wins: a hit confirmed against the subject, or one
  // carrying keyword matches, beats a bare duplicate of the same URL.
  const byKey = new Map<string, { hit: RawHit; source: CollectorResult }>();
  for (const c of completed) {
    for (const h of c.hits) {
      const key = canonicalUrl(h.url) ?? `title:${h.title.toLowerCase()}`;
      const existing = byKey.get(key);
      if (!existing || rankHit(h) > rankHit(existing.hit)) byKey.set(key, { hit: h, source: c });
    }
  }

  const hits = [...byKey.values()].slice(0, 6);
  if (hits.length === 0) return { id, title, findings: [{ severity: "clear", text: "No notable coverage found." }], empty: true };

  return {
    id,
    title,
    findings: hits.map(({ hit: h, source }) => ({
      severity:
        h.confidence === "unverified"
          ? ("info" as Severity)
          : (h.matchedKeywords?.length ?? 0) > 0
            ? severityForKeywords(h.matchedKeywords ?? [])
            : ("info" as Severity),
      text: pressText(h),
      sourceRef: ctx.cite(source.sourceName, h.title, h.url),
    })),
  };
}

function rankHit(h: RawHit): number {
  return (h.confidence === "confirmed" ? 2 : 0) + ((h.matchedKeywords?.length ?? 0) > 0 ? 1 : 0) + (h.date ? 1 : 0);
}

/**
 * How a piece of coverage is worded.
 *
 * Three states, and conflating them is how a brief ends up asserting something
 * it cannot support: a story naming the subject, a story about one of their
 * companies that never names them, and a story that merely matched the name.
 */
function pressText(h: RawHit): string {
  if (h.confidence === "unverified") return `${h.title} — name match only, not confirmed as this person`;
  if (h.extra?.namesSubject === false && h.entity) return `${h.title} — coverage of ${h.entity}; the subject is not named`;
  return h.title;
}

function buildHeadline(verdict: Severity, ctx: Ctx): string {
  const name = ctx.subject.company;
  const skipped = Object.values(ctx.byId).filter((c) => c?.status === "skipped").length;
  const tail = skipped > 0 ? ` ${skipped} source(s) not configured.` : "";
  // The headline a partner reads first has to carry the doubt, not bury it.
  if (unidentified(ctx.subject) && ctx.unattributed) {
    return `Could not confirm which ${name} this is — concerning material exists under the name but none of it is tied to a registered director. Search a DIN, or add a company, before relying on this.${tail}`;
  }
  if (unidentified(ctx.subject)) {
    return `No red flags surfaced under the name ${name}, but no unique registry record matched it — this is not confirmed to be one specific person.${tail}`;
  }
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
