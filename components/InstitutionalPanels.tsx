"use client";

import { useState } from "react";
import type { Run, Severity } from "@/lib/types";
import { assessRisk, buildScope, riskMethodology, type Band, type ScopeStatus } from "@/lib/risk";
import { buildNetwork } from "@/lib/network";
import { severityStyle } from "./severity";
import { humanizeCaps } from "@/lib/text";

// ── Institutional content blocks ─────────────────────────────────────────────
// Content only — no card, no heading. The page owns its own structure so the
// brief reads as one document with ruled divisions rather than a stack of
// floating widgets, and every block here slots into that structure.

export const BAND_META: Record<Band, { label: string; sev: Severity }> = {
  high: { label: "High", sev: "red" },
  elevated: { label: "Elevated", sev: "amber" },
  moderate: { label: "Moderate", sev: "amber" },
  low: { label: "Low", sev: "clear" },
};

// ── Risk: the score dial and what drives it ──────────────────────────────────

/** The score, its band, and the meter — sized for the report hero. */
export function RiskDial({ run }: { run: Run }) {
  const r = assessRisk(run);
  const meta = BAND_META[r.band];
  const s = severityStyle[meta.sev];

  return (
    <div>
      <div className="eyebrow mb-2">Governance risk</div>
      <div className="flex items-baseline gap-2">
        <span className="tabular text-[44px] font-semibold leading-none tracking-tight" style={{ color: s.dot }}>
          {r.score}
        </span>
        <span className="text-[13px] text-ink-secondary">/100</span>
      </div>
      <div
        className="mt-2 inline-flex rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.09em]"
        style={{ background: s.tint, color: s.ink, border: `1px solid ${s.border}` }}
      >
        {meta.label}
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(23,43,77,0.08)]">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(r.score, 2)}%`, background: s.dot, transition: "width 500ms var(--ease)" }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[8.5px] uppercase tracking-[0.06em] text-ink-secondary/60">
        <span>Low</span>
        <span>Mod</span>
        <span>Elev</span>
        <span>High</span>
      </div>
    </div>
  );
}

/** The itemised contributions, plus the methodology behind them. */
export function RiskDrivers({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const r = assessRisk(run);
  const s = severityStyle[BAND_META[r.band].sev];

  return (
    <div>
      <div className="eyebrow mb-2">What drives it</div>
      {r.contributions.length === 0 ? (
        <p className="text-[13px] text-ink-secondary">No scored risk signals surfaced.</p>
      ) : (
        <ul className="space-y-1">
          {r.contributions.slice(0, 6).map((c, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3 text-[12.5px] leading-snug">
              <span className="min-w-0 text-ink-primary">
                {c.label}
                {c.detail && <span className="text-ink-secondary"> · {c.detail}</span>}
              </span>
              <span className="tabular shrink-0 font-semibold" style={{ color: c.points > 0 ? s.dot : "#9AA6B6" }}>
                {c.points > 0 ? `+${c.points}` : "note"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {(r.coverage.partial || r.uncorroborated) && (
        <div className="mt-2.5 space-y-1">
          {r.coverage.partial && (
            <p className="text-[11.5px] leading-snug text-[#7C5A0F]">
              Partial coverage — {r.coverage.completed} of {r.coverage.total} sources completed.
            </p>
          )}
          {r.uncorroborated && (
            <p className="text-[11.5px] leading-snug text-ink-secondary">
              Sharpest finding is press-only — no official or court record behind it.
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="no-print mt-2.5 text-[11.5px] font-medium text-navy-primary underline-offset-2 transition hover:underline"
      >
        {open ? "Hide methodology" : "How this is scored"}
      </button>
      {open && (
        <ol className="mt-2 space-y-1.5 rounded-lg bg-surface-band/70 p-3 text-[11.5px] leading-relaxed text-ink-secondary">
          {riskMethodology().map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Related-party network ────────────────────────────────────────────────────

export function NetworkContent({ run }: { run: Run }) {
  const net = buildNetwork(run);
  if (!net) return null;

  if (net.interlocks.length === 0) {
    return (
      <p className="text-[13px] italic text-ink-secondary/80">
        No shared directorships across the {net.withRecord} director record(s) resolved.
      </p>
    );
  }

  return (
    <>
      <ul className="space-y-2.5">
        {net.interlocks.map((it, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span
              className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: it.flagged ? severityStyle.red.dot : severityStyle.info.dot }}
              aria-hidden
            />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[13.5px] font-medium text-navy-deep">{humanizeCaps(it.company)}</span>
                {it.flagged && (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ background: severityStyle.red.tint, color: severityStyle.red.ink }}
                  >
                    {it.status ?? "not in good standing"}
                  </span>
                )}
                <span className="text-[11px] text-ink-secondary">{it.directors.length} directors</span>
              </div>
              <div className="text-[12px] leading-relaxed text-ink-secondary">
                {it.directors.map(humanizeCaps).join(" · ")}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-ink-secondary/75">
        Interlocks only — shareholding and ultimate beneficial ownership require the upgraded registry.
      </p>
    </>
  );
}

// ── Scope & limitations ──────────────────────────────────────────────────────

const STATUS_META: Record<ScopeStatus, { label: string; color: string }> = {
  covered: { label: "Covered", color: "#1E7A54" },
  partial: { label: "Partial", color: "#C08A1E" },
  "not-run": { label: "Not run", color: "#94A3B8" },
  upgrade: { label: "Upgrade", color: "#B68B3A" },
};

export function ScopeContent({ run }: { run: Run }) {
  const scope = buildScope(run);
  return (
    <>
      <p className="mb-3 text-[12.5px] leading-relaxed text-ink-primary">{scope.statement}</p>
      {scope.clearance && (
        <p className="mb-3 rounded-lg bg-[#2F855A]/8 px-2.5 py-1.5 text-[12px] leading-relaxed text-ink-primary">
          {scope.clearance}
        </p>
      )}
      <ul className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
        {scope.lines.map((l, i) => {
          const m = STATUS_META[l.status];
          return (
            <li key={i} className="flex items-baseline justify-between gap-2 border-b border-[rgba(23,43,77,0.05)] pb-1 text-[12.5px] last:border-0">
              <span className="min-w-0 truncate text-ink-primary">
                {l.name}
                <span className="ml-1.5 text-[9.5px] uppercase tracking-[0.05em] text-ink-secondary/60">{l.tierLabel}</span>
              </span>
              <span className="shrink-0 text-[11.5px] font-semibold" style={{ color: m.color }}>
                {m.label}
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
