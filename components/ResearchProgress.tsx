"use client";

import { useMemo } from "react";
import type { RunEvent, SourceProgress, Subject } from "@/lib/types";
import ActivityLog from "./ActivityLog";

interface Props {
  subject: Subject;
  progress: SourceProgress[];
  /** The run's activity log, newest last. */
  events?: RunEvent[];
}

const STATUS_LABEL: Record<SourceProgress["status"], string> = {
  pending: "Waiting",
  running: "Checking…",
  done: "Done",
  skipped: "Skipped",
  error: "Couldn’t reach",
  locked: "Upgrade",
};

function statusDot(status: SourceProgress["status"]): string {
  switch (status) {
    case "done":
      return "#2F855A";
    case "running":
      return "#B7791F";
    case "error":
      return "#C75D54";
    case "locked":
      return "#B68B3A";
    default:
      return "#C2CAD6";
  }
}

// What we tell the user we're doing at each stop on the walk. Keyed by source id
// so the narration matches the row being highlighted; falls back to the source's
// own name for any source added later.
const VISITING: Record<string, string> = {
  indiafilings: "Settling who this is on the MCA register",
  google: "Reading news and search results",
  news: "Searching the news for the person and each of their companies",
  indiankanoon: "Going through court records",
  registry: "Pulling the registry record and its board",
  wikidata: "Cross-checking the people involved",
  filings: "Looking through exchange filings",
  privatecircle: "Mapping other and past companies",
  cibil: "Checking loan-default records",
};

// ── Real progress ───────────────────────────────────────────────────────────
// This screen used to walk the sources on a one-second dwell timer of its own,
// which was a nicely paced fiction: the backend runs them all at once, so the
// row being highlighted was rarely the one actually working, and rows were
// hidden until the animation reached them. On a run that now takes minutes and
// opens real pages, that gap stops being cosmetic.
//
// The ring, the counter and the rhythm are kept. What drives them is the run.

const RESOLVED = new Set(["done", "skipped", "error", "locked"]);

export default function ResearchProgress({ subject, progress, events = [] }: Props) {
  const total = progress.length;

  const resolved = progress.filter((p) => RESOLVED.has(p.status)).length;
  const running = progress.filter((p) => p.status === "running");
  const step = total ? Math.min(resolved + (resolved < total ? 1 : 0), total) : 0;

  // Ring geometry — a sweep that closes as the sources actually settle.
  const R = 26;
  const CIRC = useMemo(() => 2 * Math.PI * R, [R]);
  const walked = total ? resolved / total : 0;

  // The live line is whatever the run last reported. The per-source narration
  // is the fallback for the moment before the first event lands.
  const latest = events[events.length - 1];
  const line = latest
    ? latest.text
    : running.length > 0
      ? `${VISITING[running[0].sourceId] ?? `Checking ${running[0].name}`}…`
      : resolved >= total && total > 0
        ? "Putting the brief together…"
        : "Starting up…";

  return (
    <div className="card-surface fade-in mx-auto w-full max-w-3xl p-6 sm:p-8">
      {/* Header — countdown ring + subject */}
      <div className="flex items-center gap-4">
        <div className="relative h-[62px] w-[62px] shrink-0">
          <svg viewBox="0 0 62 62" className="h-full w-full -rotate-90">
            <circle cx="31" cy="31" r={R} fill="none" stroke="rgba(23,43,77,0.09)" strokeWidth="3" />
            <circle
              cx="31"
              cy="31"
              r={R}
              fill="none"
              stroke="url(#ringGrad)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={CIRC * (1 - walked)}
              className="ring-trail"
            />
            <defs>
              <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#27457E" />
                <stop offset="100%" stopColor="#E4C67C" />
              </linearGradient>
            </defs>
          </svg>
          {/* Step counter, centred in the ring */}
          <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
            <span className="tabular font-display text-[17px] text-navy-deep">{total ? step : "–"}</span>
            <span className="tabular mt-0.5 text-[9px] font-semibold tracking-wide text-ink-secondary/70">
              {total ? `of ${total}` : ""}
            </span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="eyebrow mb-0.5">
            {subject.type === "director" ? "Screening director" : "Running pre-screen"}
          </div>
          <h2 className="truncate font-display text-[22px] leading-tight text-navy-deep">{subject.company}</h2>
          {subject.promoters.length > 0 && (
            <p className="truncate text-[13px] text-ink-secondary">{subject.promoters.join(" · ")}</p>
          )}
        </div>
      </div>

      {/* What the run is doing right now — the newest line of its own log */}
      <div className="mt-5 min-h-5">
        <p key={events.length} className="msg-swap text-[13.5px] font-medium text-navy-primary">
          {line}
        </p>
      </div>

      {/* Overall progress */}
      <div className="mt-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-soft-border">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${Math.round(walked * 100)}%`, backgroundImage: "linear-gradient(90deg,#27457E,#168E8E)" }}
          />
        </div>
      </div>

      {/* Per-source rows. All of them, from the start: the backend fans out in
          parallel, so several are genuinely in flight at once and showing that
          is the honest picture. Every running row is highlighted, not one. */}
      <ul className="mt-5 space-y-2">
        {progress.map((p) => {
          const visiting = p.status === "running";
          const locked = p.status === "locked";
          const waiting = p.status === "pending" || p.status === "running";
          const showNote = p.note && (locked || p.status === "error" || (p.status === "done" && p.hits === 0));
          // The most recent thing this particular source said, shown inline so
          // a row that is working for a minute shows what it is working on.
          const own = lastEventFor(events, p.sourceId);
          return (
            <li
              key={p.sourceId}
              className={`surface-soft reveal overflow-hidden px-3.5 py-2.5 ${visiting ? "shimmer" : ""}`}
              style={{ boxShadow: visiting ? "inset 0 0 0 1px rgba(39,69,126,0.16)" : undefined }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${visiting && waiting ? "pulse-ring" : ""}`}
                    style={{ backgroundColor: statusDot(p.status) }}
                  />
                  <span className={`text-[14px] ${visiting ? "font-medium text-navy-deep" : "text-ink-primary"}`}>
                    {p.name}
                  </span>
                </div>
                {locked ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(182,139,58,0.4)] bg-gold-soft px-2 py-0.5 text-[11px] font-semibold text-[#8A5D14]">
                    🔒 Upgrade
                  </span>
                ) : p.status === "done" ? (
                  <span className="tabular text-[12.5px] font-medium text-signal-positive">{p.hits ?? 0} found</span>
                ) : (
                  <span className="text-[12.5px] text-ink-secondary">{STATUS_LABEL[p.status]}</span>
                )}
              </div>
              {visiting && own && (
                <p className="mt-1 truncate pl-[22px] text-[11.5px] leading-snug text-ink-secondary/80">{own.text}</p>
              )}
              {visiting && waiting && (
                <div className="bar-track mt-2 h-1 w-full overflow-hidden rounded-full bg-[rgba(23,43,77,0.06)]" />
              )}
              {showNote && <p className="mt-1.5 pl-[22px] text-[11.5px] leading-snug text-ink-secondary/80">{p.note}</p>}
            </li>
          );
        })}
      </ul>

      <ActivityLog events={events} />

      <p className="mt-4 text-center text-[12px] text-ink-secondary/80">
        {resolved >= total && total > 0
          ? "Almost there — writing it up."
          : "This one runs deep, so give it a few minutes. Everything it checks is listed above as it happens."}
      </p>
    </div>
  );
}

/** The newest line a given source contributed to the log. */
function lastEventFor(events: RunEvent[], sourceId: string): RunEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].sourceId === sourceId) return events[i];
  }
  return undefined;
}
