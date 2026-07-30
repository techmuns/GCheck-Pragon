"use client";

import { useState, type ReactNode } from "react";
import type { Run, Severity } from "@/lib/types";
import { apiUrl } from "@/lib/api";
import { severityStyle } from "./severity";
import { VERDICT_META } from "./BriefViz";
import BriefPrint from "./BriefPrint";
import ConcernCards from "./ConcernCards";
import NewsTable from "./NewsTable";
import ProfileCard from "./ProfileCard";
import DiligenceGrid, { diligenceStats } from "./DiligenceSection";
import { RiskDial, RiskDrivers, NetworkContent, ScopeContent } from "./InstitutionalPanels";
import CitationRef, { sourceUrls } from "./CitationRef";
import { buildPrintBrief, formatGenerated, listConcerns } from "@/lib/printBrief";
import { buildNetwork } from "@/lib/network";
import { sourceTier } from "@/lib/risk";
import { humanizeCaps } from "@/lib/text";

interface Props {
  run: Run;
  onReset: () => void;
}

// ── The pre-meeting brief ────────────────────────────────────────────────────
// One document, not a pile of cards. The page had grown into a stack of
// same-weight white boxes in configuration order — two of them (the verdict and
// the risk score) saying overlapping things at the top, and the itemised
// concerns, which are the entire point, sitting below the board.
//
// The order here is the reading order a partner actually needs: what is the
// answer, what is it based on, who are these people, and what did we not reach.
// Sections are ruled rather than floated, so the eye moves down one sheet.

const RANK: Record<Severity, number> = { red: 3, amber: 2, clear: 1, info: 0 };
const worstOf = (a: Severity, b: Severity): Severity => (RANK[a] >= RANK[b] ? a : b);

/** A ruled section of the document. */
function Section({
  title,
  count,
  meta,
  children,
  className = "",
}: {
  title: string;
  count?: number;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mt-7 ${className}`}>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[rgba(23,43,77,0.12)] pb-1.5">
        <h3 className="font-display text-[15px] leading-none text-navy-deep">
          {title}
          {count !== undefined && count > 0 && (
            <span className="tabular ml-2 text-[12px] font-normal text-ink-secondary/70">{count}</span>
          )}
        </h3>
        {meta && <span className="text-[11.5px] leading-none text-ink-secondary">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * The sentence to walk away with.
 *
 * Assembled from facts rather than written: who the register says this is, what
 * was found, and what the checks did not reach. Counts come from the same
 * reconciled tallies shown beside it — a takeaway that says "nothing rises to a
 * red flag" under a banner reading RED FLAGS is the single fastest way to lose
 * a reader's trust in everything else on the page.
 */
function buildTakeaway(run: Run, red: number, amber: number, boardRed: number): string {
  const s = run.subject;
  const parts: string[] = [];

  if (s.type === "director" && s.din) {
    const n = s.anchors?.length ?? 0;
    parts.push(`${s.company} is DIN ${s.din}${n > 0 ? `, on ${n} ${n === 1 ? "entity" : "entities"} on the register` : ""}.`);
  } else if (s.type === "director") {
    parts.push(`No unique registry record matched ${s.company}, so everything below is a name match and may be someone else.`);
  }

  if (red > 0) {
    parts.push(
      `${red} red ${red === 1 ? "flag" : "flags"}` +
        (amber > 0 ? ` and ${amber} ${amber === 1 ? "item" : "items"} to review` : "") +
        ` surfaced` +
        (boardRed > 0 ? `, including ${boardRed} director${boardRed === 1 ? "" : "s"} carrying one.` : "."),
    );
  } else if (amber > 0) {
    parts.push(`Nothing rises to a red flag, but ${amber} ${amber === 1 ? "item is" : "items are"} worth raising.`);
  } else {
    parts.push("Nothing adverse surfaced across the sources that completed.");
  }

  const missed = run.progress.filter((p) => p.status === "error" || p.status === "skipped");
  if (missed.length > 0) {
    parts.push(`${missed.length} of ${run.progress.length} sources did not return, so coverage is partial.`);
  }
  return parts.join(" ");
}

/** Two sections side by side — or one at full width when only one has content. */
function Pair({
  left,
  right,
}: {
  left: { title: string; body: ReactNode } | null;
  right: { title: string; body: ReactNode } | null;
}) {
  if (!left && !right) return null;
  const both = Boolean(left && right);
  const one = (left ?? right)!;
  if (!both) return <Section title={one.title}>{one.body}</Section>;
  return (
    <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
      <Section title={left!.title}>{left!.body}</Section>
      <Section title={right!.title}>{right!.body}</Section>
    </div>
  );
}

function Stat({ value, label, tint }: { value: string | number; label: string; tint?: string }) {
  return (
    <div>
      <div className="tabular text-[19px] font-semibold leading-none" style={{ color: tint ?? "#26303F" }}>
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-none text-ink-secondary">{label}</div>
    </div>
  );
}

export default function BriefView({ run, onReset }: Props) {
  const brief = run.brief;
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  /**
   * Get the PDF out of an embedded page.
   *
   * This dashboard runs inside an iframe on the host app, and that changes what
   * a download can be. A blob + synthetic `a.click()` is silently discarded
   * unless the frame carries `allow-downloads`, and `window.print()` is refused
   * just as quietly. Opening a new tab is the one route that survives being
   * framed — opened BEFORE the await, because a popup blocker allows a window
   * opened during the click that asked for it and blocks one opened after a
   * network round trip has broken that chain.
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
        const a = document.createElement("a");
        a.href = url;
        a.download = `Pre-Screen — ${run.subject.company}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      tab?.close();
      setDownloadError(e instanceof Error ? e.message : "Could not produce the PDF.");
    } finally {
      setDownloading(false);
    }
  }

  if (!brief) return null;

  const printBrief = buildPrintBrief(run, formatGenerated(run.createdAt));
  const concerns = listConcerns(run);
  const people = run.diligence ?? [];
  const board = diligenceStats(people);
  const isCompany = run.subject.type !== "director";
  const network = buildNetwork(run);

  // ── Reconciling the verdict with the numbers beneath it ────────────────────
  // These used to disagree in public: the banner read RED FLAGS while the tally
  // beside it read "0 red flags", because the verdict was the worst severity
  // across every section while the count only ever looked at the itemised
  // concerns. Both are now taken from one tally, and the board — which the
  // assembler never saw — is folded in, so a director carrying a red flag is
  // visible in the company's own verdict.
  const counts: Record<Severity, number> = { red: 0, amber: 0, clear: 0, info: 0 };
  for (const c of concerns) counts[c.severity] += 1;
  for (const s of brief.sections) {
    if (s.id === "red-flags") continue;
    for (const f of s.findings) counts[f.severity] += 1;
  }
  const redTotal = counts.red + board.red;
  const amberTotal = counts.amber + board.amber;
  let verdict: Severity = brief.verdict;
  for (const p of people) if (p.verdict) verdict = worstOf(verdict, p.verdict);
  if (redTotal > 0) verdict = worstOf(verdict, "red");
  else if (amberTotal > 0 && verdict === "red") verdict = "amber";

  const meta = VERDICT_META[verdict] ?? VERDICT_META.info;
  const takeaway = buildTakeaway(run, redTotal, amberTotal, board.red);
  const sourcesChecked = run.progress.filter((p) => p.status === "done").length;
  const urlByRef = sourceUrls(brief.citations);
  const section = (id: string) => brief.sections.find((s) => s.id === id);

  // Sections rendered explicitly below rather than mapped in config order — a
  // designed page, not a dump of whatever the config happened to enable.
  const summary = section("red-flags");
  const summaryNotes = (summary?.findings ?? []).filter(
    (f) => f.severity === "info" && f.text !== summary?.emptyText,
  );

  const listSection = (id: string) => {
    const s = section(id);
    if (!s || s.empty || s.findings.length === 0) return null;
    return (
      <ul className="space-y-1.5">
        {s.findings.map((f, i) => {
          const refs = f.sourceRefs ?? (f.sourceRef !== undefined ? [f.sourceRef] : []);
          return (
            <li key={i} className="flex items-start gap-2.5">
              <span
                className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: severityStyle[f.severity].dot }}
                aria-hidden
              />
              <span className="text-[13px] leading-relaxed text-ink-primary">
                {humanizeCaps(f.text) || f.text}
                {refs.map((n) => (
                  <CitationRef key={n} n={n} url={urlByRef.get(n)} />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="fade-in mx-auto w-full max-w-5xl">
      {/* Action bar */}
      <div className="no-print mb-5 flex items-center justify-between gap-3">
        <span className="eyebrow">Pre-meeting brief</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={download}
            disabled={downloading}
            className="rounded-lg border border-[rgba(23,43,77,0.14)] bg-white px-3.5 py-2 text-[12.5px] font-medium text-navy-primary transition hover:bg-ice disabled:opacity-60"
          >
            {downloading ? "Preparing…" : "↓ Download"}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-[rgba(23,43,77,0.14)] bg-white px-3.5 py-2 text-[12.5px] font-medium text-navy-primary transition hover:bg-ice"
          >
            New search
          </button>
        </div>
      </div>

      {downloadError && (
        <p
          className="no-print mb-3 rounded-lg px-3 py-2 text-[12.5px]"
          style={{
            background: severityStyle.red.tint,
            color: severityStyle.red.ink,
            border: `1px solid ${severityStyle.red.border}`,
          }}
          role="status"
        >
          {downloadError} You can still open it at{" "}
          <a className="underline" href={apiUrl(`/print?id=${run.id}`)} target="_blank" rel="noopener noreferrer">
            the print view
          </a>
          .
        </p>
      )}

      {/* The document */}
      <div id="brief-print" data-dashboard-capture-root="true" className="card-surface px-6 py-6 sm:px-8 sm:py-7">
        {/* Masthead */}
        <header className="border-b border-[rgba(23,43,77,0.12)] pb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="font-display text-[27px] leading-tight text-navy-deep">{run.subject.company}</h2>
            <span className="text-[11px] text-ink-secondary">As of {formatGenerated(run.createdAt)}</span>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-secondary">
            {isCompany ? "Company governance pre-screen" : "Individual / director pre-screen"}
            {run.subject.promoters.length > 0 && ` · ${run.subject.promoters.join(" · ")}`}
          </p>
        </header>

        {/* Verdict + score — one block, one answer */}
        <div
          className="mt-5 grid grid-cols-1 gap-5 rounded-xl p-5 md:grid-cols-[minmax(0,150px)_1fr]"
          style={{ background: meta.soft, border: `1px solid ${meta.color}26` }}
        >
          <div className="md:border-r md:border-[rgba(23,43,77,0.10)] md:pr-5">
            <RiskDial run={run} />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span
                className="rounded-full px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.09em]"
                style={{ background: "#ffffffcc", color: meta.color, border: `1px solid ${meta.color}33` }}
              >
                {meta.label}
              </span>
              <span className="text-[12.5px] text-ink-secondary">{meta.line}</span>
            </div>

            <p className="mt-3 font-editorial text-[20px] leading-snug text-navy-deep">{takeaway}</p>

            <div className="mt-4 flex flex-wrap items-start gap-x-8 gap-y-3 border-t pt-3" style={{ borderColor: `${meta.color}22` }}>
              <Stat value={redTotal} label={redTotal === 1 ? "red flag" : "red flags"} tint={redTotal ? severityStyle.red.dot : undefined} />
              <Stat value={amberTotal} label="to review" tint={amberTotal ? severityStyle.amber.dot : undefined} />
              <Stat value={`${sourcesChecked}/${run.progress.length}`} label="sources" />
              {board.total > 0 && (
                <Stat
                  value={`${board.done}/${board.total}`}
                  label={run.status === "running" && board.done < board.total ? "directors screened…" : "directors screened"}
                />
              )}
            </div>
          </div>
        </div>

        {/* What drives the score */}
        <Section title="Risk drivers">
          <RiskDrivers run={run} />
        </Section>

        {/* Key concerns — the point of the report, so it leads */}
        <Section title="Key concerns" count={concerns.length}>
          {concerns.length > 0 ? (
            <ConcernCards concerns={concerns} citations={brief.citations} />
          ) : (
            <p className="flex items-start gap-2.5 text-[13px] leading-relaxed text-ink-primary">
              <span
                className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: summary?.emptyText ? severityStyle.info.dot : severityStyle.clear.dot }}
              />
              <span>{summary?.emptyText ?? "No red-flag or review-level concerns surfaced across the sources that completed."}</span>
            </p>
          )}
          {summaryNotes.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-[rgba(23,43,77,0.08)] pt-2.5">
              {summaryNotes.map((f, i) => {
                const refs = f.sourceRefs ?? (f.sourceRef !== undefined ? [f.sourceRef] : []);
                return (
                  <li key={i} className="text-[12px] leading-relaxed text-ink-secondary">
                    {f.text}
                    {refs.map((n) => (
                      <CitationRef key={n} n={n} url={urlByRef.get(n)} />
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* The board, one director at a time */}
        {isCompany && people.length > 0 && (
          <Section
            title="Board diligence"
            meta={
              <>
                {board.red > 0 && <span style={{ color: severityStyle.red.ink }}>{board.red} red · </span>}
                {board.amber > 0 && <span style={{ color: severityStyle.amber.ink }}>{board.amber} to review · </span>}
                {board.done}/{board.total} screened by DIN
              </>
            }
          >
            <DiligenceGrid people={people} running={run.status === "running"} />
          </Section>
        )}

        {network && network.interlocks.length > 0 && (
          <Section title="Related-party network" count={network.interlocks.length}>
            <NetworkContent run={run} />
          </Section>
        )}

        {section("profile") && (
          <Section title="Profile & background">
            <ProfileCard
              hits={run.collected?.find((c) => c.sourceId === "profile")?.hits ?? []}
              citations={brief.citations}
            />
          </Section>
        )}

        {/* Paired only when both halves exist — a lone column beside an empty
            one reads as something failed to load. */}
        <Pair
          left={section("snapshot") ? { title: "Company record", body: listSection("snapshot") } : null}
          right={section("management") ? { title: "Key people", body: listSection("management") } : null}
        />
        <Pair
          left={section("litigation") ? { title: "Court cases", body: listSection("litigation") } : null}
          right={section("defaulters") ? { title: "Loan defaults", body: listSection("defaulters") } : null}
        />


        {section("directorships") && <Section title="Other directorships">{listSection("directorships")}</Section>}
        {section("filings") && <Section title="Filings & disclosures">{listSection("filings")}</Section>}

        {section("press") && (
          <Section title="Recent news" count={printBrief?.news.length ?? 0}>
            <NewsTable rows={printBrief?.news ?? []} citations={brief.citations} />
          </Section>
        )}

        {section("positives") && <Section title="Positive signals">{listSection("positives")}</Section>}

        {/* What was and was not reached */}
        <Section title="Scope & limitations">
          <ScopeContent run={run} />
        </Section>

        {/* Sources */}
        {brief.citations.length > 0 && (
          <section className="mt-6 rounded-lg bg-surface-band/70 p-4">
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
            <ol className={`space-y-1 ${sourcesOpen ? "mt-2.5" : "hidden"}`}>
              {brief.citations.map((c) => {
                const tier = sourceTier(c.sourceName);
                const entry = (
                  <>
                    <span className="tabular font-semibold text-navy-primary/70">[{c.ref}]</span> {c.sourceName}
                    <span className="mx-1.5 rounded bg-ice px-1 py-0.5 text-[9px] font-semibold uppercase tracking-[0.05em] text-ink-secondary/70">
                      {tier.label}
                    </span>
                    {c.label}
                  </>
                );
                return (
                  <li key={c.ref} className="text-[12px] leading-relaxed text-ink-secondary">
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noreferrer" title={c.url} className="underline-offset-2 hover:text-royal hover:underline">
                        {entry}
                      </a>
                    ) : (
                      entry
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <p className="mt-5 text-[10.5px] leading-relaxed text-ink-secondary/70">
          {brief.synthesizedBy === "ai"
            ? "Summary written by AI from live source data — every claim links to a source above. Illustrative pre-screen; verify before relying."
            : "Assembled from live source data. Illustrative pre-screen; verify before relying."}
        </p>
      </div>

      {/* The download output — print-only, portalled to <body>. */}
      {printBrief && <BriefPrint brief={printBrief} />}
    </div>
  );
}
