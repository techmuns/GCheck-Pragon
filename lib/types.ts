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
  /** Every source behind the finding, when more than one carries it — a
   *  director both the registry and Wikidata name, say. `sourceRef` stays the
   *  first of these, so anything reading a single citation still works. */
  sourceRefs?: number[];
}

/** One rendered section of the finished brief. */
export interface RenderedSection {
  id: string;
  title: string;
  findings: Finding[];
  /** Honest empty state — never faked. */
  empty?: boolean;
  /** What to print when the section has nothing to itemise. The assembler sets
   *  it where the honest wording depends on WHY it is empty — "nothing was
   *  found" and "things were found but could not be tied to this person" are
   *  different answers and must not share a sentence. */
  emptyText?: string;
}

/** A source citation for the appendix. */
export interface Citation {
  ref: number;
  sourceName: string;
  label: string;
  url?: string;
}

/** One row of the search-box typeahead. Structured rather than a bare string so
 *  a company suggestion can show its sector and carry its ticker, and a director
 *  suggestion its DIN, without the two modes needing different plumbing. */
export interface Suggestion {
  /** What lands in the input when this row is picked — the plain company name,
   *  or the DIN-encoded director string the run parses back apart. */
  value: string;
  /** The primary line shown in the dropdown. */
  label: string;
  /** The secondary line — sector · country for a company, DIN · company for a
   *  director. */
  sub?: string;
  /** A listed company's ticker, carried through so the run can enable
   *  exchange-filings lookup for it. */
  ticker?: string;
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
  /** Director mode: the person's 8-digit DIN, once resolved. Unique to one
   *  registered director, so it is the only identifier here that cannot be
   *  confused between namesakes. */
  din?: string;
  /** Companies the subject is tied to. Used to anchor queries and to tell a
   *  result about *this* person from one about someone with the same name. */
  anchors?: string[];
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

// ── Live activity log ──────────────────────────────────────────────────────
// A run used to report only six coarse statuses, which said nothing about what
// it was actually doing for the minutes in between. These events are the record
// of the work itself — one line per query issued, page opened, cache reuse and
// skip — so the screen can show the run rather than an animation of one.

/** What kind of step an activity-log line describes. */
export type RunEventLevel = "step" | "query" | "fetch" | "cache" | "skip" | "warn";

/** One line of the live activity log: what the system did, and when. */
export interface RunEvent {
  /** ISO timestamp. */
  at: string;
  /** The source that did it, where one owns the step. */
  sourceId?: string;
  level: RunEventLevel;
  text: string;
  /** The page or endpoint involved, when the step had one. */
  url?: string;
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
  /** How sure we are this hit is about the subject rather than a namesake.
   *  "confirmed" — the text carries the subject's DIN or one of its anchor
   *  companies alongside the name. "unverified" — the name matched and nothing
   *  else did. Absent for sources that identify the subject by key rather than
   *  by name search (a registry record is not a guess). */
  confidence?: "confirmed" | "unverified";
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
  /** Everything the run has done so far, oldest first. Rides the same poll as
   *  `progress`, so the client needs no new transport to show it. */
  events?: RunEvent[];
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
