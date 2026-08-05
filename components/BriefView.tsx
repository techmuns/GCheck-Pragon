"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Run, Severity } from "@/lib/types";
import { apiUrl, authHeaders } from "@/lib/api";
import { useHostContext } from "@/hooks/useHostContext";
import { severityStyle } from "./severity";
import { VERDICT_META } from "./BriefViz";
import BriefPrint, { type PrintVariant } from "./BriefPrint";
import ConcernCards from "./ConcernCards";
import NewsTable from "./NewsTable";
import ProfileCard from "./ProfileCard";
import DiligenceGrid from "./DiligenceSection";
import { RiskDial, RiskDrivers, NetworkContent, ScopeContent } from "./InstitutionalPanels";
import CitationRef, { sourceUrls } from "./CitationRef";
import { buildPrintBrief, formatGenerated, listConcerns, type Person } from "@/lib/printBrief";
import { buildNetwork } from "@/lib/network";
import { sourceTier } from "@/lib/risk";
import { humanizeCaps } from "@/lib/text";
import { reconcile } from "@/lib/verdict";

interface Props {
  run: Run;
  onReset: () => void;
  /** Rendered from the copy saved in this browser rather than from a live run.
   *  The server no longer holds it, so nothing here may ask the server for
   *  anything — the PDFs are produced locally instead. */
  archived?: boolean;
  /** Re-run this subject. Offered on a brief opened out of history, where the
   *  reason for opening it is usually to decide whether it still holds. */
  onRunAgain?: () => void;
  /** Screen these people, each as a pre-screen of their own. Absent when the
   *  brief is rendered somewhere that cannot start runs (the print preview). */
  onScreenPeople?: (people: Array<{ name: string; din?: string }>) => void;
  /** Screen these companies, each as a pre-screen of its own — the same move
   *  in the other direction, off a director's own directorships. */
  onScreenCompanies?: (companies: Array<{ name: string }>) => void;
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

/** Whole days since a brief was written, for saying plainly how old a saved one
 *  is. Null when the timestamp cannot be read — a guess about how stale a
 *  document is would be worse than saying nothing about it. */
function age(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

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

/**
 * The footer both pickers share: what is selected, and the button that runs it.
 *
 * One component because the two lists differ only in what they hold. A second
 * copy of this would be a second place for the wording and the disabled state
 * to drift apart, on controls that sit a few centimetres from each other.
 */
function RunSelection({
  count,
  idle,
  action,
  note,
  onRun,
}: {
  count: number;
  idle: string;
  action: (n: number) => string;
  note: string;
  onRun: () => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onRun}
        disabled={count === 0}
        className="mt-2.5 w-full rounded-lg border border-[rgba(23,43,77,0.14)] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-navy-primary transition enabled:hover:bg-ice disabled:opacity-45"
      >
        {count === 0 ? idle : action(count)}
      </button>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-secondary/75">{note}</p>
    </>
  );
}

/** The entity a directorship line names. The line reads "<name> — <status>",
 *  and it is the name the pre-screen needs; the status is the register's word
 *  about it, not part of what it is called. */
function entityOf(text: string): string {
  return text.split(/\s+—\s+/)[0].trim();
}

/** Identity for selection — the DIN where the register gave one, because two
 *  rows can carry the same name and mean different people. */
function personKey(p: Person): string {
  return p.din ? `din:${p.din}` : `name:${p.name.toLowerCase()}`;
}

/**
 * Key people, each of whom can be sent for a pre-screen of their own.
 *
 * A board list answers "who are these people" and stops. The next question a
 * partner asks is always about one of them in particular, and answering it
 * meant retyping a name into the search box and losing the brief you were
 * reading. Ticking them here runs the same director screen the search box
 * runs — carrying the DIN where the register gave one, so the run is about
 * that person and not about everyone who shares their name — and the results
 * arrive under this brief in the rail rather than in place of it.
 */
function PeoplePicker({
  people,
  picked,
  onToggle,
  onRun,
}: {
  people: Person[];
  picked: Set<string>;
  onToggle: (id: string) => void;
  onRun: () => void;
}) {
  const count = picked.size;
  return (
    <div>
      <ul className="space-y-0.5">
        {people.map((p) => {
          const id = personKey(p);
          const on = picked.has(id);
          return (
            <li key={id}>
              <label
                className={`flex cursor-pointer items-baseline gap-2.5 rounded-md px-1.5 py-1 transition ${
                  on ? "bg-navy-primary/[0.06]" : "hover:bg-ice/70"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggle(id)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#27457E]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-ink-primary">{p.name}</span>
                  {(p.role || p.din) && (
                    <span className="block truncate text-[11px] text-ink-secondary/80">
                      {[p.role, p.din ? `DIN ${p.din}` : null].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <RunSelection
        count={count}
        idle="Select people to pre-screen"
        action={(n) => `Pre-screen ${n} selected ${n === 1 ? "person" : "people"}`}
        note="Each runs as its own director pre-screen and appears under this one on the left. This brief stays open."
        onRun={onRun}
      />
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

export default function BriefView({
  run,
  onReset,
  archived = false,
  onRunAgain,
  onScreenPeople,
  onScreenCompanies,
}: Props) {
  const { session } = useHostContext();
  const brief = run.brief;
  // Which document is being produced, so only the button that was pressed
  // shows the wait — a spinner on both reads as though both are running.
  const [downloading, setDownloading] = useState<"detailed" | "onepager" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  /** Which document the print stylesheet should reveal. Only meaningful for an
   *  archived brief, where both PDFs are produced by printing this page rather
   *  than by asking the server to render one. */
  const [printVariant, setPrintVariant] = useState<PrintVariant>("detailed");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [clarificationsOpen, setClarificationsOpen] = useState(false);
  /** Key people ticked for a pre-screen of their own, keyed by DIN where the
   *  register gave one and by name otherwise. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /** Entities ticked off a director's own directorships, keyed by CIN where the
   *  register gave one and by name otherwise. */
  const [pickedCos, setPickedCos] = useState<Set<string>>(new Set());
  /** Set when a variant has been chosen and the print dialog is waiting on the
   *  portal to re-render under it. */
  const [pendingPrint, setPendingPrint] = useState(false);

  /**
   * Print an archived brief.
   *
   * The two downloads are rendered server-side by driving Chromium over
   * /print?id=…, and that route resolves the run out of the in-memory store —
   * which by definition no longer holds an archived run. So a saved brief
   * produces its PDFs the other way round: the same print component is already
   * portalled to <body> and the print stylesheet already reveals only it, so
   * printing this page yields the identical A4 document with no server in it.
   * Both documents survive that way, one-pager included — it is a cut of the
   * same component, not a second layout, and dropping it would quietly remove
   * the sheet a partner actually carries into the meeting.
   */
  function printArchived(variant: PrintVariant): void {
    setDownloadError(null);
    setPrintVariant(variant);
    setPendingPrint(true);
  }

  useEffect(() => {
    if (!pendingPrint) return;
    // No animation frame, and nothing cancellable. Clearing the trigger inside
    // the effect that owns the frame changes the effect's own dependency, so
    // React runs its cleanup — cancelling the frame before it can ever fire,
    // and the print dialog never opens at all. The variant is already committed
    // by the time a passive effect runs, because it was set in the same click,
    // so the portal is showing the right document already.
    setPendingPrint(false);
    try {
      window.print();
    } catch {
      setDownloadError("This browser refused to open the print dialog.");
    }
  }, [pendingPrint]);

  /**
   * Get the PDF out of an embedded page.
   *
   * This dashboard runs inside an iframe on the host app, so the PDF is fetched
   * as a blob and handed to a synthetic `a.click()` with a real filename.
   *
   * It used to also pre-open a blank tab to navigate to the blob, on the theory
   * that a framed download would be refused. That backfired twice over: the
   * `noopener` it was opened with makes `window.open` return null, so the
   * handle needed to navigate it never existed — and the tab was left sitting
   * there as a blank white page beside a download that had in fact succeeded
   * through the anchor all along. The anchor is the whole mechanism now, and
   * the file lands with the name we gave it rather than a blob UUID.
   */
  async function download(variant: "detailed" | "onepager") {
    if (downloading) return;
    setDownloading(variant);
    setDownloadError(null);

    try {
      const res = await fetch(
        apiUrl(`/api/research/${run.id}/pdf${variant === "onepager" ? "?variant=onepager" : ""}`),
        { headers: authHeaders(session.token) },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `The server could not render the PDF (${res.status}).`);
      }
      const url = URL.createObjectURL(await res.blob());
      const name = `${variant === "onepager" ? "One-Pager" : "Pre-Screen"} — ${run.subject.company}.pdf`;
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setDownloadError(e instanceof Error ? e.message : "Could not produce the PDF.");
    } finally {
      setDownloading(null);
    }
  }

  if (!brief) return null;

  const printBrief = buildPrintBrief(run, formatGenerated(run.createdAt));
  const concerns = listConcerns(run);
  const people = run.diligence ?? [];
  const isCompany = run.subject.type !== "director";

  // The structured people — the same rows the print sheet uses, which unlike
  // the prose list carry a DIN, and so can be screened as a specific person
  // rather than as a name.
  const peopleRows = printBrief?.people ?? [];

  function togglePicked(id: string): void {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runPicked(): void {
    const chosen = peopleRows.filter((p) => picked.has(personKey(p)));
    if (chosen.length === 0) return;
    onScreenPeople?.(chosen.map((p) => ({ name: p.name, din: p.din })));
    setPicked(new Set());
  }

  function toggleCompany(id: string): void {
    setPickedCos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runPickedCompanies(): void {
    if (pickedCos.size === 0) return;
    onScreenCompanies?.([...pickedCos].map((name) => ({ name })));
    setPickedCos(new Set());
  }
  const network = buildNetwork(run);

  // ── Reconciling the verdict with the numbers beneath it ────────────────────
  // These used to disagree in public: the banner read RED FLAGS while the tally
  // beside it read "0 red flags", because the verdict was the worst severity
  // across every section while the count only ever looked at the itemised
  // concerns. Both come from one tally, with the board — which the assembler
  // never saw — folded in, so a director carrying a red flag is visible in the
  // company's own verdict. That tally now lives in lib/verdict.ts, because the
  // run rail and the history list show the same verdict and had each grown
  // their own reading of it.
  const rec = reconcile(run);
  const board = rec?.board ?? { total: people.length, done: 0, red: 0, amber: 0 };
  const verdict: Severity = rec?.verdict ?? brief.verdict;
  const redTotal = rec?.red ?? 0;
  const amberTotal = rec?.amber ?? 0;

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

  /**
   * A section's findings as a list.
   *
   * `selectable` turns each line into a checkbox without otherwise changing it:
   * same text, same citation, same spacing, with the severity dot swapped for
   * the box. Used on the directorships list, where every line names a company
   * that can be sent for a pre-screen of its own — so the list a reader already
   * knows gains a control rather than being replaced by a second list showing
   * them the same thing differently.
   */
  const listSection = (id: string, selectable = false) => {
    const s = section(id);
    if (!s || s.empty || s.findings.length === 0) return null;
    const pick = selectable && Boolean(onScreenCompanies);
    return (
      <>
        <ul className="space-y-1.5">
          {s.findings.map((f, i) => {
            const refs = f.sourceRefs ?? (f.sourceRef !== undefined ? [f.sourceRef] : []);
            const label = humanizeCaps(f.text) || f.text;
            const body = (
              <span className="text-[13px] leading-relaxed text-ink-primary">
                {label}
                {refs.map((n) => (
                  <CitationRef key={n} n={n} url={urlByRef.get(n)} />
                ))}
              </span>
            );
            if (!pick) {
              return (
                <li key={i} className="flex items-start gap-2.5">
                  <span
                    className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: severityStyle[f.severity].dot }}
                    aria-hidden
                  />
                  {body}
                </li>
              );
            }
            // Selectable rows keep the bullet and the reading line exactly as
            // the plain ones have them, and put the control at the end. A
            // checkbox in the bullet's place swaps the thing that marks a row
            // for the thing that acts on it, so the list stops looking like the
            // rest of the document the moment it becomes useful.
            const entity = entityOf(f.text);
            return (
              <li key={i}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-md py-0.5 pr-1 transition hover:bg-ice/60">
                  <span
                    className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: severityStyle[f.severity].dot }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">{body}</span>
                  <input
                    type="checkbox"
                    checked={pickedCos.has(entity)}
                    onChange={() => toggleCompany(entity)}
                    className="mt-[5px] h-3.5 w-3.5 shrink-0 accent-[#27457E]"
                  />
                </label>
              </li>
            );
          })}
        </ul>
        {pick && (
          <RunSelection
            count={pickedCos.size}
            idle="Select companies to pre-screen"
            action={(n) => `Pre-screen ${n} selected ${n === 1 ? "company" : "companies"}`}
            note="Each runs as its own company pre-screen and appears under this one on the left. This brief stays open."
            onRun={runPickedCompanies}
          />
        )}
      </>
    );
  };

  return (
    <div className="fade-in mx-auto w-full max-w-5xl">
      {/* Action bar */}
      <div className="no-print mb-5 flex items-center justify-between gap-3">
        <span className="eyebrow">{archived ? "Saved brief" : "Pre-meeting brief"}</span>
        <div className="flex items-center gap-2">
          {/* Two documents off one brief. The detailed record is everything
              the run produced; the one-pager is its executive sheet alone, for
              the reader walking into the meeting who wants the answer rather
              than the file behind it. Both survive on a saved brief — they are
              printed here rather than rendered by a server that no longer has
              the run. */}
          <button
            type="button"
            onClick={() => (archived ? printArchived("detailed") : download("detailed"))}
            disabled={downloading !== null}
            className="rounded-lg border border-[rgba(23,43,77,0.14)] bg-white px-3.5 py-2 text-[12.5px] font-medium text-navy-primary transition hover:bg-ice disabled:opacity-60"
          >
            {downloading === "detailed" ? "Preparing…" : "↓ Detailed Research"}
          </button>
          <button
            type="button"
            onClick={() => (archived ? printArchived("onepager") : download("onepager"))}
            disabled={downloading !== null}
            className="rounded-lg border border-[rgba(23,43,77,0.14)] bg-white px-3.5 py-2 text-[12.5px] font-medium text-navy-primary transition hover:bg-ice disabled:opacity-60"
          >
            {downloading === "onepager" ? "Preparing…" : "↓ One Pager"}
          </button>
          {onRunAgain && (
            <button
              type="button"
              onClick={onRunAgain}
              className="rounded-lg border border-[rgba(23,43,77,0.14)] bg-white px-3.5 py-2 text-[12.5px] font-medium text-navy-primary transition hover:bg-ice"
            >
              Run again
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-[rgba(23,43,77,0.14)] bg-white px-3.5 py-2 text-[12.5px] font-medium text-navy-primary transition hover:bg-ice"
          >
            {archived ? "Back to history" : "New search"}
          </button>
        </div>
      </div>

      {archived && (
        <p className="no-print mb-3 rounded-lg bg-ice px-3 py-2 text-[12px] leading-relaxed text-ink-secondary">
          Rebuilt from the copy saved in this browser on {formatGenerated(run.createdAt)} — the server no longer holds
          this run, so the two documents above are printed from this page rather than rendered by it.
          {age(run.createdAt) !== null && age(run.createdAt)! >= 7 && (
            <> Nothing that has happened in the {age(run.createdAt)} days since is in it; run it again for that.</>
          )}
        </p>
      )}

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
          {downloadError}{" "}
          {archived ? (
            // No print view to offer: the archived brief lives in this browser
            // and /print?id= resolves against the server store, which is the
            // 404 the saved copy exists to route around. Saying so is better
            // than a link that dead-ends.
            <>The saved brief can’t be exported from inside an embedded view — open this page in its own tab.</>
          ) : (
            <>
              You can still open it at{" "}
              <a className="underline" href={apiUrl(`/print?id=${run.id}`)} target="_blank" rel="noopener noreferrer">
                the print view
              </a>
              .
            </>
          )}
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
          right={
            // The picker replaces the plain list wherever we have the structured
            // people (which carry the DIN) and somewhere to send them. The list
            // remains the fallback: the print preview renders this same view
            // with no way to start a run, and a dead checkbox is worse than a
            // list that never offered one.
            // A director screen answers "where does this person sit" here. The
            // slot used to hold a board list, which on a director run is other
            // people's colleagues — and was fed from rows carrying the
            // subject's own name, so it listed the subject as their own
            // associate. The picker stays where it belongs: on a company
            // screen, over the board.
            isCompany && onScreenPeople && peopleRows.length > 0
              ? {
                  title: "Key people",
                  body: (
                    <PeoplePicker
                      people={peopleRows}
                      picked={picked}
                      onToggle={togglePicked}
                      onRun={runPicked}
                    />
                  ),
                }
              : // A director screen has no "key people" — the section was
                // filling with the co-directors of every board the run read,
                // and with the subject themselves at the top of them. Where
                // this person actually sits is the answer to the search, so it
                // takes the slot, and each company can be sent for a screen of
                // its own from the row it is named on.
                !isCompany && section("directorships")
                ? { title: "Director in these companies", body: listSection("directorships", true) }
                : section("management")
                  ? { title: "Key people", body: listSection("management") }
                  : null
          }
        />
        <Pair
          left={section("litigation") ? { title: "Court cases", body: listSection("litigation") } : null}
          right={section("defaulters") ? { title: "Loan defaults", body: listSection("defaulters") } : null}
        />


        {/* Company runs only. On a director run these are the subject's own
            directorships, and they are already the panel above — printing them
            twice under a heading that calls them "other" would be two answers
            to one question, disagreeing about whose companies they are. */}
        {isCompany && section("directorships") && (
          <Section title="Other directorships">{listSection("directorships", true)}</Section>
        )}
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

        {/* What was reached, read, and deliberately not counted. Collapsed by
            default: it is the answer to a question, not something the reader is
            looking for on the way in — but a page that never offers the answer
            leaves every quiet section ambiguous. */}
        {(printBrief?.clarifications.length ?? 0) > 0 && (
          <section className="mt-6 rounded-lg bg-surface-band/70 p-4">
            <button
              type="button"
              onClick={() => setClarificationsOpen((o) => !o)}
              aria-expanded={clarificationsOpen}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="eyebrow">
                Considered &amp; not counted · {printBrief!.clarifications.length}
              </span>
              <span
                className={`text-[11px] text-ink-secondary/60 transition ${clarificationsOpen ? "rotate-180" : ""}`}
                aria-hidden
              >
                ▾
              </span>
            </button>
            <div className={clarificationsOpen ? "mt-2.5 space-y-2.5" : "hidden"}>
              <p className="text-[12px] leading-relaxed text-ink-secondary">
                Searches that returned nothing, and material that surfaced under the subject&apos;s name
                and was set aside — so a quiet section reads as checked rather than skipped.
              </p>
              {printBrief!.clarifications.map((c, i) => (
                <div key={i} className="border-t border-[rgba(23,43,77,0.06)] pt-2 first:border-0 first:pt-0">
                  <div className="text-[12.5px] text-ink-primary">
                    <span className="font-medium">{c.source}</span>{" "}
                    <span className="text-ink-secondary">{c.text}</span>
                  </div>
                  {c.items.length > 0 && (
                    <ul className="mt-1 space-y-0.5 pl-3">
                      {c.items.map((it, j) => (
                        <li key={j} className="flex items-baseline justify-between gap-3 text-[11.5px]">
                          <span className="min-w-0 truncate text-ink-primary/85">
                            {it.url ? (
                              <a
                                href={it.url}
                                target="_blank"
                                rel="noreferrer"
                                className="underline-offset-2 hover:text-royal hover:underline"
                              >
                                {it.title}
                              </a>
                            ) : (
                              it.title
                            )}
                          </span>
                          <span className="shrink-0 italic text-ink-secondary/75">{it.reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

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

      {/* The download output — print-only, portalled to <body>. The variant
          only ever moves for an archived brief, whose PDFs are printed from
          here; a live run's are rendered server-side and never touch it. */}
      {printBrief && <BriefPrint brief={printBrief} variant={printVariant} />}
    </div>
  );
}
