"use client";

import { useState } from "react";
import type { Run, Severity } from "@/lib/types";
import { apiUrl } from "@/lib/api";
import { severityStyle } from "./severity";
import { VERDICT_META } from "./BriefViz";
import BriefPrint from "./BriefPrint";
import ConcernCards from "./ConcernCards";
import NewsTable from "./NewsTable";
import ProfileCard from "./ProfileCard";
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

/**
 * The sentence to walk away with.
 *
 * The model's headline is a summary of the evidence; this is a summary of the
 * *situation*, assembled from facts rather than written — who the register says
 * this is, how many entities they are on, how many of those are not in good
 * standing, and what the checks did or did not reach. It is deliberately not
 * left to the model: the reader needs the same shape of answer every time, and
 * "3 itemised concerns rank above the review threshold" is a sentence about the
 * tool rather than about the person.
 */
function buildTakeaway(run: Run, concerns: number, red: number, amber: number): string {
  const s = run.subject;
  const isDirector = s.type === "director";
  const parts: string[] = [];

  // Who.
  if (isDirector && s.din) {
    const n = s.anchors?.length ?? 0;
    parts.push(`${s.company} is DIN ${s.din}${n > 0 ? `, on ${n} ${n === 1 ? "entity" : "entities"} on the register` : ""}.`);
  } else if (isDirector) {
    parts.push(`No unique registry record matched ${s.company}, so everything below is a name match and may be someone else.`);
  } else {
    parts.push(`${s.company}.`);
  }

  // What was found. Concern count is what the reader can see itemised, so it is
  // the number quoted — a tally that disagrees with the cards below reads as a
  // bug even when both are technically right.
  if (red > 0) {
    parts.push(`${red} red ${red === 1 ? "flag" : "flags"}${amber > 0 ? ` and ${amber} item(s) to review` : ""} surfaced.`);
  } else if (concerns > 0) {
    parts.push(`Nothing rises to a red flag, but ${concerns} ${concerns === 1 ? "item is" : "items are"} worth raising.`);
  } else {
    parts.push("Nothing adverse surfaced.");
  }

  // What was NOT reached — the caveat that keeps a thin run from reading as a
  // clean one.
  const missed = run.progress.filter((p) => p.status === "error" || p.status === "skipped");
  if (missed.length > 0) {
    parts.push(`${missed.length} of ${run.progress.length} sources did not return, so coverage is partial.`);
  }

  return parts.join(" ");
}

/** One figure in the verdict strip. Big number, quiet label. */
function Figure({ value, label, tint }: { value: string | number; label: string; tint?: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="tabular text-[20px] font-semibold leading-none" style={{ color: tint ?? "#26303F" }}>
        {value}
      </span>
      <span className="text-[11.5px] text-ink-secondary">{label}</span>
    </span>
  );
}

// The one-page partner brief. Verdict hero + at-a-glance visuals up top, then
// configurable sections, then the source appendix. Printable to PDF.
export default function BriefView({ run, onReset }: Props) {
  const brief = run.brief;
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // Fifteen numbered rows of provenance at the foot of the page is reference
  // material, not reading. Every inline [n] still links straight to its source,
  // so the list is what you open to audit, not what you scroll past.
  const [sourcesOpen, setSourcesOpen] = useState(false);

  /**
   * Get the PDF out of an embedded page.
   *
   * This dashboard runs inside an iframe on the host app, and that changes what
   * a download can be. A blob + synthetic `a.click()` is silently discarded
   * unless the frame carries `allow-downloads`, and the old `window.print()`
   * fallback is refused just as quietly — so the button appeared to do nothing
   * at all, twice over, and said nothing about it either.
   *
   * Opening a new tab is the one route that survives being framed. The window
   * is opened BEFORE the await: a popup blocker allows a window opened during
   * the click that asked for it, and blocks one opened after a network round
   * trip has broken that chain.
   */
  async function download() {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);

    const tab = window.open("", "_blank", "noopener,noreferrer");
    try {
      const res = await fetch(apiUrl(`/api/research/${run.id}/pdf`));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `The server could not render the PDF (${res.status}).`);
      }
      const url = URL.createObjectURL(await res.blob());

      if (tab && !tab.closed) {
        tab.location.href = url;
      } else {
        // Not framed, or popups allowed the direct route — save it outright.
        const a = document.createElement("a");
        a.href = url;
        a.download = `Pre-Screen — ${run.subject.company}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // Give the tab time to take the blob before it is revoked.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      // Say what went wrong. A button that fails in silence is worse than one
      // that fails — the reader cannot tell it apart from a button that worked.
      setDownloadError(e instanceof Error ? e.message : "Could not produce the PDF.");
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
  const redCount = concerns.filter((c) => c.severity === "red").length;
  const amberCount = concerns.filter((c) => c.severity === "amber").length;
  const takeaway = buildTakeaway(run, concerns.length, redCount, amberCount);

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

      {downloadError && (
        <p
          className="no-print mb-3 rounded-lg px-3 py-2 text-[12.5px]"
          style={{ background: severityStyle.red.tint, color: severityStyle.red.ink, border: `1px solid ${severityStyle.red.border}` }}
          role="status"
        >
          {downloadError} You can still print this page from your browser, or open it at{" "}
          <a className="underline" href={apiUrl(`/print?id=${run.id}`)} target="_blank" rel="noopener noreferrer">
            the print view
          </a>
          .
        </p>
      )}

      {/* Printable brief */}
      <div id="brief-print" data-dashboard-capture-root="true">
        {/* Title */}
        <div className="reveal mb-4" style={revealAt(0)}>
          <h2 className="font-display text-[26px] leading-tight text-navy-deep">{run.subject.company}</h2>
          {run.subject.promoters.length > 0 && (
            <p className="text-[13px] text-ink-secondary">{run.subject.promoters.join(" · ")}</p>
          )}
        </div>

        {/* The verdict, and the one sentence to walk away with.
            This block used to open with a three-segment meter and a line about
            concerns "ranking above the review threshold", which is a sentence
            about the tool rather than about the person. What a partner needs
            before a meeting is the takeaway: who this is, what was found, and
            what to raise. */}
        <div
          className="reveal mb-3 rounded-xl2 p-5"
          style={{
            ...revealAt(1),
            background: meta.soft,
            border: `1px solid ${meta.color}2E`,
          }}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em]"
              style={{ background: "#ffffffcc", color: meta.color, border: `1px solid ${meta.color}33` }}
            >
              {meta.label}
            </span>
            <span className="text-[13px] text-ink-secondary">{meta.line}</span>
          </div>

          <p className="mt-3.5 font-editorial text-[21px] leading-snug text-navy-deep">{takeaway}</p>

          <div className="mt-3.5 flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-3" style={{ borderColor: `${meta.color}24` }}>
            {/* Counted from the concern cards themselves, not across every
                section. The tiles used to read "6 to review" above three
                itemised cards, because litigation rows and flagged press were
                being tallied separately — a number that disagrees with what is
                on screen reads as a bug whichever one is right. */}
            <Figure value={redCount} label={redCount === 1 ? "red flag" : "red flags"} tint={redCount ? severityStyle.red.dot : undefined} />
            <Figure value={amberCount} label="to review" tint={amberCount ? severityStyle.amber.dot : undefined} />
            <Figure value={`${sourcesChecked}/${run.progress.length}`} label="sources completed" />
            {sourcesLocked > 0 && <Figure value={sourcesLocked} label="need upgrade" />}
          </div>
        </div>

        {/* Sections — full width summary, two columns below on large screens */}
        <div className="grid gap-3 lg:grid-cols-2">
          {brief.sections.map((section, si) => {
            const isSummary = section.id === "red-flags";
            const isNews = section.id === "press";
            // The profile is rendered as a rich card (role, headline figures,
            // career milestones) from the collector's own hits, the same way
            // news is a table rather than a bullet list — a headline figure like
            // a net worth wants a tile, not a line item.
            const isProfile = section.id === "profile";
            const profileHits = isProfile
              ? (run.collected?.find((c) => c.sourceId === "profile")?.hits ?? [])
              : [];
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
            const summaryNotes = isSummary
      ? section.findings.filter((f) => f.severity === "info" && f.text !== section.emptyText)
      : [];
            const count = asCards
              ? concerns.length
              : isNews
                ? (printBrief?.news.length ?? 0)
                : isProfile
                  ? profileHits.filter((h) => h.extra?.category === "profile-highlight").length
                  : section.findings.filter((f) => f.severity !== "info").length;
            return (
              <div
                key={section.id}
                // Concerns and the news table both run full width — a table
                // squeezed into half a grid wraps every cell onto four lines
                // and stops being a table.
                className={`card-surface reveal p-5 ${isSummary || isNews || isProfile ? "lg:col-span-2" : ""}`}
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
                ) : isNews ? (
                  // Coverage is a table, not a bullet list. The reader's
                  // question is what each piece SAYS and whether it concerns
                  // this person — neither of which a headline answers.
                  <NewsTable rows={printBrief?.news ?? []} citations={brief.citations} />
                ) : isProfile ? (
                  // Background as a card: role, headline figures, career facts —
                  // read from the profile pages, each fact linking to its source.
                  <ProfileCard hits={profileHits} citations={brief.citations} />
                ) : isSummary ? (
                  // Green only where the reassurance is earned. Where the run
                  // could not settle who this is, the assembler supplies its own
                  // wording and this is not a clean bill of health.
                  <p className="flex items-start gap-2.5 text-[14px] leading-relaxed text-ink-primary">
                    <span
                      className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: section.emptyText ? severityStyle.info.dot : severityStyle.clear.dot }}
                    />
                    <span>
                      {section.emptyText ??
                        "No red-flag or review-level concerns surfaced across the sources that completed."}
                    </span>
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
            <button
              type="button"
              onClick={() => setSourcesOpen((o) => !o)}
              aria-expanded={sourcesOpen}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="eyebrow">Sources · {brief.citations.length}</span>
              <span className={`text-[11px] text-ink-secondary/60 transition ${sourcesOpen ? "rotate-180" : ""}`} aria-hidden>
                ▾
              </span>
            </button>
            <ol className={`space-y-1 ${sourcesOpen ? "mt-2" : "hidden"}`}>
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
