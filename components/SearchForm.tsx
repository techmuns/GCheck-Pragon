"use client";

import { useEffect, useState } from "react";
import AutocompleteField from "./AutocompleteField";
import { getRecentSearches, removeRecentSearch, type RecentSearch } from "@/lib/history";

type Mode = "company" | "director";

interface Props {
  onSubmit: (company: string, promoters: string[], type?: Mode) => void;
  busy?: boolean;
}

// The front door. Choose what you're screening — a company or an individual
// director/person — then run the same governance checks. Clutter-free by design.
export default function SearchForm({ onSubmit, busy }: Props) {
  const [mode, setMode] = useState<Mode>("company");
  const [company, setCompany] = useState("");
  const [recent, setRecent] = useState<RecentSearch[]>([]);

  // localStorage is client-only — read after mount to avoid a hydration mismatch.
  useEffect(() => setRecent(getRecentSearches()), []);

  const isDirector = mode === "director";

  function submit() {
    if (!company.trim() || busy) return;
    // Both modes screen a single subject — no promoter list to collect.
    onSubmit(company.trim(), [], mode);
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
          onChange={setCompany}
          placeholder={isDirector ? "e.g. Mukesh Ambani" : "e.g. Reliance Industries"}
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
          <div className="eyebrow mb-2">Recent searches</div>
          <div className="flex flex-col gap-1.5">
            {recent.map((r) => (
              <div
                key={`${r.type ?? "company"}|${r.company}|${r.promoters.join(",")}`}
                className="group flex items-center gap-2 rounded-lg border border-navy-primary/10 pr-2 transition hover:border-navy-primary/25 hover:bg-navy-primary/5"
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSubmit(r.company, r.promoters, r.type ?? "company")}
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
                  onClick={() => setRecent(removeRecentSearch({ type: r.type, company: r.company, promoters: r.promoters }))}
                  className="shrink-0 rounded-md px-1.5 py-1 text-[15px] leading-none text-navy-primary/40 transition hover:bg-coral/10 hover:text-coral"
                  aria-label={`Remove ${r.company} from recent searches`}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
