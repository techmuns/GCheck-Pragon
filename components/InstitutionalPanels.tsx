"use client";

import { useState } from "react";
import type { Run, Severity } from "@/lib/types";
import { assessRisk, buildScope, riskMethodology, type Band, type ScopeStatus } from "@/lib/risk";
import { buildNetwork } from "@/lib/network";
import { severityStyle } from "./severity";
import { formatGenerated } from "@/lib/printBrief";

// ── Institutional panels ─────────────────────────────────────────────────────
// The three things that turn an analyst's findings into a report a committee can
// sign off on: a scored, methodologically-consistent risk read; the map of who
// on the board is connected to whom; and a plain statement of what was and was
// not checked. Each is derived, never written — the score is the sum of listed
// contributions, the network is the shared edges between directors' own records,
// and the scope is the run's own source ledger.

const BAND_META: Record<Band, { label: string; sev: Severity }> = {
  high: { label: "High", sev: "red" },
  elevated: { label: "Elevated", sev: "amber" },
  moderate: { label: "Moderate", sev: "amber" },
  low: { label: "Low", sev: "clear" },
};

// ── Risk score ───────────────────────────────────────────────────────────────

export function RiskPanel({ run }: { run: Run }) {
  const [showMethod, setShowMethod] = useState(false);
  const r = assessRisk(run);
  const meta = BAND_META[r.band];
  const s = severityStyle[meta.sev];
  const streaming = run.status === "running";

  return (
    <div className="card-surface fade-in mb-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="eyebrow mb-1.5">Governance Risk Score</div>
          <div className="flex items-baseline gap-2.5">
            <span className="tabular text-[38px] font-semibold leading-none" style={{ color: s.dot }}>
              {r.score}
            </span>
            <span className="text-[13px] text-ink-secondary">/ 100</span>
            <span
              className="ml-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
              style={{ background: s.tint, color: s.ink, border: `1px solid ${s.border}` }}
            >
              {meta.label}
            </span>
          </div>
          {/* Band meter */}
          <div className="mt-3 w-full max-w-[420px]">
            <div className="relative h-2 w-full overflow-hidden rounded-full bg-soft-border">
              <div className="h-full rounded-full" style={{ width: `${r.score}%`, background: s.dot, transition: "width 400ms ease" }} />
            </div>
            <div className="mt-1 flex justify-between text-[9.5px] uppercase tracking-wide text-ink-secondary/70">
              <span>Low</span>
              <span>Moderate</span>
              <span>Elevated</span>
              <span>High</span>
            </div>
          </div>
        </div>

        {/* Contributions */}
        <div className="min-w-[240px] flex-1">
          <div className="eyebrow mb-2">What drives it</div>
          {r.contributions.length === 0 ? (
            <p className="text-[13px] text-ink-secondary">No scored risk signals surfaced.</p>
          ) : (
            <ul className="space-y-1.5">
              {r.contributions.slice(0, 6).map((c, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0 text-ink-primary">
                    {c.label}
                    {c.detail && <span className="text-ink-secondary"> — {c.detail}</span>}
                  </span>
                  <span
                    className="tabular shrink-0 font-semibold"
                    style={{ color: c.points > 0 ? s.dot : "#8FA0B8" }}
                  >
                    {c.points > 0 ? `+${c.points}` : "note"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {(r.coverage.partial || streaming || r.uncorroborated) && (
        <div className="mt-3 space-y-1 border-t border-[rgba(23,43,77,0.08)] pt-2.5">
          {streaming && (
            <p className="text-[11.5px] text-ink-secondary">Board screening still in progress — the score rises as flagged directors are found.</p>
          )}
          {r.coverage.partial && (
            <p className="text-[11.5px] text-[#7C5A0F]">
              Rests on partial coverage — {r.coverage.completed} of {r.coverage.total} sources completed, so a low score is not yet a clean bill of health.
            </p>
          )}
          {r.uncorroborated && (
            <p className="text-[11.5px] text-ink-secondary">The sharpest finding is single-source (press) with no official or court record behind it.</p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowMethod((v) => !v)}
        className="mt-3 text-[11.5px] font-medium text-navy-primary transition hover:text-navy-deep"
      >
        {showMethod ? "Hide methodology" : "How this is scored"}
      </button>
      {showMethod && (
        <ol className="mt-2 space-y-1.5 rounded-lg bg-surface-band/60 p-3 text-[11.5px] leading-relaxed text-ink-secondary">
          {riskMethodology().map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Relationship network ─────────────────────────────────────────────────────

export function NetworkPanel({ run }: { run: Run }) {
  const net = buildNetwork(run);
  if (!net) return null;

  return (
    <div className="card-surface fade-in mb-3 p-5">
      <div className="mb-2">
        <h3 className="font-display text-[15.5px] text-navy-deep">Related-Party Network</h3>
        <p className="text-[12px] text-ink-secondary">
          Companies where two or more of the board sit together — the channels a related-party review looks for.
        </p>
      </div>

      {net.interlocks.length === 0 ? (
        <p className="text-[13px] italic text-ink-secondary/80">
          No shared directorships surfaced across the {net.withRecord} director record(s) resolved.
        </p>
      ) : (
        <ul className="space-y-2">
          {net.interlocks.map((it, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span
                className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: it.flagged ? severityStyle.red.dot : severityStyle.info.dot }}
                aria-hidden
              />
              <div className="min-w-0">
                <span className="text-[13.5px] font-medium text-navy-deep">{it.company}</span>
                {it.flagged && (
                  <span className="ml-2 rounded bg-[#FBF1F2] px-1.5 py-0.5 text-[10px] font-semibold text-[#8E2436]">
                    {it.status ?? "not in good standing"}
                  </span>
                )}
                <span className="ml-2 text-[11px] text-ink-secondary">{it.directors.length} directors</span>
                <div className="text-[12px] leading-relaxed text-ink-secondary">{it.directors.join(" · ")}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 border-t border-[rgba(23,43,77,0.08)] pt-2.5 text-[11px] text-ink-secondary/80">
        Interlocks only — shareholding and ultimate beneficial ownership require the upgraded registry (PrivateCircle).
      </p>
    </div>
  );
}

// ── Scope & limitations ──────────────────────────────────────────────────────

const STATUS_META: Record<ScopeStatus, { label: string; color: string }> = {
  covered: { label: "Covered", color: "#1E7A54" },
  partial: { label: "Partial", color: "#C08A1E" },
  "not-run": { label: "Not run", color: "#94A3B8" },
  upgrade: { label: "Upgrade", color: "#B68B3A" },
};

export function ScopePanel({ run }: { run: Run }) {
  const scope = buildScope(run);
  return (
    <div className="card-surface fade-in mb-3 p-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-display text-[15.5px] text-navy-deep">Scope &amp; Limitations</h3>
        <span className="text-[11px] text-ink-secondary">As of {formatGenerated(run.createdAt)}</span>
      </div>
      <p className="mb-3 text-[12.5px] leading-relaxed text-ink-primary">{scope.statement}</p>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {scope.lines.map((l, i) => {
          const m = STATUS_META[l.status];
          return (
            <li key={i} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="min-w-0 truncate text-ink-primary">
                {l.name}
                <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-secondary/70">{l.tierLabel}</span>
              </span>
              <span className="shrink-0 font-semibold" style={{ color: m.color }}>
                {m.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
