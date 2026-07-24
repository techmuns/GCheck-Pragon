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
}

// ── Research run ───────────────────────────────────────────────────────────

export type RunStatus = "queued" | "running" | "complete" | "error";

/** Progress of a single source during a run. */
export interface SourceProgress {
  sourceId: string;
  name: string;
  kind: Source["kind"];
  status: "pending" | "running" | "done" | "skipped" | "error";
  /** Count of raw hits returned (Phase 2 fills this in). */
  hits?: number;
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
  company: string;
  promoters: string[];
}

/** A full research run — from input through to the finished brief. */
export interface Run {
  id: string;
  subject: Subject;
  status: RunStatus;
  createdAt: string;
  progress: SourceProgress[];
  /** Populated once synthesis (Phase 3) completes. */
  brief?: {
    verdict: Severity;
    headline: string;
    sections: RenderedSection[];
    citations: Citation[];
  };
  error?: string;
}
