"use client";

import { useEffect, useMemo, useState } from "react";
import type { SourceProgress, Subject } from "@/lib/types";

interface Props {
  subject: Subject;
  progress: SourceProgress[];
  /** Fired once the UI has walked through every source in turn. */
  onWalkComplete?: () => void;
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
  google: "Reading news and search results",
  indiankanoon: "Going through court records",
  registry: "Pulling the registry record and its board",
  wikidata: "Cross-checking the people involved",
  filings: "Looking through exchange filings",
  privatecircle: "Mapping other and past companies",
  cibil: "Checking loan-default records",
};

// ── The walk ────────────────────────────────────────────────────────────────
// The UI visits one source at a time on its own steady rhythm, so the user reads
// a clear "now this, then this" sequence rather than watching several backend
// requests resolve at once in whatever order they happen to finish. The pacing
// is presentation only — every status and count shown is the real result for
// that source, and rows the walk has passed keep whatever the backend reported.
const DWELL_MS = 1000;
// Don't hold on one source forever if its status never lands.
const MAX_HOLD_MS = 9000;

const RESOLVED = new Set(["done", "skipped", "error", "locked"]);

export default function ResearchProgress({ subject, progress, onWalkComplete }: Props) {
  const total = progress.length;

  // Index of the source being visited. It advances on a steady dwell timer, but
  // never past a source whose real status hasn't landed yet — so the highlighted
  // row is always genuinely in flight, and no row is left behind reading
  // "Waiting". A cap keeps a stuck source from stalling the walk for good.
  const [cursor, setCursor] = useState(0);
  const settled = cursor < total && RESOLVED.has(progress[cursor]?.status);

  useEffect(() => {
    if (total === 0) return;
    if (cursor >= total) {
      onWalkComplete?.();
      return;
    }
    const t = setTimeout(() => setCursor((c) => c + 1), settled ? DWELL_MS : MAX_HOLD_MS);
    return () => clearTimeout(t);
  }, [cursor, total, settled, onWalkComplete]);

  const current = cursor < total ? progress[cursor] : null;
  const step = Math.min(cursor + 1, Math.max(total, 1));

  // Ring geometry — a sweep that closes as the walk moves through the list.
  const R = 26;
  const CIRC = useMemo(() => 2 * Math.PI * R, [R]);
  const walked = total ? Math.min(cursor, total) / total : 0;

  const line = current
    ? `${VISITING[current.sourceId] ?? `Checking ${current.name}`}…`
    : "Putting the brief together…";

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

      {/* What we're doing right now — swaps as the walk moves on */}
      <div className="mt-5 h-5">
        <p key={cursor} className="msg-swap text-[13.5px] font-medium text-navy-primary">
          {line}
        </p>
      </div>

      {/* Walk progress */}
      <div className="mt-2">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-soft-border">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${Math.round(walked * 100)}%`, backgroundImage: "linear-gradient(90deg,#27457E,#168E8E)" }}
          />
        </div>
      </div>

      {/* Per-source rows — each revealed as the walk reaches it */}
      <ul className="mt-5 space-y-2">
        {progress.map((p, i) => {
          const visiting = i === cursor;
          const upcoming = i > cursor;
          // Only rows the walk has arrived at are on screen; the rest wait their
          // turn, so the sequence reads one source at a time.
          if (upcoming) return null;
          const locked = p.status === "locked";
          const waiting = p.status === "pending" || p.status === "running";
          const showNote = p.note && (locked || p.status === "error" || (p.status === "done" && p.hits === 0));
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
              {visiting && waiting && (
                <div className="bar-track mt-2 h-1 w-full overflow-hidden rounded-full bg-[rgba(23,43,77,0.06)]" />
              )}
              {showNote && <p className="mt-1.5 pl-[22px] text-[11.5px] leading-snug text-ink-secondary/80">{p.note}</p>}
            </li>
          );
        })}
      </ul>

      <p className="mt-5 text-center text-[12px] text-ink-secondary/80">
        {cursor >= total && total > 0 ? "Almost there — writing it up." : "This usually takes under a minute."}
      </p>
    </div>
  );
}
