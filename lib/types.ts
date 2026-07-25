// ── Core domain types ─────────────────────────────────────────────────────
// Shared across the input experience, retrieval engine, synthesis, and admin.

/** Severity of a governance finding — maps to the design-system signal colours. */
export type Severity = "red" | "amber" | "clear" | "info";

/** A configurable data source the research workflow pulls from. */
export interface Source {
  id: string;
  name: string;
  /** How the source is queried. */
  kind: "api" | "browser";
  /** Human note on what it covers. */
  description: string;
  /** Whether the workflow currently uses it. */
  enabled: boolean;
  /** Optional site the source lives at (for the sources appendix). */
  url?: string;
  /** Gated behind a paid upgrade (paid server / paid API). Shown as
   * "Upgrade required" in the UI and skipped by the workflow until unlocked. */
  locked?: boolean;
  /** Why it's locked — e.g. "Requires the paid Indian Kanoon API token". */
  lockReason?: string;
}

/** A red-flag keyword used to build Google/news queries. Editable by admin. */
export interface Keyword {
  id: string;
  term: string;
  enabled: boolean;
}

/** A configurable section of the one-page partner brief. */
export interface BriefSection {
  id: string;
  title: string;
  /** Plain-English "so what?" hint shown to the admin. */
  hint: string;
  enabled: boolean;
  /** Display order in the brief. */
  order: number;
}

/** The editable config the admin panel (Phase 4) owns. */
export interface AppConfig {
  sources: Source[];
  keywords: Keyword[];
  sections: BriefSection[];
  /** System prompt steering the OpenAI synthesis (Phase 3). Editable by admin. */
  synthesisPrompt: string;
}

// ── Research run ───────────────────────────────────────────────────────────

export type RunStatus = "queued" | "running" | "complete" | "error";

/** Progress of a single source during a run. */
export interface SourceProgress {
  sourceId: string;
  name: string;
  kind: Source["kind"];
  status: "pending" | "running" | "done" | "skipped" | "error" | "locked";
  /** Count of raw hits returned (Phase 2 fills this in). */
  hits?: number;
  /** Honest reason a source was skipped, errored, or is locked. */
  note?: string;
}

/** A single finding surfaced in the brief. */
export interface Finding {
  severity: Severity;
  text: string;
  /** Index into the run's sources appendix. */
  sourceRef?: number;
}

/** One rendered section of the finished brief. */
export interface RenderedSection {
  id: string;
  title: string;
  findings: Finding[];
  /** Honest empty state — never faked. */
  empty?: boolean;
}

/** A source citation for the appendix. */
export interface Citation {
  ref: number;
  sourceName: string;
  label: string;
  url?: string;
}

/** The subject of a research run. */
export interface Subject {
  /** Whether this run targets a company or an individual director/person.
   * Defaults to "company" when absent (back-compat with earlier runs). */
  type?: "company" | "director";
  /** The primary subject name — a company name, or (in director mode) a
   * person's name. Kept as `company` so existing display code keeps working. */
  company: string;
  /** Associated promoters/directors — company mode only. */
  promoters: string[];
  /** Optional stock ticker (e.g. "RELIANCE") — enables exchange-filings lookup. */
  ticker?: string;
}

// ── Retrieval (Phase 2) ────────────────────────────────────────────────────

/** A generated search query, tied to the entity and keyword it came from. */
export interface GeneratedQuery {
  /** The entity this query targets. */
  entity: string;
  entityKind: "company" | "promoter";
  /** The keyword that seeded it, if any. */
  keyword?: string;
  /** The final query string handed to the source. */
  query: string;
}

/** A single raw result from a source, before normalisation/synthesis. */
export interface RawHit {
  title: string;
  url?: string;
  snippet?: string;
  /** Which entity this hit concerns. */
  entity?: string;
  /** Red-flag keywords found in the hit. */
  matchedKeywords?: string[];
  /** Free-form date/period string as the source reported it. */
  date?: string;
  /** Source-specific extra fields, kept for the record. */
  extra?: Record<string, unknown>;
}

/** The outcome of running one collector. */
export interface CollectorResult {
  sourceId: string;
  sourceName: string;
  kind: Source["kind"];
  status: "done" | "skipped" | "error" | "locked";
  /** Honest reason for skip/error — surfaced to the user, never hidden. */
  note?: string;
  hits: RawHit[];
  /** The queries this collector actually ran (for transparency). */
  queries?: string[];
}

/** A full research run — from input through to the finished brief. */
export interface Run {
  id: string;
  subject: Subject;
  status: RunStatus;
  createdAt: string;
  progress: SourceProgress[];
  /** Raw collector output (Phase 2). Synthesis (Phase 3) reads from here. */
  collected?: CollectorResult[];
  /** Populated once synthesis (Phase 3) completes. */
  brief?: {
    verdict: Severity;
    headline: string;
    sections: RenderedSection[];
    citations: Citation[];
    /** Which engine wrote the narrative. */
    synthesizedBy?: "ai" | "rules";
  };
  error?: string;
}
