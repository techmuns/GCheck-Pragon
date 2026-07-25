"use client";

import { useEffect, useState } from "react";
import AutocompleteField from "./AutocompleteField";
import { getRecentSearches, type RecentSearch } from "@/lib/history";

interface Props {
  onSubmit: (company: string, promoters: string[]) => void;
  busy?: boolean;
}

// The front door. One company, optional promoter chips. Nothing else on screen —
// clutter-free by design.
export default function SearchForm({ onSubmit, busy }: Props) {
  const [company, setCompany] = useState("");
  const [promoterDraft, setPromoterDraft] = useState("");
  const [promoters, setPromoters] = useState<string[]>([]);
  const [recent, setRecent] = useState<RecentSearch[]>([]);

  // localStorage is client-only — read after mount to avoid a hydration mismatch.
  useEffect(() => setRecent(getRecentSearches()), []);

  function addPromoter(name: string) {
    const v = name.trim();
    if (!v) return;
    if (!promoters.includes(v)) setPromoters((p) => [...p, v]);
    setPromoterDraft("");
  }

  function removePromoter(name: string) {
    setPromoters((p) => p.filter((x) => x !== name));
  }

  function submit() {
    if (!company.trim() || busy) return;
    // Fold any half-typed promoter into the list.
    const all = promoterDraft.trim() ? [...promoters, promoterDraft.trim()] : promoters;
    onSubmit(company.trim(), all);
  }

  return (
    <div className="card-surface fade-in mx-auto w-full max-w-2xl p-6 sm:p-8">
      <div className="mb-5">
        <div className="eyebrow mb-1">Pre-Meeting Governance Pre-Screen</div>
        <h1 className="font-display text-[26px] leading-tight text-navy-deep">
          Who are we meeting?
        </h1>
        <p className="mt-1 text-[13.5px] text-ink-secondary">
          Enter the company and its promoters. We run the governance checks and hand you a one-page brief.
        </p>
      </div>

      <div className="space-y-4">
        <AutocompleteField
          kind="company"
          value={company}
          onChange={setCompany}
          placeholder="e.g. Reliance Industries"
          label="Company"
          autoFocus
        />

        <div>
          <AutocompleteField
            kind="promoter"
            value={promoterDraft}
            onChange={setPromoterDraft}
            onCommit={addPromoter}
            placeholder="Add a promoter or director, press Enter"
            label="Promoter / Director (optional)"
          />
          {promoters.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {promoters.map((p) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1.5 rounded-full bg-navy-primary/8 px-2.5 py-1 text-[12.5px] text-navy-deep"
                >
                  {p}
                  <button
                    type="button"
                    onClick={() => removePromoter(p)}
                    className="text-navy-primary/60 transition hover:text-coral"
                    aria-label={`Remove ${p}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={!company.trim() || busy}
        className="blob-btn mt-6 w-full rounded-xl px-5 py-3 text-[14px] font-semibold tracking-wide"
      >
        {busy ? "Running pre-screen…" : "Run pre-screen"}
      </button>

      {recent.length > 0 && (
        <div className="mt-6 border-t border-navy-primary/8 pt-4">
          <div className="eyebrow mb-2">Recent searches</div>
          <div className="flex flex-col gap-1.5">
            {recent.map((r) => (
              <button
                key={`${r.company}|${r.promoters.join(",")}`}
                type="button"
                disabled={busy}
                onClick={() => onSubmit(r.company, r.promoters)}
                className="group flex items-center justify-between rounded-lg border border-navy-primary/10 px-3 py-2 text-left transition hover:border-navy-primary/25 hover:bg-navy-primary/5 disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-medium text-navy-deep">{r.company}</span>
                  {r.promoters.length > 0 && (
                    <span className="block truncate text-[12px] text-ink-secondary">{r.promoters.join(", ")}</span>
                  )}
                </span>
                <span className="ml-3 shrink-0 text-[12px] font-semibold text-navy-primary/60 transition group-hover:text-navy-primary">
                  Run again
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
