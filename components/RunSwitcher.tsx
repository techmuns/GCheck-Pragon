"use client";

import { severityStyle } from "./severity";
import { runProgress, type TrackedRun } from "@/lib/useRuns";
import { reconcile } from "@/lib/verdict";

// ── The run rail ────────────────────────────────────────────────────────────
// One row, always in the same place, showing every pre-screen this session has
// going. A run in flight keeps its own live ring, so you can see it advancing
// from whichever run you happen to be reading — which is the point: the depth
// only pays off if waiting for it doesn't cost you the ability to do anything
// else.
//
// There is no cancel. A run in flight is work already paid for, and the only
// thing a stop button would reliably do is throw it away by accident. Closing a
// tab stops showing a run; it never stops one.

interface Props {
  runs: TrackedRun[];
  activeKey: string | null;
  onSelect: (key: string | null) => void;
  onClose: (key: string) => void;
  onOpenHistory: () => void;
  historyOpen: boolean;
  historyCount: number;
}

export default function RunSwitcher({
  runs,
  activeKey,
  onSelect,
  onClose,
  onOpenHistory,
  historyOpen,
  historyCount,
}: Props) {
  // The bar used to disappear whenever this session had no runs — which on a
  // phone is exactly the screen a returning user wants their history from, and
  // the one place it was unreachable.
  if (runs.length === 0 && historyCount === 0) return null;

  const working = runs.filter((t) => t.phase === "starting" || t.phase === "running").length;

  return (
    <div className="no-print fade-in mx-auto mb-3 w-full max-w-6xl">
      <div className="card-surface flex items-center gap-2 p-2">
        <div className="hidden shrink-0 pl-1.5 pr-1 sm:block">
          <span className="eyebrow whitespace-nowrap">
            {working > 0 ? `${working} running` : runs.length > 0 ? "Searches" : "History"}
          </span>
        </div>

        <ul className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {runs.map((t) => (
            <li key={t.key} className="shrink-0">
              <RunTab
                run={t}
                active={t.key === activeKey}
                onSelect={() => onSelect(t.key)}
                onClose={() => onClose(t.key)}
              />
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onOpenHistory}
          title="Everything run on this device, with the date and time"
          className={`shrink-0 rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition ${
            historyOpen
              ? "border-navy-primary/30 bg-white text-navy-deep shadow-sm"
              : "border-[rgba(23,43,77,0.14)] bg-white/70 text-navy-primary hover:bg-white"
          }`}
        >
          <span aria-hidden>⟲</span> History
          {historyCount > 0 && <span className="tabular ml-1.5 opacity-70">{historyCount}</span>}
        </button>

        <button
          type="button"
          onClick={() => onSelect(null)}
          className={`shrink-0 rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition ${
            activeKey === null && !historyOpen
              ? "border-navy-primary/30 bg-white text-navy-deep shadow-sm"
              : "border-[rgba(23,43,77,0.14)] bg-white/70 text-navy-primary hover:bg-white"
          }`}
        >
          + New search
        </button>
      </div>
    </div>
  );
}

function RunTab({
  run: t,
  active,
  onSelect,
  onClose,
}: {
  run: TrackedRun;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const busy = t.phase === "starting" || t.phase === "running";
  const { done, total } = runProgress(t);
  // Reconciled, so this tab and the same run's history row agree.
  const verdict = t.run ? reconcile(t.run)?.verdict : undefined;

  const sub = busy
    ? total > 0
      ? `${done} of ${total} sources`
      : "starting…"
    : t.phase === "error"
      ? "couldn’t finish"
      : verdict
        ? severityStyle[verdict].label
        : "done";

  return (
    <div
      className={`group relative flex items-center gap-2 rounded-lg border py-1.5 pl-2 pr-1.5 transition ${
        active
          ? "border-navy-primary/30 bg-white shadow-sm"
          : "border-transparent bg-ice/70 hover:border-[rgba(23,43,77,0.12)] hover:bg-white/80"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 items-center gap-2 text-left"
      >
        <StatusMark run={t} done={done} total={total} />
        <span className="min-w-0">
          <span
            className={`block max-w-[168px] truncate text-[13px] leading-tight ${
              active ? "font-semibold text-navy-deep" : "font-medium text-ink-primary"
            }`}
          >
            {t.subject.company || "New search"}
          </span>
          <span className="block text-[10.5px] leading-tight text-ink-secondary/80">{sub}</span>
        </span>
      </button>

      {/* A run that finished while you were reading another one. The only thing
          on this rail that asks for attention, so it is the only thing that
          animates once a run is over. */}
      {!t.seen && !busy && (
        <span
          className="pulse-ring absolute -right-0.5 -top-0.5 inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: severityStyle[verdict ?? "info"].dot }}
          aria-label="finished while you were away"
        />
      )}

      <button
        type="button"
        onClick={onClose}
        aria-label={`Close ${t.subject.company}`}
        title={busy ? "Hide this — it keeps running" : "Close"}
        className="shrink-0 rounded p-1 text-[11px] leading-none text-ink-secondary/50 opacity-0 transition hover:bg-[rgba(23,43,77,0.06)] hover:text-ink-secondary focus:opacity-100 group-hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

/** A 16px ring that fills with the run's real progress, or a settled dot. Shared
 *  with the sidebar rail so a run's status mark reads identically in both. */
export function StatusMark({ run: t, done, total }: { run: TrackedRun; done: number; total: number }) {
  const busy = t.phase === "starting" || t.phase === "running";

  if (!busy) {
    const settled = t.run ? reconcile(t.run)?.verdict : undefined;
    const colour = t.phase === "error" ? severityStyle.red.dot : severityStyle[settled ?? "info"].dot;
    return (
      <span
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
        style={{ backgroundColor: colour }}
        aria-hidden
      >
        {t.phase === "error" ? "!" : "✓"}
      </span>
    );
  }

  const R = 7;
  const CIRC = 2 * Math.PI * R;
  const fraction = total > 0 ? done / total : 0;

  return (
    <span className="relative inline-flex h-4 w-4 shrink-0" aria-hidden>
      <svg viewBox="0 0 16 16" className="h-4 w-4 -rotate-90">
        <circle cx="8" cy="8" r={R} fill="none" stroke="rgba(23,43,77,0.14)" strokeWidth="2" />
        <circle
          cx="8"
          cy="8"
          r={R}
          fill="none"
          stroke="#B7791F"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - fraction)}
          className="ring-trail"
        />
      </svg>
    </span>
  );
}
