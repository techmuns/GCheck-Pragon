"use client";

import Link from "next/link";
import { severityStyle } from "./severity";
import RunSwitcher, { StatusMark } from "./RunSwitcher";
import { runProgress, type TrackedRun } from "@/lib/useRuns";
import { reconcile } from "@/lib/verdict";

// ── The run rail ─────────────────────────────────────────────────────────────
// Every pre-screen this session has going, kept in one place you can move
// between freely — the point of running several at once is lost if watching one
// costs you the ability to look at another.
//
// On a wide screen it is a fixed left navigation rail (the shape a list of
// things you switch between wants); on a narrow one it falls back to the
// horizontal switcher, which fits a phone better than a rail that would eat half
// the width. Both drive the same handlers, so a run selected in one is selected
// in the other.

interface Props {
  runs: TrackedRun[];
  activeKey: string | null;
  onSelect: (key: string | null) => void;
  onClose: (key: string) => void;
  /** Show every past run, not just the ones this session is tracking. */
  onOpenHistory: () => void;
  historyOpen: boolean;
  /** Past runs that read as searches made from the front door — children are
   *  reached through their parent, so counting them would put a number on the
   *  rail that matches nothing on any screen. */
  historyCount: number;
}

export default function RunSidebar({
  runs,
  activeKey,
  onSelect,
  onClose,
  onOpenHistory,
  historyOpen,
  historyCount,
}: Props) {
  const working = runs.filter((t) => t.phase === "starting" || t.phase === "running").length;

  return (
    <>
      {/* Desktop: fixed left navigation rail */}
      <aside className="no-print hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-soft-border lg:bg-white/80 lg:backdrop-blur-sm">
        {/* Brand */}
        <div className="px-4 pb-3 pt-5">
          <div className="font-display text-[16px] leading-none text-navy-deep">Paragon</div>
          <div className="eyebrow mt-1">Governance Pre-Screen</div>
        </div>

        {/* New search, and the record of everything already run. Both are
            states of this page rather than destinations — leaving for a route
            would stop the poll that advances every run in flight — so they are
            buttons, not links, and only one of them is ever lit. */}
        <div className="px-3">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
              activeKey === null && !historyOpen
                ? "bg-navy-primary text-white shadow-sm"
                : "border border-[rgba(23,43,77,0.14)] bg-white text-navy-primary hover:bg-ice"
            }`}
          >
            <span className="text-[16px] leading-none">+</span> New search
          </button>
          <button
            type="button"
            onClick={onOpenHistory}
            title="Everything run on this device, with the date and time"
            className={`mt-1.5 flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
              historyOpen
                ? "bg-navy-primary text-white shadow-sm"
                : "border border-[rgba(23,43,77,0.14)] bg-white text-navy-primary hover:bg-ice"
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="text-[13px] leading-none" aria-hidden>
                ⟲
              </span>{" "}
              History
            </span>
            {historyCount > 0 && <span className="tabular text-[11px] font-semibold opacity-70">{historyCount}</span>}
          </button>
        </div>

        {/* Searches heading */}
        <div className="mt-4 flex items-center justify-between px-4 pb-1">
          <span className="eyebrow">{working > 0 ? `${working} running` : "Searches"}</span>
          {runs.length > 0 && (
            <span className="tabular text-[11px] font-semibold text-ink-secondary/70">{runs.length}</span>
          )}
        </div>

        {/* Run list */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {runs.length === 0 ? (
            <p className="px-2 py-2 text-[12px] leading-relaxed text-ink-secondary/70">
              No searches yet. Start one and it will appear here.
            </p>
          ) : (
            <ul className="space-y-1">
              {runs.map((t) => {
                // A run started off another brief — a key person screened in
                // their own right — sits indented beneath it, with a rule
                // joining the two. Flat, it would read as a search made from
                // the front door, which is exactly what it is not.
                const nested = Boolean(t.parentKey) && runs.some((p) => p.key === t.parentKey);
                return (
                  <li key={t.key} className={nested ? "ml-3 border-l border-[rgba(23,43,77,0.10)] pl-2" : undefined}>
                    <SidebarRow
                      run={t}
                      active={t.key === activeKey}
                      onSelect={() => onSelect(t.key)}
                      onClose={() => onClose(t.key)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-soft-border px-4 py-3">
          <Link
            href="/admin"
            className="flex items-center gap-2 text-[12.5px] text-ink-secondary transition hover:text-navy-primary"
          >
            <span aria-hidden>⚙</span> Settings
          </Link>
        </div>
      </aside>

      {/* Mobile / narrow: the horizontal switcher, carrying the same controls. */}
      <div className="no-print px-4 pt-6 sm:px-6 lg:hidden">
        <RunSwitcher
          runs={runs}
          activeKey={activeKey}
          onSelect={onSelect}
          onClose={onClose}
          onOpenHistory={onOpenHistory}
          historyOpen={historyOpen}
          historyCount={historyCount}
        />
      </div>
    </>
  );
}

function SidebarRow({
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
  // The reconciled verdict, not the raw one off the brief — the rail sits
  // beside History, and the two must not label the same run differently.
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
      className={`group relative flex items-center gap-2.5 rounded-lg py-2 pl-2.5 pr-1.5 transition ${
        active ? "bg-white shadow-sm ring-1 ring-[rgba(23,43,77,0.10)]" : "hover:bg-white/70"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <StatusMark run={t} done={done} total={total} />
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-[13px] leading-tight ${
              active ? "font-semibold text-navy-deep" : "font-medium text-ink-primary"
            }`}
          >
            {t.subject.company || "New search"}
          </span>
          <span className="block truncate text-[10.5px] leading-tight text-ink-secondary/80">{sub}</span>
        </span>
      </button>

      {/* A run that finished while you were reading another — the only thing on
          the rail that asks for attention, so the only thing that animates. */}
      {!t.seen && !busy && (
        <span
          className="pulse-ring absolute right-1 top-1 inline-block h-2 w-2 rounded-full"
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
