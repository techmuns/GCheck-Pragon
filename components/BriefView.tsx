"use client";

import type { Run, Severity } from "@/lib/types";
import { severityStyle } from "./severity";
import { RiskMeter, SeverityBar, StatTile, SourceCoverage, VERDICT_META } from "./BriefViz";

interface Props {
  run: Run;
  onReset: () => void;
}

// The one-page partner brief. Verdict hero + at-a-glance visuals up top, then
// configurable sections, then the source appendix. Printable to PDF.
export default function BriefView({ run, onReset }: Props) {
  const brief = run.brief;
  if (!brief) return null;
  const meta = VERDICT_META[brief.verdict] ?? VERDICT_META.info;

  // Tally finding severities across the sections (excluding the summary to
  // avoid double-counting, and excluding info/context).
  const counts: Record<Severity, number> = { red: 0, amber: 0, clear: 0, info: 0 };
  for (const s of brief.sections) {
    if (s.id === "red-flags") continue;
    for (const f of s.findings) counts[f.severity] += 1;
  }
  const sourcesChecked = run.progress.filter((p) => p.status === "done").length;
  const sourcesLocked = run.progress.filter((p) => p.status === "locked").length;

  return (
    <div className="fade-in mx-auto w-full max-w-6xl">
      {/* Action row — hidden in print */}
      <div className="no-print mb-4 flex items-center justify-between">
        <div className="eyebrow">Pre-Meeting Brief</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(23,43,77,0.12)] bg-white/70 px-3.5 py-2 text-[13px] font-medium text-navy-primary transition hover:bg-white"
          >
            ↓ Download
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-[rgba(23,43,77,0.12)] bg-white/70 px-3.5 py-2 text-[13px] font-medium text-navy-primary transition hover:bg-white"
          >
            New search
          </button>
        </div>
      </div>

      {/* Printable brief */}
      <div id="brief-print" data-dashboard-capture-root="true">
        {/* Title */}
        <div className="mb-4">
          <h2 className="font-display text-[26px] leading-tight text-navy-deep">{run.subject.company}</h2>
          {run.subject.promoters.length > 0 && (
            <p className="text-[13px] text-ink-secondary">{run.subject.promoters.join(" · ")}</p>
          )}
        </div>

        {/* Verdict hero */}
        <div
          className="mb-3 rounded-xl2 p-5"
          style={{
            backgroundImage: `linear-gradient(135deg, #ffffff, ${meta.soft})`,
            border: `1px solid ${meta.color}33`,
            boxShadow: "0 1px 3px rgba(23,43,77,0.05), 0 16px 38px rgba(23,43,77,0.10)",
          }}
        >
          <div className="eyebrow mb-2">The verdict</div>
          <RiskMeter verdict={brief.verdict} />
          <p className="mt-3 font-editorial text-[19px] leading-snug text-navy-deep">{brief.headline}</p>
        </div>

        {/* At-a-glance visuals */}
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-5">
          <div className="card-surface p-4 sm:col-span-2">
            <div className="eyebrow mb-2">What we found</div>
            {counts.red + counts.amber + counts.clear > 0 ? (
              <SeverityBar counts={counts} />
            ) : (
              <p className="text-[12.5px] italic text-ink-secondary">No itemised findings yet.</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:col-span-3">
            <StatTile value={counts.red} label="Red flags" tint={counts.red ? severityStyle.red.dot : undefined} />
            <StatTile value={counts.amber} label="To review" tint={counts.amber ? severityStyle.amber.dot : undefined} />
            <StatTile value={`${sourcesChecked}/${run.progress.length}`} label="Sources" />
          </div>
        </div>

        {/* Source coverage */}
        <div className="card-surface mb-4 p-4">
          <div className="eyebrow mb-2">Sources checked{sourcesLocked ? ` · ${sourcesLocked} need upgrade` : ""}</div>
          <SourceCoverage progress={run.progress} />
        </div>

        {/* Sections — full width summary, two columns below on large screens */}
        <div className="grid gap-3 lg:grid-cols-2">
          {brief.sections.map((section) => {
            const isSummary = section.id === "red-flags";
            const count = section.findings.filter((f) => f.severity !== "info").length;
            return (
              <div
                key={section.id}
                className={`card-surface p-5 ${isSummary ? "lg:col-span-2" : ""}`}
                style={isSummary ? { borderLeft: `3px solid ${meta.color}` } : undefined}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-display text-[15.5px] text-navy-deep">{section.title}</h3>
                  {count > 0 && (
                    <span className="tabular rounded-full bg-ice px-2 py-0.5 text-[11px] font-semibold text-ink-secondary">
                      {count}
                    </span>
                  )}
                </div>
                {section.empty || section.findings.length === 0 ? (
                  <p className="text-[13px] italic text-[#9AA6B6]">n/a — no source-backed findings</p>
                ) : (
                  <ul className="space-y-2">
                    {section.findings.map((f, i) => {
                      const s = severityStyle[f.severity];
                      return (
                        <li key={i} className="flex items-start gap-2.5">
                          <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.dot }} />
                          <span className="text-[14px] leading-relaxed text-ink-primary">
                            {f.text}
                            {f.sourceRef !== undefined && (
                              <sup className="ml-0.5 text-[11px] font-semibold text-navy-primary/70">[{f.sourceRef}]</sup>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {/* Sources appendix */}
        {brief.citations.length > 0 && (
          <div className="mt-4 rounded-xl border border-soft-border bg-surface-band/60 p-4">
            <div className="eyebrow mb-2">Sources</div>
            <ol className="space-y-1">
              {brief.citations.map((c) => (
                <li key={c.ref} className="text-[12.5px] text-ink-secondary">
                  <span className="tabular font-semibold text-navy-primary/70">[{c.ref}]</span> {c.sourceName} — {c.label}
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noreferrer" className="no-print ml-1 text-royal underline-offset-2 hover:underline">
                      link
                    </a>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        <p className="mt-4 text-[10.5px] text-ink-secondary/70">
          {brief.synthesizedBy === "ai"
            ? "Summary written by AI from live source data — every claim links to a source above. Illustrative pre-screen; verify before relying."
            : "Assembled from live source data. Illustrative pre-screen; verify before relying."}
        </p>
      </div>
    </div>
  );
}
