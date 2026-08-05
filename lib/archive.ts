import { formatSuggestion } from "./directorId";
import { assessRisk, type Band } from "./risk";
import { reconcile } from "./verdict";
import type { CollectorResult, Run, Severity, Subject } from "./types";

// ── The record of what has been run ──────────────────────────────────────────
// A run lives on the server in a `globalThis` Map that a redeploy or an idle
// timeout wipes, and the front page kept the last five *queries* in local
// storage — the names, not the outcomes, and never the time they were run. So
// "what did we screen last Tuesday, and what did it say" had no answer anywhere.
//
// This module is the shape of the answer. It is deliberately split in two:
//
//   ArchiveEntry     one small row per run — subject, timestamps, verdict,
//                    counts. Cheap enough to keep hundreds of, and the thing
//                    that survives when nothing else does.
//   ArchivedRunBody  a trimmed copy of the run itself, structurally a `Run`, so
//                    the finished brief can be re-rendered from the browser
//                    with no server behind it.
//
// The trimming is where the honesty risk sits. Dropping `events` costs nothing
// — no part of the brief reads them. Dropping collector hits is different: the
// concerns, the news table, the directorships, the CIN and the risk score are
// all computed back out of `collected`, so a snapshot that trims too eagerly
// re-renders as a quieter brief than the one that was written, with nothing on
// screen to say so. The rule below therefore keeps every hit from every source
// except the two genuinely fat ones (news and the web sweep), caps those, and
// records the pre-trim count on the record so the brief's own clarifications
// still report what the source actually returned.
//
// No storage, no React and no `window` here — see lib/archiveStore.ts for the
// persistence and lib/useArchive.ts for the hook.

export const ARCHIVE_VERSION = 1;

/** How a run ended, as far as this browser was able to see.
 *
 *  "unknown" is a real outcome, not a placeholder: a run closed from the rail
 *  keeps going on the server, and a tab shut mid-run never sees the finish. The
 *  app knows it stopped watching; it does not know the run failed, and must not
 *  say so.
 *
 *  "legacy" is a row carried over from the recent-search list this archive
 *  replaced. Those rows are a subject and a time; no outcome was ever recorded
 *  for them, and saying the tab stopped watching would be inventing a story
 *  about a run nothing was ever kept about. */
export type ArchiveOutcome = "running" | "complete" | "error" | "unknown" | "legacy";

/** One row of history — everything the list needs, and nothing that costs. */
export interface ArchiveEntry {
  /** The client-side run key. It exists before the POST returns, so a run whose
   *  start failed outright still gets a row. */
  id: string;
  /** The server's run id, once issued. Lets "Open" ask the server for the live
   *  run before falling back to the saved copy. */
  serverId?: string;
  /** Set when this run was started off another brief — a director picked from a
   *  board. The list nests these under their parent rather than showing them as
   *  searches made from the front door. */
  parentId?: string;
  /** Whether this belongs in the front page's short recent list. */
  showInRecent: boolean;
  /** Exactly the string handed to `start()` — for a director that is the
   *  DIN-decorated form, which is what makes "Run again" re-run the same person
   *  rather than everyone who shares their name. */
  rawQuery: string;
  type: "company" | "director";
  /** The display name — what the row shows. */
  company: string;
  promoters: string[];
  ticker?: string;
  din?: string;
  /** ISO. Always present. */
  startedAt: string;
  /** ISO. Absent when this browser never saw the run land. */
  finishedAt?: string;
  durationMs?: number;
  outcome: ArchiveOutcome;
  error?: string;
  verdict?: Severity;
  headline?: string;
  /** Reconciled counts — the same tally the brief prints, so a row and the
   *  document it opens can never disagree. */
  red: number;
  amber: number;
  riskScore?: number;
  riskBand?: Band;
  sourcesDone: number;
  sourcesTotal: number;
  boardDone?: number;
  boardTotal?: number;
  /** Whether a re-openable copy of the brief is still stored. Snapshots are a
   *  rolling window; rows are not. */
  hasBody: boolean;
  /** Set when a snapshot was built and storage refused it. Stops every later
   *  mount rebuilding the same 65 KB snapshot and evicting other people's
   *  briefs to make room it will be refused again. */
  bodyFailed?: boolean;
  /** Serialised size of the snapshot, for the eviction budget. */
  bytes: number;
}

/** A trimmed run, still structurally a `Run`, so `BriefView`, `buildPrintBrief`,
 *  `assessRisk`, `buildScope` and `buildNetwork` all read it unmodified. */
export type ArchivedRunBody = Omit<Run, "events" | "error"> & {
  brief: NonNullable<Run["brief"]>;
};

export interface ArchivedRun {
  v: number;
  entry: ArchiveEntry;
  run: ArchivedRunBody;
}

// ── Trimming ────────────────────────────────────────────────────────────────

/** Snippets are quoted at a few lines; the rest is weight. */
export const SNIPPET_MAX = 400;
/** The two sources that sweep the open web and come back with hundreds. */
export const FAT_SOURCES = new Set(["news", "google"]);
export const FAT_HITS_MAX = 40;
export const HITS_MAX = 80;
export const EXCLUDED_MAX = 6;
/** A single snapshot past this is trimmed harder rather than stored whole. */
export const BODY_SOFT_MAX = 400 * 1024;

function trimHits(c: CollectorResult, cap: number): CollectorResult {
  return {
    ...c,
    // The count the source actually returned, kept so the brief's
    // clarifications ("42 results kept", "nothing on record") stay true of the
    // run rather than of the copy.
    originalHits: c.originalHits ?? c.hits.length,
    hits: c.hits.slice(0, cap).map((h) =>
      h.snippet && h.snippet.length > SNIPPET_MAX ? { ...h, snippet: `${h.snippet.slice(0, SNIPPET_MAX)}…` } : h,
    ),
    excluded: c.excluded?.slice(0, EXCLUDED_MAX),
  };
}

export function trimCollected(collected: CollectorResult[]): CollectorResult[] {
  return collected.map((c) => trimHits(c, FAT_SOURCES.has(c.sourceId) ? FAT_HITS_MAX : HITS_MAX));
}

export function byteLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * A re-openable copy of a finished run.
 *
 * `events` go — the activity log is the record of the work, and the work is
 * over. `error` goes with them; a body only exists for a run that produced a
 * brief. Everything the document is built from stays.
 */
export function snapshotRun(run: Run): ArchivedRunBody | null {
  if (!run.brief) return null;

  const body: ArchivedRunBody = {
    id: run.id,
    subject: run.subject,
    status: run.status,
    createdAt: run.createdAt,
    progress: run.progress,
    brief: run.brief,
    diligence: run.diligence,
    collected: run.collected ? trimCollected(run.collected) : undefined,
  };

  // One more pass for the rare enormous run, taking it out of the open-web
  // sources only — those are rankings, and the tail of a ranking is the part
  // nothing downstream reads.
  if (byteLength(body) > BODY_SOFT_MAX && body.collected) {
    body.collected = body.collected.map((c) =>
      FAT_SOURCES.has(c.sourceId) ? trimHits(c, 12) : c,
    );
  }

  return body;
}

// ── Building and updating rows ──────────────────────────────────────────────

export interface StartInput {
  id: string;
  rawQuery: string;
  subject: Subject;
  startedAt: number;
  parentId?: string;
  showInRecent: boolean;
}

export function entryFromStart(i: StartInput): ArchiveEntry {
  return {
    id: i.id,
    parentId: i.parentId,
    showInRecent: i.showInRecent,
    rawQuery: i.rawQuery,
    type: i.subject.type ?? "company",
    company: i.subject.company,
    promoters: i.subject.promoters,
    ticker: i.subject.ticker,
    din: i.subject.din,
    startedAt: new Date(i.startedAt).toISOString(),
    outcome: "running",
    red: 0,
    amber: 0,
    sourcesDone: 0,
    sourcesTotal: 0,
    hasBody: false,
    bytes: 0,
  };
}

/**
 * A row for a run this browser only met once it was already over — restored
 * after a reload, say. There is no `start()` call to take the raw query from,
 * so it is rebuilt from the identity on the record: for a director that means
 * putting the DIN back, or "Run again" would send a bare name into a sweep that
 * cannot tell two people of that name apart.
 */
export function entryFromRun(id: string, run: Run, startedAt?: number): ArchiveEntry {
  const s = run.subject;
  const type = s.type ?? "company";
  const createdAt = Date.parse(run.createdAt);
  return {
    id,
    serverId: run.id,
    showInRecent: true,
    // The anchor company goes back into the query with the DIN. For a namesake
    // the register could not resolve, that anchor is the only thing separating
    // this person from the others of their name, and a re-run without it is a
    // sweep across all of them.
    rawQuery: type === "director" ? formatSuggestion({ name: s.company, din: s.din, companies: s.anchors }) : s.company,
    type,
    company: s.company,
    promoters: s.promoters,
    ticker: s.ticker,
    din: s.din,
    // Never `?? Date.now()` off a Date.parse: an unparseable date yields NaN,
    // which is not nullish, and `new Date(NaN).toISOString()` throws.
    startedAt: new Date(startedAt ?? (Number.isFinite(createdAt) ? createdAt : Date.now())).toISOString(),
    outcome: "running",
    red: 0,
    amber: 0,
    sourcesDone: 0,
    sourcesTotal: 0,
    hasBody: false,
    bytes: 0,
  };
}

/** When the run actually landed, taken from the run's own record rather than
 *  from the clock — a snapshot written during a reload the next morning would
 *  otherwise report a run that took fourteen hours. */
function landedAt(run: Run): number | undefined {
  const last = run.events?.[run.events.length - 1]?.at;
  const t = last ? Date.parse(last) : NaN;
  return Number.isFinite(t) ? t : undefined;
}

export interface FinishInput {
  bytes: number;
  hasBody: boolean;
  /** A snapshot was built and storage refused it — different from a run that
   *  never had one, and the thing that stops every later mount trying again. */
  bodyFailed: boolean;
  now: number;
}

export function finishEntry(prev: ArchiveEntry, run: Run, i: FinishInput): ArchiveEntry {
  const rec = reconcile(run);
  const risk = run.brief ? assessRisk(run) : null;
  const s = run.subject;

  // A finish already recorded keeps its own timestamp. Re-deriving it on a
  // later visit is how a 90-second run comes to report a duration of a day.
  const finishedAt = prev.finishedAt ?? new Date(landedAt(run) ?? i.now).toISOString();
  const started = Date.parse(prev.startedAt);
  const finished = Date.parse(finishedAt);
  const durationMs =
    prev.durationMs ?? (Number.isFinite(started) && Number.isFinite(finished) && finished >= started
      ? finished - started
      : undefined);

  return {
    ...prev,
    serverId: prev.serverId ?? run.id,
    // The subject resolves during the run — a bare DIN becomes a person, a
    // company picks up its ticker — so the row adopts what the register said.
    type: s.type ?? prev.type,
    company: s.company || prev.company,
    promoters: s.promoters ?? prev.promoters,
    ticker: s.ticker ?? prev.ticker,
    din: s.din ?? prev.din,
    rawQuery:
      (s.type ?? prev.type) === "director" && s.din
        ? formatSuggestion({ name: s.company, din: s.din, companies: s.anchors })
        : prev.rawQuery,
    finishedAt,
    durationMs,
    outcome: "complete",
    error: undefined,
    verdict: rec?.verdict ?? run.brief?.verdict,
    headline: run.brief?.headline,
    red: rec?.red ?? 0,
    amber: rec?.amber ?? 0,
    riskScore: risk?.score,
    riskBand: risk?.band,
    sourcesDone: run.progress.filter((p) => p.status === "done").length,
    sourcesTotal: run.progress.length,
    boardDone: rec?.board.total ? rec.board.done : undefined,
    boardTotal: rec?.board.total || undefined,
    hasBody: i.hasBody,
    bodyFailed: i.bodyFailed || undefined,
    bytes: i.bytes,
  };
}

export function errorEntry(prev: ArchiveEntry, message: string, now: number): ArchiveEntry {
  const finishedAt = new Date(now).toISOString();
  const started = Date.parse(prev.startedAt);
  return {
    ...prev,
    finishedAt,
    durationMs: Number.isFinite(started) ? now - started : undefined,
    outcome: "error",
    error: message,
  };
}

/** The run kept going; this browser stopped watching. */
export function unknownEntry(prev: ArchiveEntry): ArchiveEntry {
  return { ...prev, outcome: "unknown" };
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** How long a run can plausibly still be in flight — the client's own timeout
 *  (lib/useRuns.ts). Past it, a row still marked "running" is a run this
 *  browser never saw the end of. */
export const STALE_AFTER_MS = 20 * 60 * 1000;

export function unresolved(e: ArchiveEntry, now = Date.now()): boolean {
  if (e.outcome === "unknown") return true;
  if (e.outcome !== "running") return false;
  const started = Date.parse(e.startedAt);
  return Number.isFinite(started) && now - started > STALE_AFTER_MS;
}

/** A stable identity for a subject, so the front page's short list holds five
 *  distinct subjects rather than five re-runs of one. History itself is never
 *  deduped — every run with its own timestamp is the entire point. */
export function subjectKey(e: Pick<ArchiveEntry, "type" | "company" | "din" | "promoters">): string {
  const promoters = [...e.promoters].map((p) => p.toLowerCase()).sort().join(",");
  return `${e.type}|${e.din ?? e.company.toLowerCase()}|${promoters}`;
}

export function listRecent(entries: ArchiveEntry[], max = 5): ArchiveEntry[] {
  const seen = new Set<string>();
  const out: ArchiveEntry[] = [];
  for (const e of entries) {
    if (!e.showInRecent || e.parentId) continue;
    const k = subjectKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
    if (out.length >= max) break;
  }
  return out;
}

/** The runs that read as searches the user made — children are reachable
 *  through their parent, so counting them makes the rail's badge describe
 *  something no screen shows. */
export function countSearches(entries: ArchiveEntry[]): number {
  return entries.filter((e) => !e.parentId).length;
}
