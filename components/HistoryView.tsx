"use client";

import { useMemo, useRef, useState } from "react";
import { severityStyle } from "./severity";
import { countSearches, subjectKey, unresolved, type ArchiveEntry } from "@/lib/archive";
import { formatGenerated } from "@/lib/printBrief";
import { clock } from "@/lib/text";
import type { Severity } from "@/lib/types";

// ── Everything that has been run ─────────────────────────────────────────────
// The front page keeps five recent subjects; this is the record. Every
// pre-screen, newest first, with the date and time it was started, what it
// concluded, and how long it took — grouped by day, because "what did we look
// at on Tuesday" is how anyone actually asks.
//
// It is a state of the page rather than a route on purpose. The poll that
// advances every run in flight is an interval owned by the front page's mount
// (lib/useRuns.ts); navigating away to /history would freeze every running
// pre-screen until the user came back, which is precisely the cost the run rail
// was built to remove.
//
// Two things this screen must never do. It must not dedupe: five runs of one
// company on five days are five rows, and telling them apart is the request.
// And it must not offer a control that does nothing — a run whose saved copy
// has been evicted says so and offers the re-run instead of an "Open" that
// opens nothing.

type Range = "all" | "today" | "7d" | "30d";

const RANGE_LABEL: Record<Range, string> = {
  all: "Any time",
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
};

const RANGE_MS: Record<Exclude<Range, "all" | "today">, number> = {
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

// Every verdict a finished run can carry, "Note" included — lib/assemble.ts
// settles on "info" for a run that completed and found nothing to itemise, and
// leaving it out made those runs the one kind the filter could not reach.
const VERDICT_FILTERS: Severity[] = ["red", "amber", "clear", "info"];

interface Props {
  entries: ArchiveEntry[];
  opening: string | null;
  onRunAgain: (rawQuery: string, promoters: string[], type: "company" | "director", ticker?: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onExport: () => void;
  onImport: (raw: string) => void;
  notice?: string | null;
}

export default function HistoryView({
  entries,
  opening,
  onRunAgain,
  onOpen,
  onDelete,
  onClear,
  onExport,
  onImport,
  notice,
}: Props) {
  const [query, setQuery] = useState("");
  const [verdicts, setVerdicts] = useState<Set<Severity>>(new Set());
  const [range, setRange] = useState<Range>("all");
  /** Clear-all asks twice rather than throwing a browser dialog at the reader —
   *  the second press within a few seconds is the confirmation. */
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    const floor =
      range === "all"
        ? 0
        : range === "today"
          ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
          : now - RANGE_MS[range];

    return entries.filter((e) => {
      if (Date.parse(e.startedAt) < floor) return false;
      if (verdicts.size > 0 && !(e.verdict && verdicts.has(e.verdict))) return false;
      if (!q) return true;
      return (
        e.company.toLowerCase().includes(q) ||
        e.din?.includes(q) ||
        e.ticker?.toLowerCase().includes(q) ||
        e.headline?.toLowerCase().includes(q) ||
        e.promoters.some((p) => p.toLowerCase().includes(q))
      );
    });
  }, [entries, query, verdicts, range]);

  /** The previous run of the same subject, so a row can say the answer changed
   *  since last time — which is the whole reason to run something twice. */
  const previousVerdict = useMemo(() => {
    const seen = new Map<string, Severity>();
    const out = new Map<string, Severity>();
    // Oldest first, so each run sees the one before it.
    for (const e of [...entries].reverse()) {
      const k = subjectKey(e);
      const before = seen.get(k);
      if (before && e.verdict && before !== e.verdict) out.set(e.id, before);
      if (e.verdict) seen.set(k, e.verdict);
    }
    return out;
  }, [entries]);

  // Children are started after their parent, so a newest-first list puts them
  // above it — and an indent under a row that is not there reads as an indent
  // under whatever happens to sit above. Each child is moved to sit directly
  // beneath its parent, which is the only arrangement the indent describes.
  const ordered = useMemo(() => nestUnderParents(filtered), [filtered]);
  const groups = useMemo(() => groupByDay(ordered), [ordered]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const filtering = query.trim() !== "" || verdicts.size > 0 || range !== "all";

  function toggleVerdict(v: Severity): void {
    setVerdicts((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function clearAll(): void {
    if (!confirming) {
      setConfirming(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirming(false), 4000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirming(false);
    onClear();
  }

  return (
    <div className="no-print card-surface fade-in mx-auto w-full max-w-3xl p-6 sm:p-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <div className="eyebrow mb-1">History</div>
          <h1 className="font-display text-[26px] leading-tight text-navy-deep">Everything you’ve run</h1>
          <p className="mt-1 text-[13.5px] text-ink-secondary">
            Every pre-screen started in this browser, newest first, with the date and time it was run.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-1">
          <button
            type="button"
            onClick={onExport}
            disabled={entries.length === 0}
            className="text-[12px] font-medium text-navy-primary transition hover:text-navy-deep disabled:opacity-40"
          >
            Export
          </button>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="text-[12px] font-medium text-navy-primary transition hover:text-navy-deep"
          >
            Import
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={entries.length === 0}
            className={`text-[12px] font-medium transition disabled:opacity-40 ${
              confirming ? "text-coral" : "text-navy-primary hover:text-navy-deep"
            }`}
          >
            {confirming ? "Clear all — press again" : "Clear all"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(ev) => {
              const file = ev.target.files?.[0];
              ev.target.value = "";
              if (!file) return;
              void file.text().then(onImport);
            }}
          />
        </div>
      </div>

      {notice && (
        <p className="mb-4 rounded-lg bg-ice px-3 py-2 text-[12.5px] text-ink-primary" role="status">
          {notice}
        </p>
      )}

      {entries.length > 0 && (
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, DIN or ticker"
            aria-label="Filter history"
            className="min-w-[180px] flex-1 rounded-lg border border-[rgba(23,43,77,0.14)] bg-white px-3 py-2 text-[13px] text-ink-primary outline-none transition placeholder:text-ink-secondary/60 focus:border-navy-primary/40"
          />
          <div className="flex items-center gap-1">
            {VERDICT_FILTERS.map((v) => {
              const on = verdicts.has(v);
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => toggleVerdict(v)}
                  aria-pressed={on}
                  className="rounded-lg border px-2.5 py-1.5 text-[11.5px] font-semibold transition"
                  style={
                    on
                      ? {
                          background: severityStyle[v].tint,
                          color: severityStyle[v].ink,
                          borderColor: severityStyle[v].border,
                        }
                      : { background: "#fff", color: "#6B7280", borderColor: "rgba(23,43,77,0.14)" }
                  }
                >
                  {severityStyle[v].label}
                </button>
              );
            })}
          </div>
          <div className="inline-flex rounded-lg border border-[rgba(23,43,77,0.14)] bg-ice p-0.5">
            {(Object.keys(RANGE_LABEL) as Range[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition ${
                  range === r ? "bg-white text-navy-deep shadow-sm" : "text-ink-secondary hover:text-navy-primary"
                }`}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <p className="tabular mt-2 text-[11.5px] text-ink-secondary">
          {filtering
            ? `${filtered.length} of ${entries.length} run${entries.length === 1 ? "" : "s"}`
            : `${entries.length} run${entries.length === 1 ? "" : "s"} · ${countSearches(entries)} search${
                countSearches(entries) === 1 ? "" : "es"
              }`}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="mt-4 text-[13px] leading-relaxed text-ink-secondary/80">
          Nothing here yet. Every pre-screen you run is kept on this device, with the date and time it was run, so
          you can re-open it or run it again later.
        </p>
      ) : filtered.length === 0 ? (
        <p className="mt-4 text-[13px] leading-relaxed text-ink-secondary/80">
          No run matches that. {entries.length} {entries.length === 1 ? "run is" : "runs are"} still here — widen the
          filter to see them.
        </p>
      ) : (
        groups.map(([day, rows]) => (
          <section key={day}>
            <div className="mb-2 mt-6 flex items-baseline justify-between border-b border-[rgba(23,43,77,0.12)] pb-1.5">
              <h3 className="font-display text-[15px] leading-none text-navy-deep">{day}</h3>
              <span className="tabular text-[11.5px] leading-none text-ink-secondary">
                {rows.length} run{rows.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {rows.map((e) => (
                <Row
                  key={e.id}
                  entry={e}
                  parent={e.parentId ? byId.get(e.parentId) : undefined}
                  changedFrom={previousVerdict.get(e.id)}
                  opening={opening === e.id}
                  onRunAgain={() => onRunAgain(e.rawQuery, e.promoters, e.type, e.ticker)}
                  onOpen={() => onOpen(e.id)}
                  onDelete={() => onDelete(e.id)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <p className="mt-7 border-t border-navy-primary/8 pt-3 text-[11px] leading-relaxed text-ink-secondary/70">
        Kept in this browser on this device — the list in local storage, the saved briefs in IndexedDB. Nothing is
        stored on the server, so clearing site data erases this, and another laptop has its own. Export writes the
        whole record, briefs included, to a file you can import anywhere.
      </p>
    </div>
  );
}

function Row({
  entry: e,
  parent,
  changedFrom,
  opening,
  onRunAgain,
  onOpen,
  onDelete,
}: {
  entry: ArchiveEntry;
  /** The brief this run was picked off, when it is still in the record. */
  parent?: ArchiveEntry;
  changedFrom?: Severity;
  opening: boolean;
  onRunAgain: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const stale = unresolved(e);
  const failed = e.outcome === "error";

  // Second line: what it said, when, and what it cost. The status fragment
  // comes first because on a row that did not land it is the only true thing.
  const said = failed
    ? `couldn’t finish${e.error ? ` — ${e.error}` : ""}`
    : e.outcome === "legacy"
      ? // Carried over from the old recent-search list, which kept a name and a
        // time and nothing else. Saying the tab stopped watching would be a
        // story about a run nothing was ever recorded about.
        "from your earlier recent searches — no outcome was kept"
      : stale
        ? "we don’t know how this one ended — this tab stopped watching it"
        : e.outcome === "running"
          ? "running now"
          : e.verdict
            ? severityStyle[e.verdict].label
            : "finished";

  const parts = [formatGenerated(e.startedAt), said];
  if (e.outcome === "complete") {
    if (e.durationMs !== undefined) parts.push(`took ${clock(e.durationMs)}`);
    if (e.sourcesTotal > 0) parts.push(`${e.sourcesDone} of ${e.sourcesTotal} sources`);
    if (e.boardTotal) parts.push(`${e.boardDone ?? 0} of ${e.boardTotal} directors`);
  }

  return (
    <div className={parent ? "ml-3 border-l border-[rgba(23,43,77,0.10)] pl-2" : undefined}>
      <div className="group flex items-center gap-2 rounded-lg border border-navy-primary/10 pr-2 transition hover:border-navy-primary/25 hover:bg-navy-primary/5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5">
          {/* A verdict dot only where there is a verdict. A run that could not
              finish gets a neutral mark instead: colouring it red would make a
              failure indistinguishable from a red flag, and the Red-flag filter
              would then not match the row its own colour promised. */}
          {e.verdict ? (
            <span
              className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: severityStyle[e.verdict].dot }}
              aria-hidden
            />
          ) : (
            <span
              className="mt-0.5 inline-flex h-2 w-2 shrink-0 items-center justify-center rounded-full border border-[rgba(23,43,77,0.28)]"
              aria-hidden
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 truncate text-[13.5px] font-medium text-navy-deep">
              <span className="shrink-0 rounded bg-navy-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy-primary">
                {e.type === "director" ? "Director" : "Company"}
              </span>
              <span className="truncate">{e.company}</span>
              {changedFrom && e.verdict && (
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: severityStyle[e.verdict].tint,
                    color: severityStyle[e.verdict].ink,
                  }}
                  title={`Last time this subject was screened the answer was ${severityStyle[changedFrom].label}`}
                >
                  changed from {severityStyle[changedFrom].label}
                </span>
              )}
            </span>
            <span className="tabular mt-0.5 block truncate text-[10.5px] leading-tight text-ink-secondary/85">
              {parts.join(" · ")}
            </span>
            {parent && (
              <span className="mt-0.5 block truncate text-[11px] text-ink-secondary">
                screened from {parent.company}
              </span>
            )}
            {e.promoters.length > 0 && (
              <span className="mt-0.5 block truncate text-[11px] text-ink-secondary">{e.promoters.join(", ")}</span>
            )}
            {e.outcome === "complete" && !e.hasBody && (
              <span className="mt-0.5 block text-[11px] italic text-ink-secondary/70">
                {e.serverId
                  ? "The saved copy was cleared to make room — Open will try the server, or run it again."
                  : "The saved copy was cleared to make room — run it again to rebuild it."}
              </span>
            )}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {e.outcome === "complete" && (e.hasBody || e.serverId) && (
            <button
              type="button"
              onClick={onOpen}
              disabled={opening}
              className="rounded-lg border border-[rgba(23,43,77,0.14)] bg-white px-3 py-1.5 text-[12px] font-medium text-navy-primary transition hover:bg-ice disabled:opacity-60"
            >
              {opening ? "Opening…" : "Open"}
            </button>
          )}
          <button
            type="button"
            onClick={onRunAgain}
            className="text-[12px] font-semibold text-navy-primary/60 transition group-hover:text-navy-primary"
          >
            Run again
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md px-1.5 py-1 text-[15px] leading-none text-navy-primary/40 transition hover:bg-coral/10 hover:text-coral"
            aria-label={`Delete the ${e.company} run of ${formatGenerated(e.startedAt)} from history`}
            title="Delete this run from history"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Move every child directly beneath its parent.
 *
 * The list is newest-first, and a run screened off a brief is by definition
 * newer than the brief — so left alone the children sit above the parent they
 * are indented under, and the indent describes a relationship to whatever row
 * happens to be above them. A child whose parent is not in the filtered set
 * keeps its place and is labelled instead.
 */
function nestUnderParents(entries: ArchiveEntry[]): ArchiveEntry[] {
  const present = new Set(entries.map((e) => e.id));
  const children = new Map<string, ArchiveEntry[]>();
  for (const e of entries) {
    if (!e.parentId || !present.has(e.parentId)) continue;
    const list = children.get(e.parentId) ?? [];
    list.push(e);
    children.set(e.parentId, list);
  }
  if (children.size === 0) return entries;

  const nested = new Set([...children.values()].flat().map((e) => e.id));
  const out: ArchiveEntry[] = [];
  for (const e of entries) {
    if (nested.has(e.id)) continue;
    out.push(e);
    out.push(...(children.get(e.id) ?? []));
  }
  return out;
}

/**
 * Bucket rows by the day they were started.
 *
 * The day label is cut out of `formatGenerated` rather than built from a second
 * month array — the app has exactly one date format, shared by the screen and
 * the PDF, and a history screen is not the place to introduce a second one.
 */
function groupByDay(entries: ArchiveEntry[]): Array<[string, ArchiveEntry[]]> {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();

  const out: Array<[string, ArchiveEntry[]]> = [];
  let current: [string, ArchiveEntry[]] | null = null;

  for (const e of entries) {
    const d = new Date(e.startedAt);
    const date = formatGenerated(e.startedAt).split(",")[0] || "Date not recorded";
    const stamp = d.toDateString();
    const label = stamp === today ? `Today · ${date}` : stamp === yesterday ? `Yesterday · ${date}` : date;
    if (!current || current[0] !== label) {
      current = [label, []];
      out.push(current);
    }
    current[1].push(e);
  }
  return out;
}
