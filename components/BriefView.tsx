"use client";

import { useState } from "react";
import type { Run, Severity } from "@/lib/types";
import { apiUrl } from "@/lib/api";
import { severityStyle } from "./severity";
import { RiskMeter, SeverityBar, StatTile, SourceCoverage, VERDICT_META } from "./BriefViz";
import BriefPrint from "./BriefPrint";
import ConcernCards from "./ConcernCards";
import CitationRef, { sourceUrls } from "./CitationRef";
import { buildPrintBrief, formatGenerated, listConcerns } from "@/lib/printBrief";

interface Props {
  run: Run;
  onReset: () => void;
}

// Segment-by-segment reveal. The brief assembles itself top to bottom — title,
// verdict, glance, coverage, then each section in turn — so the reader's eye is
// led down the page instead of the whole dashboard landing at once. Delays are
// presentation only; the data is already complete when this renders.
const STEP_MS = 130;
const revealAt = (i: number) => ({ animationDelay: `${i * STEP_MS}ms` });

// The one-page partner brief. Verdict hero + at-a-glance visuals up top, then
// configurable sections, then the source appendix. Printable to PDF.
export default function BriefView({ run, onReset }: Props) {
  const brief = run.brief;
  const [downloading, setDownloading] = useState(false);

  // Pull the server-rendered PDF and save it straight to disk — no browser
  // print dialog. The endpoint returns the file as an attachment; we read it
  // as a blob so the download works cross-origin in the hybrid deploy too.
  async function download() {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await fetch(apiUrl(`/api/research/${run.id}/pdf`));
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Pre-Screen — ${run.subject.company}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Fall back to the browser's own print-to-PDF if the server render fails.
      window.print();
    } finally {
      setDownloading(false);
    }
  }

  if (!brief) return null;
  const meta = VERDICT_META[brief.verdict] ?? VERDICT_META.info;

  // The downloadable one-pager is a purpose-built document, derived from the run
  // and rendered (print-only) by BriefPrint — not this on-screen dashboard. Its
  // short summary and its itemised concerns are the sharpest reading of the run
  // we have, though, so the dashboard shows those same ones rather than a looser
  // parallel version. Uncapped here: the screen has room the page doesn't.
  const printBrief = buildPrintBrief(run, formatGenerated(run.createdAt));
  const concerns = listConcerns(run);

  // Tally severities: the concerns carry red / to-review, the remaining sections
  // carry the cleared and contextual items. (Counting only the sections left the
  // tiles reading zero red flags with the concerns listed right beneath them.)
  const counts: Record<Severity, number> = { red: 0, amber: 0, clear: 0, info: 0 };
  for (const c of concerns) counts[c.severity] += 1;
  for (const s of brief.sections) {
    // The summary section is counted entirely through `concerns` above. It used
    // to contribute its `clear` findings too, which is where the bar's stray
    // "1 clear" came from — a placeholder sentence counted as a thing found.
    if (s.id === "red-flags") continue;
    for (const f of s.findings) counts[f.severity] += 1;
  }
  const sourcesChecked = run.progress.filter((p) => p.status === "done").length;
  const sourcesLocked = run.progress.filter((p) => p.status === "locked").length;

  // Every [n] the page prints resolves through this, so a citation number is a
  // link straight to the record rather than a pointer at the appendix.
  const urlByRef = sourceUrls(brief.citations);

  return (
    <div className="fade-in mx-auto w-full max-w-6xl">
      {/* Action row — hidden in print */}
      <div className="no-print mb-4 flex items-center justify-between">
        <div className="eyebrow">Pre-Meeting Brief</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={download}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(23,43,77,0.12)] bg-white/70 px-3.5 py-2 text-[13px] font-medium text-navy-primary transition hover:bg-white disabled:opacity-60"
          >
            {downloading ? "Preparing…" : "↓ Download"}
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
        <div className="reveal mb-4" style={revealAt(0)}>
          <h2 className="font-display text-[26px] leading-tight text-navy-deep">{run.subject.company}</h2>
          {run.subject.promoters.length > 0 && (
            <p className="text-[13px] text-ink-secondary">{run.subject.promoters.join(" · ")}</p>
          )}
        </div>

        {/* Verdict hero */}
        <div
          className="reveal mb-3 rounded-xl2 p-5"
          style={{
            ...revealAt(1),
            backgroundImage: `linear-gradient(135deg, #ffffff, ${meta.soft})`,
            border: `1px solid ${meta.color}33`,
            boxShadow: "0 1px 3px rgba(23,43,77,0.05), 0 16px 38px rgba(23,43,77,0.10)",
          }}
        >
          <div className="eyebrow mb-2">The verdict</div>
          {/* Decorative meter — the printed report leads with the headline text instead. */}
          <div className="no-print">
            <RiskMeter verdict={brief.verdict} />
          </div>
          <p className="mt-3 font-editorial text-[19px] leading-snug text-navy-deep">{brief.headline}</p>
          {/* The one-pager's short summary — what the sharpest signal is, how
              many concerns clear the review threshold, and what to do next. */}
          {printBrief && (
            <p className="mt-3 border-t border-[rgba(23,43,77,0.10)] pt-3 text-[13.5px] leading-relaxed text-ink-primary">
              {printBrief.executive}
            </p>
          )}
        </div>

        {/* At-a-glance visuals — screen only; the print report stays text-simple. */}
        <div className="no-print reveal mb-3 grid grid-cols-1 gap-3 sm:grid-cols-5" style={revealAt(2)}>
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

        {/* Source coverage — screen only; sources are listed in the print appendix. */}
        <div className="no-print card-surface reveal mb-4 p-4" style={revealAt(3)}>
          <div className="eyebrow mb-2">Sources checked{sourcesLocked ? ` · ${sourcesLocked} need upgrade` : ""}</div>
          <SourceCoverage progress={run.progress} />
        </div>

        {/* Sections — full width summary, two columns below on large screens */}
        <div className="grid gap-3 lg:grid-cols-2">
          {brief.sections.map((section, si) => {
            const isSummary = section.id === "red-flags";
            // Key Concerns renders the itemised cards; every other section keeps
            // its plain finding list.
            //
            // INVARIANT: the summary card renders concern cards or the honest
            // empty state, and NEVER the plain list below. That list prints
            // every finding at every severity, and under a heading reading "Key
            // Concerns" it turned an XPRIZE win into a governance concern. The
            // one-pager never had the bug because it consumes Concern[] only;
            // this is what makes the two surfaces agree.
            const asCards = isSummary && concerns.length > 0;
            // Context the summary still owes the reader — which sources were
            // unavailable, whether the identity was pinned — kept as footnotes
            // rather than findings, so they never read as things that were found.
            const summaryNotes = isSummary ? section.findings.filter((f) => f.severity === "info") : [];
            const count = asCards
              ? concerns.length
              : section.findings.filter((f) => f.severity !== "info").length;
            return (
              <div
                key={section.id}
                className={`card-surface reveal p-5 ${isSummary ? "lg:col-span-2" : ""}`}
                style={{
                  ...revealAt(4 + si),
                  ...(isSummary ? { borderLeft: `3px solid ${meta.color}` } : null),
                }}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-display text-[15.5px] text-navy-deep">{section.title}</h3>
                  {count > 0 && (
                    <span className="tabular rounded-full bg-ice px-2 py-0.5 text-[11px] font-semibold text-ink-secondary">
                      {count}
                    </span>
                  )}
                </div>
                {asCards ? (
                  <ConcernCards concerns={concerns} citations={brief.citations} />
                ) : isSummary ? (
                  <p className="flex items-start gap-2.5 text-[14px] leading-relaxed text-ink-primary">
                    <span
                      className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: severityStyle.clear.dot }}
                    />
                    <span>No red-flag or review-level concerns surfaced across the sources that completed.</span>
                  </p>
                ) : section.empty || section.findings.length === 0 ? (
                  <p className="text-[13px] italic text-[#9AA6B6]">n/a — no source-backed findings</p>
                ) : (
                  <ul className="space-y-2">
                    {section.findings.map((f, i) => {
                      const s = severityStyle[f.severity];
                      // A finding two sources carry — a director on both the
                      // registry and Wikidata — cites both, not just the first.
                      const refs = f.sourceRefs ?? (f.sourceRef !== undefined ? [f.sourceRef] : []);
                      return (
                        <li key={i} className="flex items-start gap-2.5">
                          <span className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.dot }} />
                          <span className="text-[14px] leading-relaxed text-ink-primary">
                            {f.text}
                            {refs.map((n) => (
                              <CitationRef key={n} n={n} url={urlByRef.get(n)} />
                            ))}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {summaryNotes.length > 0 && (
                  <div className="mt-3 border-t border-[rgba(23,43,77,0.08)] pt-2.5">
                    <ul className="space-y-1">
                      {summaryNotes.map((f, i) => {
                        const refs = f.sourceRefs ?? (f.sourceRef !== undefined ? [f.sourceRef] : []);
                        return (
                          <li key={i} className="text-[12.5px] leading-relaxed text-ink-secondary">
                            {f.text}
                            {refs.map((n) => (
                              <CitationRef key={n} n={n} url={urlByRef.get(n)} />
                            ))}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Sources appendix */}
        {brief.citations.length > 0 && (
          <div
            className="reveal mt-4 rounded-xl border border-soft-border bg-surface-band/60 p-4"
            style={revealAt(4 + brief.sections.length)}
          >
            <div className="eyebrow mb-2">Sources</div>
            <ol className="space-y-1">
              {brief.citations.map((c) => {
                // The whole entry — its number included — is the link, the same
                // way the exported PDF lists its sources. No separate "link"
                // word to aim at, and the number itself is what a reader clicks.
                const entry = (
                  <>
                    <span className="tabular font-semibold text-navy-primary/70">[{c.ref}]</span> {c.sourceName} — {c.label}
                  </>
                );
                return (
                  <li key={c.ref} className="text-[12.5px] text-ink-secondary">
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        title={c.url}
                        className="underline-offset-2 hover:text-royal hover:underline"
                      >
                        {entry}
                      </a>
                    ) : (
                      entry
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        <p className="reveal mt-4 text-[10.5px] text-ink-secondary/70" style={revealAt(5 + brief.sections.length)}>
          {brief.synthesizedBy === "ai"
            ? "Summary written by AI from live source data — every claim links to a source above. Illustrative pre-screen; verify before relying."
            : "Assembled from live source data. Illustrative pre-screen; verify before relying."}
        </p>
      </div>

      {/* The download / print output — a purpose-built one-page A4-portrait brief.
          Portalled to <body> and print-only, so it never touches the screen view. */}
      {printBrief && <BriefPrint brief={printBrief} />}
    </div>
  );
}
