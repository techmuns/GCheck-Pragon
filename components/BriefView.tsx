"use client";

import type { Run } from "@/lib/types";
import { severityStyle } from "./severity";

interface Props {
  run: Run;
  onReset: () => void;
}

const VERDICT_TINT: Record<string, { bg: string; border: string; label: string }> = {
  red: { bg: "linear-gradient(135deg,#FFFBFA,#FAE8E5)", border: "rgba(199,93,84,0.24)", label: "Red flags found" },
  amber: { bg: "linear-gradient(135deg,#FFFDF7,#F6EED9)", border: "rgba(182,139,58,0.26)", label: "Review before meeting" },
  clear: { bg: "linear-gradient(135deg,#FBFEFE,#E7F5F1)", border: "rgba(22,142,142,0.22)", label: "No flags surfaced" },
  info: { bg: "linear-gradient(135deg,#FBFCFE,#E8EFFA)", border: "rgba(39,69,126,0.16)", label: "Pre-screen" },
};

// The one-page partner brief. Verdict up top, configurable sections, honest
// source appendix. Phase 3 fills this from OpenAI synthesis of real data.
export default function BriefView({ run, onReset }: Props) {
  const brief = run.brief;
  if (!brief) return null;
  const verdict = VERDICT_TINT[brief.verdict] ?? VERDICT_TINT.info;

  return (
    <div className="fade-in w-full max-w-2xl">
      {/* Header row */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="eyebrow mb-0.5">Pre-Meeting Brief</div>
          <h2 className="font-display text-[24px] leading-tight text-navy-deep">{run.subject.company}</h2>
          {run.subject.promoters.length > 0 && (
            <p className="text-[13px] text-ink-secondary">{run.subject.promoters.join(" · ")}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg border border-[rgba(23,43,77,0.12)] bg-white/70 px-3.5 py-2 text-[13px] font-medium text-navy-primary transition hover:bg-white"
        >
          New search
        </button>
      </div>

      {/* Verdict banner */}
      <div
        className="mb-4 rounded-xl2 p-5"
        style={{ backgroundImage: verdict.bg, border: `1px solid ${verdict.border}`, boxShadow: "0 1px 3px rgba(23,43,77,0.05), 0 16px 38px rgba(23,43,77,0.10)" }}
      >
        <div className="eyebrow mb-1">{verdict.label}</div>
        <p className="font-editorial text-[19px] leading-snug text-navy-deep">{brief.headline}</p>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {brief.sections.map((section) => (
          <div key={section.id} className="card-surface p-5">
            <h3 className="font-display text-[15.5px] text-navy-deep">{section.title}</h3>
            {section.empty || section.findings.length === 0 ? (
              <p className="mt-2 text-[13px] italic text-[#9AA6B6]">n/a — no source-backed findings</p>
            ) : (
              <ul className="mt-2.5 space-y-2">
                {section.findings.map((f, i) => {
                  const s = severityStyle[f.severity];
                  return (
                    <li key={i} className="flex items-start gap-2.5">
                      <span
                        className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: s.dot }}
                      />
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
        ))}
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
                  <a href={c.url} target="_blank" rel="noreferrer" className="ml-1 text-royal underline-offset-2 hover:underline">
                    link
                  </a>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      <p className="mt-4 text-center text-[11px] text-ink-secondary/70">
        {brief.synthesizedBy === "ai"
          ? "Synthesised by AI from live source data — every claim links to a source above."
          : "Assembled from live source data (rules-based). Set OPENAI_API_KEY for AI narrative synthesis."}
      </p>
    </div>
  );
}
