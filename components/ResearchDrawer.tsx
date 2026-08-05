"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RunEvent, RunEventLevel, SourceProgress } from "@/lib/types";

// ── The research, as reasoning rather than as a log ─────────────────────────
// The activity list said what the run executed, in the order it executed it:
// ninety-six lines of queries, fetches and cache hits, flat, under the source
// rows. Everything true, nothing legible. A reader watching a pre-screen wants
// to know what is being established and why, and only then what was run to
// establish it.
//
// So the same events are grouped into the phases of the work and given a
// written lead — what this phase is for — with the executed steps underneath as
// the evidence for the claim. The narration is written, not generated: it says
// what the phase does, which is fixed, and never what the phase found, which is
// not. A model narrating a run in flight can assert something the assembled
// brief then contradicts, and the contradiction lands on the same screen.
//
// It sits in a drawer because it is the answer to "what are you actually
// doing", which is a question the reader asks sometimes, not a thing they need
// held open in front of them for the whole run.

interface Props {
  events: RunEvent[];
  /** Every source the run planned, with where each has got to. */
  progress: SourceProgress[];
  /** Shown on the trigger while the run is still working. */
  running?: boolean;
}

/** What a stop on the map is doing, which is not quite its status: a source
 *  that finished and found nothing reads differently from one that finished
 *  and found eight things, and the same word covers both. */
type Stop = "pending" | "active" | "hit" | "empty" | "error" | "locked";

function stopOf(p: SourceProgress): Stop {
  switch (p.status) {
    case "running":
      return "active";
    case "error":
      return "error";
    case "locked":
      return "locked";
    case "skipped":
      return "empty";
    case "done":
      return (p.hits ?? 0) > 0 ? "hit" : "empty";
    default:
      return "pending";
  }
}

const MARK: Record<Stop, string> = {
  pending: "",
  active: "",
  hit: "✓",
  empty: "–",
  error: "!",
  locked: "🔒",
};

/**
 * The run as a walk between sources.
 *
 * The list of steps below says what happened. This says where the work is —
 * which stop is being worked now, which are behind it, and which of those
 * actually turned anything up. It is the difference between reading a
 * transcript and watching someone work, and it costs one row per source.
 */
function SourceMap({ progress, events }: { progress: SourceProgress[]; events: RunEvent[] }) {
  if (progress.length === 0) return null;

  // The page the active source is on right now — the "travelling to a site"
  // beat, taken from the newest event that named one.
  const hostBySource = new Map<string, string>();
  for (const e of events) {
    if (e.sourceId && e.url) hostBySource.set(e.sourceId, hostOf(e.url));
  }

  return (
    <ol className="rd-map">
      {progress.map((p) => {
        const stop = stopOf(p);
        const settled = stop !== "pending";
        const host = stop === "active" ? hostBySource.get(p.sourceId) : undefined;
        return (
          <li key={p.sourceId} className="rd-step" data-state={stop} data-walked={settled}>
            {stop === "active" && <span className="rd-travel" aria-hidden />}
            <span className="rd-mark" aria-hidden>
              <span>{MARK[stop]}</span>
            </span>
            <span className="rd-name">
              {p.name}
              {host && <span className="rd-host">reading {host}</span>}
            </span>
            <span className="rd-count">
              {stop === "hit"
                ? `${p.hits} found`
                : stop === "empty"
                  ? "nothing"
                  : stop === "active"
                    ? "working"
                    : stop === "error"
                      ? "unreachable"
                      : stop === "locked"
                        ? "upgrade"
                        : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

interface Phase {
  id: string;
  title: string;
  /** What this phase is establishing — present tense, and true before the
   *  phase has returned anything, because that is when it is read. */
  lead: string;
  sources: string[];
}

// Ordered as the work actually proceeds: who this is, then what they are
// attached to, then what is on record against either.
const PHASES: Phase[] = [
  {
    id: "identity",
    title: "Settling who this is",
    lead: "Matching the name against the MCA register to establish which registered director it belongs to, and which entities are filed against that DIN. Every later search is anchored to this record rather than to the spelling of a name.",
    sources: ["indiafilings", "registry"],
  },
  {
    id: "profile",
    title: "Background and public profile",
    lead: "Reading public profiles for who this person or company is — the role, the business behind it, and the placing facts a partner needs before the meeting.",
    sources: ["profile", "wikidata"],
  },
  {
    id: "litigation",
    title: "Judicial and regulatory record",
    lead: "Searching judicial databases for proceedings naming the subject or the companies they sit on, and separating matters that attach to the person from those that attach to an entity.",
    sources: ["indiankanoon"],
  },
  {
    id: "press",
    title: "Press and adverse media",
    lead: "Sweeping search and news archives against the red-flag keyword set, then opening the articles worth reading — a headline says a matter exists, only the body says which side of it the subject was on.",
    sources: ["google", "news"],
  },
  {
    id: "filings",
    title: "Filings and disclosures",
    lead: "Reading exchange filings, annual reports and announcements for the listed entities involved.",
    sources: ["filings"],
  },
  {
    id: "defaults",
    title: "Credit and default registries",
    lead: "Checking suit-filed and wilful-defaulter registries for the subject and their primary operating entities.",
    sources: ["cibil", "privatecircle"],
  },
];

const DILIGENCE_PHASE: Phase = {
  id: "diligence",
  title: "Board diligence",
  lead: "Screening each director individually — registry standing, red-flag sweep and litigation — anchored to their DIN so a namesake's record is never charged to them.",
  sources: ["diligence"],
};

const RUN_PHASE: Phase = {
  id: "run",
  title: "Planning and write-up",
  lead: "Settling the subject, then assembling what came back into one document — ranked by severity, every finding tied to the source it was read from.",
  sources: [],
};

const PHASE_BY_SOURCE = new Map<string, string>(
  [...PHASES, DILIGENCE_PHASE].flatMap((p) => p.sources.map((s) => [s, p.id] as const)),
);

const GLYPH: Record<RunEventLevel, string> = {
  step: "•",
  query: "→",
  fetch: "↓",
  cache: "≡",
  skip: "–",
  warn: "!",
};

const COLOUR: Record<RunEventLevel, string> = {
  step: "#27457E",
  query: "#168E8E",
  fetch: "#5A6C8C",
  cache: "#9AA6B6",
  skip: "#B68B3A",
  warn: "#C75D54",
};

/** Group the run's events under the phase each belongs to, phases in the order
 *  the work reaches them. Sources fan out concurrently, so events interleave —
 *  grouping is by phase, never by contiguity, or every phase would appear a
 *  dozen times. */
function groupByPhase(events: RunEvent[]): Array<{ phase: Phase; events: RunEvent[] }> {
  const byId = new Map<string, RunEvent[]>();
  for (const e of events) {
    const id = (e.sourceId && PHASE_BY_SOURCE.get(e.sourceId)) ?? RUN_PHASE.id;
    const list = byId.get(id);
    if (list) list.push(e);
    else byId.set(id, [e]);
  }
  // Run-level steps first — they are the frame the rest sits in — then the
  // phases that actually produced events, in their declared order.
  return [RUN_PHASE, ...PHASES, DILIGENCE_PHASE]
    .map((phase) => ({ phase, events: byId.get(phase.id) ?? [] }))
    .filter((g) => g.events.length > 0);
}

/** A source that has stopped, however it stopped. */
const SETTLED = new Set(["done", "skipped", "error", "locked"]);

/** "1m 42s" / "42s" — the elapsed side, which is a fact. */
function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/**
 * How much longer the run can take, counted against what will actually
 * happen to it.
 *
 * This used to read a rate off how many sources had settled, which assumes
 * they queue — they fan out together, so the number was a guess dressed as an
 * estimate. Every source instead runs under a hard deadline the workflow
 * enforces and now carries on its progress row, and the run ends when the last
 * unfinished one either answers or is cut off. So the wait is the largest
 * remaining budget among the sources still working: a real bound, not a
 * projection.
 *
 * It is an upper bound, and sources usually answer well inside it, so the
 * clock tends to arrive early. That is the right direction to be wrong in and
 * the reason it is labelled as a ceiling rather than a prediction.
 */
function remainingMs(
  progress: SourceProgress[],
  startedAt: Map<string, number>,
  runStart: number,
  now: number,
): number | null {
  let worst = 0;
  let known = false;
  for (const p of progress) {
    if (SETTLED.has(p.status)) continue;
    const budget = p.budgetMs;
    // A run started before budgets were carried has none. Unknown is reported
    // as unknown — a missing budget read as a zero would put "writing it up"
    // on a run with four sources still working.
    if (!budget) continue;
    known = true;
    // A pending source has not started its clock yet, so it still owes its
    // whole budget from now; a running one owes the rest of its own.
    const from = p.status === "running" ? (startedAt.get(p.sourceId) ?? runStart) : now;
    worst = Math.max(worst, budget - (now - from));
  }
  if (!known) return progress.some((p) => !SETTLED.has(p.status)) ? null : 0;
  return Math.max(0, worst);
}

export default function ResearchDrawer({ events, progress, running }: Props) {
  const [open, setOpen] = useState(false);

  // Ticks only while there is something to count. Set from an effect rather
  // than at first render, so the server and the client agree on the markup.
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  const timing = useMemo(() => {
    const runStart = events[0]?.at ? new Date(events[0].at).getTime() : 0;
    if (!runStart || !now) return "";
    const elapsed = Math.max(0, now - runStart);
    if (!running) return `took ${clock(elapsed)}`;

    // When each source opened its account, so a countdown is against that
    // source's own clock rather than the run's.
    const startedAt = new Map<string, number>();
    for (const e of events) {
      if (e.sourceId && !startedAt.has(e.sourceId)) startedAt.set(e.sourceId, new Date(e.at).getTime());
    }

    const left = remainingMs(progress, startedAt, runStart, now);
    if (left === null) return `${clock(elapsed)} elapsed`;
    if (left <= 0) return `${clock(elapsed)} · writing it up`;
    return `${clock(elapsed)} · up to ${clock(left)} left`;
  }, [events, progress, running, now]);

  const groups = useMemo(() => groupByPhase(events), [events]);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the newest line, but only while the reader is still at the bottom —
  // a panel that yanks you back down mid-sentence is worse than one that never
  // scrolls at all.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !open || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [events, open]);

  // Escape closes it, like every other overlay a reader has ever used.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (events.length === 0) return null;

  return (
    <>
      {/* Trigger — top right, where a status readout belongs, and carrying the
          two numbers a reader waiting on a run actually wants: how much has
          happened, and how much longer. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        className="no-print fixed right-4 top-4 z-30 rounded-xl border border-[rgba(23,43,77,0.14)] bg-white/95 px-3.5 py-2 text-left shadow-soft backdrop-blur-sm transition hover:bg-ice"
      >
        <span className="flex items-center gap-2 text-[12.5px] font-semibold text-navy-primary">
          <span className={running ? "scan-orb" : undefined} aria-hidden>
            {running ? "◍" : "☰"}
          </span>
          View the research
        </span>
        <span className="mt-0.5 block text-[11px] font-normal text-ink-secondary">
          <span className="tabular">{events.length}</span> steps
          {timing && <> · {timing}</>}
        </span>
      </button>

      {/* Scrim. Click-away closes; it also dims the page enough that the panel
          reads as a layer rather than a column. */}
      {open && (
        <div
          className="no-print fixed inset-0 z-40 bg-navy-deep/15 backdrop-blur-[1px]"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <aside
        aria-hidden={!open}
        className={`no-print fixed inset-y-0 right-0 z-50 flex w-full max-w-[26rem] flex-col border-l border-soft-border bg-white shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "pointer-events-none translate-x-full"
        }`}
      >
        <header className="flex items-baseline justify-between gap-3 border-b border-soft-border px-4 py-3">
          <div>
            <div className="eyebrow">The research</div>
            {/* Repeated here because opening the panel puts the trigger behind
                the scrim, and the wait is the thing the reader came to check. */}
            <div className="mt-0.5 text-[12px] text-ink-secondary">
              {timing || (running ? "Still working — this updates live" : "Every step, in the order it happened")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="shrink-0 rounded-md px-2 py-1 text-[15px] leading-none text-ink-secondary/60 transition hover:bg-ice hover:text-ink-secondary"
          >
            ✕
          </button>
        </header>

        <div
          ref={bodyRef}
          onScroll={() => {
            const el = bodyRef.current;
            if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
          }}
          className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        >
          {/* Where the work is, before what it did. A reader opening this
              mid-run wants the position first; the transcript is what they
              read once they have it. */}
          <section className="mb-5">
            <h4 className="font-display text-[13.5px] leading-tight text-navy-deep">Where the work is</h4>
            <div className="mt-2">
              <SourceMap progress={progress} events={events} />
            </div>
          </section>

          {groups.map(({ phase, events: rows }) => (
            <section key={phase.id} className="mb-5 last:mb-1">
              <h4 className="font-display text-[13.5px] leading-tight text-navy-deep">{phase.title}</h4>
              <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{phase.lead}</p>
              <ol className="mt-2 space-y-0.5 border-l border-[rgba(23,43,77,0.10)] pl-2.5">
                {rows.map((e, i) => (
                  <li key={i} className="rd-line flex items-start gap-1.5 text-[11px] leading-relaxed">
                    <span
                      className="shrink-0 font-semibold"
                      style={{ color: COLOUR[e.level] ?? COLOUR.step }}
                      aria-hidden
                    >
                      {GLYPH[e.level] ?? GLYPH.step}
                    </span>
                    <span className="min-w-0 text-ink-primary/85">
                      {e.text}
                      {e.url && <span className="ml-1.5 text-ink-secondary/65">{hostOf(e.url)}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </aside>
    </>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
