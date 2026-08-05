"use client";

import { useCallback, useEffect, useState } from "react";
import SearchForm from "@/components/SearchForm";
import AuroraBackground from "@/components/AuroraBackground";
import PrepCountdown from "@/components/PrepCountdown";
import ResearchProgress from "@/components/ResearchProgress";
import RunComplete from "@/components/RunComplete";
import BriefView from "@/components/BriefView";
import RunSidebar from "@/components/RunSidebar";
import HistoryView from "@/components/HistoryView";
import { useRuns } from "@/lib/useRuns";
import { useArchive, type OpenedRun } from "@/lib/useArchive";
import { countSearches } from "@/lib/archive";
import { formatSuggestion } from "@/lib/directorId";

export default function Home() {
  const { runs, active, activeKey, start, select, close } = useRuns();
  const { entries, opening, open, remove, clear, exportJson, importJson } = useArchive();

  // Where the page is when no run is selected: the search box, the history
  // list, or a past brief re-opened from it. One value rather than a pile of
  // booleans, so the rail can never highlight two places at once.
  const [view, setView] = useState<"search" | "history">("search");
  const [past, setPast] = useState<OpenedRun | null>(null);
  const [historyNote, setHistoryNote] = useState<string | null>(null);

  // The counted lead-in belongs to whichever run is being started, not to the
  // page — switching away from a run and back must not replay its countdown.
  const [prepped, setPrepped] = useState<Record<string, boolean>>({});
  const onPrepped = useCallback(() => {
    if (activeKey) setPrepped((p) => ({ ...p, [activeKey]: true }));
  }, [activeKey]);

  // The hand-off between the walk and the brief, held per run for the same
  // reason: it is a moment in one run's life, not a state of the page, and
  // returning to a run already read must not replay it.
  const [handed, setHanded] = useState<Record<string, boolean>>({});
  const onHandedOff = useCallback(() => {
    if (activeKey) setHanded((h) => ({ ...h, [activeKey]: true }));
  }, [activeKey]);

  // Drop the flags for runs that have gone, so the maps cannot grow forever.
  useEffect(() => {
    const keys = new Set(runs.map((t) => t.key));
    const prune = (m: Record<string, boolean>) => {
      const next = Object.fromEntries(Object.entries(m).filter(([k]) => keys.has(k)));
      return Object.keys(next).length === Object.keys(m).length ? m : next;
    };
    setPrepped(prune);
    setHanded(prune);
  }, [runs]);

  // Every route back to the front door goes through here, so leaving a brief
  // never lands the reader on the history panel they last had open.
  const goTo = useCallback(
    (key: string | null) => {
      setView("search");
      setPast(null);
      setHistoryNote(null);
      select(key);
    },
    [select],
  );

  const openHistory = useCallback(() => {
    setPast(null);
    setHistoryNote(null);
    setView("history");
    select(null);
  }, [select]);

  const counted = activeKey ? Boolean(prepped[activeKey]) : false;
  // "Ready" means the lead-in has finished AND the run has landed. Until then
  // the prep card holds, so a cold-started backend never drops the user onto a
  // bare screen.
  const ready = counted && active?.run != null;

  const idle = active === null;
  const showPast = idle && past !== null;
  const showHistory = idle && !showPast && view === "history";
  const showForm = idle && !showPast && view === "search";
  const showPrep = active !== null && active.phase !== "error" && !ready;
  // The brief appears the moment it lands, even while a company's board is still
  // being screened — the diligence streams into it live, so there is no reason to
  // hold the whole page on a spinner until the last director is done.
  const hasBrief = active?.run?.brief != null;
  // Work the reader has watched happen is handed over, not swapped: the walk
  // closing straight into the report mid-blink gave no moment to change what
  // they were reading for. One beat sits between them, once per run.
  const handedOff = activeKey ? Boolean(handed[activeKey]) : false;
  const showHandoff = active !== null && ready && hasBrief && active.phase !== "error" && !handedOff;
  const showBrief = active !== null && ready && hasBrief && active.phase !== "error" && handedOff;
  const showProgress = active !== null && ready && active.phase === "running" && !hasBrief;
  const showError = active !== null && active.phase === "error";

  // When the form stands alone (no runs yet), the content column centres itself;
  // once there is a brief or a running pre-screen, it sits at the top.
  const centered = runs.length === 0 && showForm;

  return (
    <div className="min-h-screen">
      {/* Calm aurora backdrop — behind the search box and lead-in states; it
          steps aside once a brief takes over. */}
      {(centered || showPrep) && <AuroraBackground />}

      {/* Recent runs — a fixed left rail on desktop, a horizontal bar on mobile. */}
      <RunSidebar
        runs={runs}
        activeKey={activeKey}
        onSelect={goTo}
        onClose={close}
        onOpenHistory={openHistory}
        historyOpen={showHistory || showPast}
        historyCount={countSearches(entries)}
      />

      {/* Content column, offset clear of the rail on desktop. */}
      <main
        className={`flex min-h-screen w-full flex-col items-center px-4 py-10 sm:px-6 lg:py-12 lg:pr-8 lg:pl-[17rem] ${
          centered ? "justify-center" : ""
        }`}
      >
        {showForm && <SearchForm onSubmit={start} onOpenHistory={openHistory} />}

        {showHistory && (
          <HistoryView
            entries={entries}
            opening={opening}
            notice={historyNote}
            onRunAgain={(rawQuery, promoters, type, ticker) => {
              setView("search");
              start(rawQuery, promoters, type, ticker);
            }}
            onOpen={(id) => {
              setHistoryNote(null);
              void open(id).then((opened) => {
                if (opened) setPast(opened);
                else
                  setHistoryNote(
                    "That brief isn’t here any more — the saved copy was cleared and the server no longer has the run. Run it again to rebuild it.",
                  );
              });
            }}
            onDelete={remove}
            onClear={clear}
            onExport={() => {
              void exportJson().catch(() =>
                setHistoryNote("Couldn’t write the export file. If this page is embedded, open it in its own tab and try again."),
              );
            }}
            onImport={(raw) => {
              void importJson(raw)
                .then((r) =>
                  setHistoryNote(
                    `Imported ${r.added} run${r.added === 1 ? "" : "s"}${r.briefs > 0 ? ` and ${r.briefs} saved brief${r.briefs === 1 ? "" : "s"}` : ""}${
                      r.skipped > 0 ? `; ${r.skipped} were already here` : ""
                    }.`,
                  ),
                )
                .catch((e: unknown) =>
                  setHistoryNote(e instanceof Error ? e.message : "That file couldn’t be imported."),
                );
            }}
          />
        )}

        {/* A brief from history. Either the live run — the server keeps the last
            hundred, so anything from today usually still resolves — or the copy
            saved in this browser, which says so and prints without a server. */}
        {showPast && past && (
          <BriefView
            run={past.run}
            archived={past.archived}
            onReset={() => setPast(null)}
            onRunAgain={() => {
              setPast(null);
              setView("search");
              start(past.entry.rawQuery, past.entry.promoters, past.entry.type, past.entry.ticker);
            }}
            onScreenPeople={(people) => {
              // The same move off a saved brief as off a live one — each pick
              // becomes an ordinary new search, with no parent to hang under
              // because a saved brief is not a tracked run. The brief stays on
              // screen: `keepFocus` means the reader keeps their page, and
              // closing it here would drop them on an empty search form.
              for (const p of people) {
                start(formatSuggestion({ name: p.name, din: p.din }), [], "director", undefined, {
                  keepFocus: true,
                });
              }
            }}
            onScreenCompanies={(companies) => {
              for (const c of companies) start(c.name, [], "company", undefined, { keepFocus: true });
            }}
          />
        )}

        {showPrep && active && (
          <PrepCountdown subject={active.run?.subject ?? active.subject} onDone={onPrepped} holding={active.run === null} />
        )}

        {showProgress && active?.run && (
          <ResearchProgress
            subject={active.run.subject}
            progress={active.run.progress}
            events={active.run.events}
          />
        )}

        {showHandoff && active?.run && <RunComplete run={active.run} onDone={onHandedOff} />}

        {showBrief && active?.run && (
          <BriefView
            run={active.run}
            onReset={() => goTo(null)}
            onScreenPeople={(people) => {
              // One director pre-screen each, exactly as the search box would
              // start them — the DIN goes along where the register gave one, so
              // the run is about that person rather than about their name. They
              // are hung under the brief they were picked from and started
              // without stealing focus, so the reader keeps the page they are on.
              for (const p of people) {
                start(formatSuggestion({ name: p.name, din: p.din }), [], "director", undefined, {
                  parentKey: activeKey ?? undefined,
                  keepFocus: true,
                  skipHistory: true,
                });
              }
            }}
            onScreenCompanies={(companies) => {
              // The same move off a director's own directorships: a full
              // company pre-screen each, hung under the brief they came from.
              // No ticker — the register does not carry one, and inventing one
              // would point the filings source at the wrong listed entity.
              for (const c of companies) {
                start(c.name, [], "company", undefined, {
                  parentKey: activeKey ?? undefined,
                  keepFocus: true,
                  skipHistory: true,
                });
              }
            }}
          />
        )}

        {showError && active && (
          <div className="card-surface fade-in w-full max-w-md p-6 text-center">
            <div className="eyebrow mb-1 !text-coral">Something went wrong</div>
            <p className="text-[14px] text-ink-primary">{active.error ?? "The pre-screen failed."}</p>
            <p className="mt-1 text-[12px] text-ink-secondary">
              Only this search stopped. Anything else still running is unaffected.
            </p>
            <button
              type="button"
              onClick={() => goTo(null)}
              className="blob-btn mt-4 rounded-xl px-5 py-2.5 text-[13px] font-semibold"
            >
              New search
            </button>
          </div>
        )}

        <footer className="mt-10 text-[11px] text-ink-secondary/60">
          <span>Paragon Partners · Governance Pre-Screen</span>
        </footer>
      </main>
    </div>
  );
}
