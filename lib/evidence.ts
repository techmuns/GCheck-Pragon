import type { Citation, CollectorResult, RawHit, Subject } from "./types";

// ── Extract · normalise · dedupe ───────────────────────────────────────────
// Turns raw collector output into clean, deduplicated EVIDENCE with stable
// citation refs built from real hits. Both the OpenAI synthesiser and the
// deterministic assembler can consume this. Citations only ever point at real
// URLs/sources — nothing here is invented.

export interface EvidenceItem {
  ref: number;
  sourceId: string;
  sourceName: string;
  title: string;
  url?: string;
  snippet?: string;
  entity?: string;
  matchedKeywords?: string[];
  /** Whether this item could be tied to the subject's own identity (DIN or one
   *  of their companies) or merely matched their name. Carried through to the
   *  model, which must not charge a name-only item to the subject. */
  confidence?: RawHit["confidence"];
  extra?: Record<string, unknown>;
}

export interface SourceStatus {
  sourceId: string;
  sourceName: string;
  kind: "api" | "browser";
  status: CollectorResult["status"];
  note?: string;
  itemCount: number;
}

export interface Evidence {
  subject: Subject;
  items: EvidenceItem[];
  citations: Citation[];
  sourceStatuses: SourceStatus[];
  anyCompleted: boolean;
}

function normaliseTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

/** A dedup key — prefer URL, else source+title. */
function keyOf(sourceId: string, hit: RawHit): string {
  if (hit.url) return `url:${hit.url.replace(/[#?].*$/, "").toLowerCase()}`;
  return `st:${sourceId}:${normaliseTitle(hit.title).toLowerCase()}`;
}

export function buildEvidence(subject: Subject, collected: CollectorResult[]): Evidence {
  const items: EvidenceItem[] = [];
  const citations: Citation[] = [];
  const sourceStatuses: SourceStatus[] = [];
  const seen = new Set<string>();

  for (const c of collected) {
    sourceStatuses.push({
      sourceId: c.sourceId,
      sourceName: c.sourceName,
      kind: c.kind,
      status: c.status,
      note: c.note,
      itemCount: c.hits.length,
    });

    for (const hit of c.hits) {
      const title = normaliseTitle(hit.title);
      if (!title) continue;
      const key = keyOf(c.sourceId, hit);
      if (seen.has(key)) continue;
      seen.add(key);

      const ref = citations.length + 1;
      citations.push({ ref, sourceName: c.sourceName, label: title, url: hit.url });
      items.push({
        ref,
        sourceId: c.sourceId,
        sourceName: c.sourceName,
        title,
        url: hit.url,
        snippet: hit.snippet ? normaliseTitle(hit.snippet) : undefined,
        entity: hit.entity,
        matchedKeywords: hit.matchedKeywords?.length ? hit.matchedKeywords : undefined,
        confidence: hit.confidence,
        extra: hit.extra,
      });
    }
  }

  return {
    subject,
    items,
    citations,
    sourceStatuses,
    anyCompleted: collected.some((c) => c.status === "done"),
  };
}

/** A compact, model-friendly rendering of the evidence for the LLM prompt. */
export function evidenceForPrompt(ev: Evidence, sectionTitles: string[]): string {
  const lines: string[] = [];
  lines.push(`SUBJECT: company="${ev.subject.company}", promoters=[${ev.subject.promoters.join(", ") || "none provided"}]`);
  // A director subject's identity, spelled out for the model: which person this
  // is, and — when we could not establish that — that the evidence below is
  // only name-matched, which changes what may honestly be concluded from it.
  if (ev.subject.type === "director") {
    lines.push(
      ev.subject.din
        ? `SUBJECT IDENTITY: DIN ${ev.subject.din}; linked companies=[${(ev.subject.anchors ?? []).join(", ") || "none read"}]`
        : "SUBJECT IDENTITY: NOT ESTABLISHED — no unique registry record matched this name. Every item below is a name match and may concern a different person of the same name.",
    );
  }
  lines.push("");
  lines.push("SOURCE STATUS:");
  for (const s of ev.sourceStatuses) {
    const detail = s.status === "done" ? `${s.itemCount} item(s)` : (s.note ?? s.status);
    lines.push(`  - ${s.sourceName} [${s.kind}]: ${s.status} — ${detail}`);
  }
  lines.push("");
  lines.push("EVIDENCE ITEMS (cite by [ref]):");
  if (ev.items.length === 0) {
    lines.push("  (none — no source returned data)");
  } else {
    for (const it of ev.items) {
      const kw = it.matchedKeywords ? ` matched:{${it.matchedKeywords.join(",")}}` : "";
      const extra = it.extra?.category ? ` category:{${String(it.extra.category)}}` : "";
      const conf = it.confidence ? ` identity:{${it.confidence}}` : "";
      const snip = it.snippet ? ` — ${it.snippet.slice(0, 240)}` : "";
      lines.push(`  [${it.ref}] (${it.sourceName}${it.entity ? `, ${it.entity}` : ""}${kw}${extra}${conf}) ${it.title}${snip}`);
    }
  }
  lines.push("");
  lines.push(`SECTIONS TO PRODUCE (in this order): ${sectionTitles.join(" | ")}`);
  return lines.join("\n");
}
