"use client";

import { useState } from "react";
import AutocompleteField from "./AutocompleteField";
import { severityStyle } from "./severity";
import { useArchive } from "@/lib/useArchive";
import { countSearches } from "@/lib/archive";
import { formatGenerated } from "@/lib/printBrief";

type Mode = "company" | "director";

interface Props {
  onSubmit: (company: string, promoters: string[], type?: Mode, ticker?: string) => void;
  /** Show the whole record rather than the five most recent subjects. */
  onOpenHistory?: () => void;
  busy?: boolean;
}

// The front door. Choose what you're screening — a company or an individual
// director/person — then run the same governance checks. Clutter-free by design.
export default function SearchForm({ onSubmit, onOpenHistory, busy }: Props) {
  const [mode, setMode] = useState<Mode>("company");
  const [company, setCompany] = useState("");
  // A ticker captured from a picked company suggestion. It rides along to enable
  // exchange-filings lookup, and is cleared the moment the text is edited by
  // hand so a stale ticker can never attach to a different company.
  const [ticker, setTicker] = useState<string | undefined>();
  // The five most recent distinct subjects, off the same record the History
  // screen reads. The hook handles the read-after-mount, and keeps this list in
  // step as runs land rather than freezing it at whatever was there on mount.
  const { recent, entries, hide } = useArchive();
  // The same figure the rail's badge shows — both are links to the same screen,
  // and quoting two different numbers for it is a small lie about what is there.
  const pastRuns = countSearches(entries);

  const isDirector = mode === "director";

  function submit() {
    if (!company.trim() || busy) return;
    // Both modes screen a single subject — no promoter list to collect.
    onSubmit(company.trim(), [], mode, mode === "company" ? ticker : undefined);
  }

  return (
    <div className="card-surface fade-in mx-auto w-full max-w-2xl p-6 sm:p-8">
      <div className="mb-5">
        <div className="eyebrow mb-1">Pre-Meeting Governance Pre-Screen</div>
        <h1 className="font-display text-[26px] leading-tight text-navy-deep">
          {isDirector ? "Who are we checking?" : "Who are we meeting?"}
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-secondary">
          {isDirector
            ? "Enter a director or individual. We run the same governance checks on the person."
            : "Enter the company. We run the governance checks and hand you a one-page brief."}
        </p>
      </div>

      {/* Search mode — company vs. an individual director/person. */}
      <div className="mb-5 inline-flex rounded-xl border border-[rgba(23,43,77,0.14)] bg-ice p-1">
        {(["company", "director"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold transition ${
              mode === m ? "bg-white text-navy-deep shadow-sm" : "text-ink-secondary hover:text-navy-primary"
            }`}
          >
            {m === "company" ? "Search a company" : "Search a director"}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <AutocompleteField
          kind={isDirector ? "promoter" : "company"}
          value={company}
          onChange={(v) => {
            setCompany(v);
            // Typing by hand invalidates a ticker picked from the dropdown.
            setTicker(undefined);
          }}
          onSelect={(s) => setTicker(s.ticker)}
          // The box takes a DIN as readily as a name — say so where the user is
          // already looking, because nothing else on the page reveals it.
          placeholder={isDirector ? "e.g. Mukesh Ambani — or DIN 00001695" : "e.g. Reliance Industries"}
          label={isDirector ? "Director / Individual" : "Company"}
          autoFocus
        />
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!company.trim() || busy}
        className="blob-btn mt-6 w-full rounded-xl px-5 py-3 text-[14px] font-semibold tracking-wide"
      >
        {busy ? "Running pre-screen…" : isDirector ? "Run director check" : "Run pre-screen"}
      </button>

      {recent.length > 0 && (
        <div className="mt-6 border-t border-navy-primary/8 pt-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="eyebrow">Recent searches</span>
            {onOpenHistory && (
              <button
                type="button"
                onClick={onOpenHistory}
                className="text-[12px] font-medium text-navy-primary transition hover:text-navy-deep"
              >
                See all {pastRuns}
              </button>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            {recent.map((r) => (
              <div
                key={r.id}
                className="group flex items-center gap-2 rounded-lg border border-navy-primary/10 pr-2 transition hover:border-navy-primary/25 hover:bg-navy-primary/5"
              >
                <button
                  type="button"
                  disabled={busy}
                  // The raw query, not the display name — for a director that
                  // carries the DIN, so re-running screens the same person; and
                  // the ticker rides along, so exchange filings survive a re-run.
                  onClick={() => onSubmit(r.rawQuery, r.promoters, r.type, r.ticker)}
                  className="flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-left disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 truncate text-[13.5px] font-medium text-navy-deep">
                      <span
                        className="shrink-0 rounded bg-navy-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy-primary"
                      >
                        {r.type === "director" ? "Director" : "Company"}
                      </span>
                      <span className="truncate">{r.company}</span>
                    </span>
                    {/* When it was last run, and what it said. The timestamp was
                        always recorded and never shown, which left the list
                        unable to answer the one question asked of it. */}
                    <span className="tabular mt-0.5 block truncate text-[11px] text-ink-secondary/85">
                      {formatGenerated(r.startedAt)}
                      {r.outcome === "error"
                        ? " · couldn’t finish"
                        : r.verdict
                          ? ` · ${severityStyle[r.verdict].label}`
                          : ""}
                    </span>
                    {r.promoters.length > 0 && (
                      <span className="mt-0.5 block truncate text-[12px] text-ink-secondary">{r.promoters.join(", ")}</span>
                    )}
                  </span>
                  <span className="ml-3 shrink-0 text-[12px] font-semibold text-navy-primary/60 transition group-hover:text-navy-primary">
                    Run again
                  </span>
                </button>
                <button
                  type="button"
                  // Takes the subject off this short list only. The run itself
                  // stays in History — this button has always been a tidy-up,
                  // and it must not quietly become the thing that destroys the
                  // only remaining copy of a brief.
                  onClick={() => hide(r.id)}
                  className="shrink-0 rounded-md px-1.5 py-1 text-[15px] leading-none text-navy-primary/40 transition hover:bg-coral/10 hover:text-coral"
                  aria-label={`Take ${r.company} off recent searches — it stays in History`}
                  title="Take off this list — it stays in History"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {recent.length === 0 && pastRuns > 0 && onOpenHistory && (
        <div className="mt-6 border-t border-navy-primary/8 pt-4">
          <button
            type="button"
            onClick={onOpenHistory}
            className="text-[12.5px] font-medium text-navy-primary transition hover:text-navy-deep"
          >
            See all {pastRuns} past run{pastRuns === 1 ? "" : "s"}
          </button>
        </div>
      )}
    </div>
  );
}
