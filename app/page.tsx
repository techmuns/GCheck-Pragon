"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toBlob } from "html-to-image";
import { sdk } from "@/lib/sdk";
import { useHostContext } from "@/hooks/useHostContext";
import SearchForm from "@/components/SearchForm";
import AuroraBackground from "@/components/AuroraBackground";
import PrepCountdown from "@/components/PrepCountdown";
import ResearchProgress from "@/components/ResearchProgress";
import RunComplete from "@/components/RunComplete";
import BriefView from "@/components/BriefView";
import RunSidebar from "@/components/RunSidebar";
import HistoryView from "@/components/HistoryView";
import { useRuns } from "@/lib/useRuns";
import { keepBackendWarm } from "@/lib/api";
import { useArchive, type OpenedRun } from "@/lib/useArchive";
import { countSearches } from "@/lib/archive";
import { formatSuggestion } from "@/lib/directorId";

export default function Home() {
  const { runs, active, activeKey, start, select, close } = useRuns();
  // What the host is looking at. The ticker seeds the search box (below); the
  // session token is what every API call is authenticated with, threaded
  // through useRuns and the widgets that fetch.
  const { session, ticker, tickerCompany } = useHostContext();
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

  // ── Host capture requests ────────────────────────────────────────────────
  // A getter pointing at the page's current state, reassigned every render so
  // the snapshot handler always reads live values rather than the closure it
  // was registered with.
  const snapshotRef = useRef<() => unknown>(() => ({}));
  snapshotRef.current = () => ({
    context: {
      ticker: active?.run?.subject.ticker ?? active?.subject.ticker ?? ticker ?? null,
      hostTicker: ticker ?? null,
      subject: active?.run?.subject.company ?? active?.subject.company ?? null,
      subjectType: active?.run?.subject.type ?? active?.subject.type ?? null,
      phase: active?.phase ?? null,
    },
    selection: {
      activeRunId: active?.serverId ?? null,
      // Names only — the full run objects would blow the payload cap.
      openRuns: runs.slice(0, 20).map((t) => ({
        id: t.serverId ?? null,
        subject: t.subject.company,
        type: t.subject.type,
        phase: t.phase,
      })),
    },
    data: {
      verdict: active?.run?.brief?.verdict ?? null,
      headline: active?.run?.brief?.headline ?? null,
      // Counts rather than contents: a finished brief carries hundreds of
      // citations and every source's raw output, which is neither small nor
      // useful to the host.
      sections: active?.run?.brief?.sections.length ?? 0,
      citations: active?.run?.brief?.citations.length ?? 0,
      synthesizedBy: active?.run?.brief?.synthesizedBy ?? null,
      sources: (active?.run?.progress ?? []).slice(0, 30).map((p) => ({
        id: p.sourceId,
        name: p.name,
        status: p.status,
        hits: p.hits ?? 0,
      })),
    },
  });

  // Wake the backend as the dashboard loads, and keep it awake while the tab is
  // open. The cold start then happens while the user is choosing a company
  // rather than after they have asked for a brief.
  useEffect(() => keepBackendWarm(), []);

  useEffect(() => {
    // 1) Visual snapshot — a PNG Blob of the dashboard's content area.
    const offVisual = sdk.onRequest("dashboard.capture.visual", async () => {
      try {
        const el =
          document.querySelector("#dashboard-main") ||
          document.querySelector("[data-dashboard-capture-root='true']") ||
          document.querySelector("main");
        if (!el) throw new Error("capture root not found");
        const blob = await toBlob(el as HTMLElement, { pixelRatio: 2 });
        if (!blob) throw new Error("empty snapshot blob");
        return { visualSnapshot: blob, capturedAt: new Date().toISOString() };
      } catch (err) {
        // Never throw out of the handler; return a structured, cloneable error.
        return { ok: false, error: (err as Error).message };
      }
    });

    // 2) State snapshot — the current JSON state of the dashboard.
    const offSnapshot = sdk.onRequest("dashboard.capture.snapshot", () => {
      try {
        return snapshotRef.current();
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    });

    // DO NOT call sdk.ready() here. The SDK auto-sends dashboard:ready on
    // host:init. Calling it manually races the handshake and breaks it.

    return () => {
      offVisual();
      offSnapshot();
    };
  }, []);

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
  const hasBrief = active?.run?.brief != null;
  // ── One final answer, not a moving one ───────────────────────────────────
  // The brief used to appear the moment it landed, while the board was still
  // being screened, on the reasoning that the diligence streams in live and
  // there was no point holding the page on a spinner.
  //
  // That reasoning does not survive the score. A run showed 45/100 and climbed
  // to 80 as directors resolved — so the number a reader saw depended on when
  // they happened to look, and anyone who read, screenshotted or acted on the
  // early figure was acting on a governance verdict that was not yet true. A
  // pre-screen is read once and quoted in a meeting; it has to be settled
  // before it is shown. The walk-through stays up until the run is complete.
  const complete = active?.phase === "done";
  // Work the reader has watched happen is handed over, not swapped: the walk
  // closing straight into the report mid-blink gave no moment to change what
  // they were reading for. One beat sits between them, once per run.
  const handedOff = activeKey ? Boolean(handed[activeKey]) : false;
  const showHandoff = active !== null && ready && complete && hasBrief && !handedOff;
  const showBrief = active !== null && ready && complete && hasBrief && handedOff;
  // Everything that is not yet a settled answer belongs on the walk-through —
  // including a run that finished without a brief, which would otherwise leave
  // the page blank.
  const showProgress =
    active !== null && ready && (active.phase === "running" || (complete && !hasBrief));
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

      {/* Content column, offset clear of the rail on desktop.

          id/data-dashboard-capture-root mark this as the stable target the host
          snapshots for `dashboard.capture.visual`. */}
      <main
        id="dashboard-main"
        data-dashboard-capture-root="true"
        className={`flex min-h-screen w-full flex-col items-center px-4 py-10 sm:px-6 lg:py-12 lg:pr-8 lg:pl-[17rem] ${
          centered ? "justify-center" : ""
        }`}
      >
        {showForm && (
          <SearchForm
            onSubmit={start}
            onOpenHistory={openHistory}
            hostCompany={tickerCompany}
            hostTicker={ticker}
            awaitingSession={session.token === null && sdk.getChannelId() !== null}
          />
        )}

        {showHistory && (
          <HistoryView
            entries={entries}
            opening={opening}
            notice={historyNote}
            onRunAgain={(rawQuery, promoters, type, tick) => {
              setView("search");
              start(rawQuery, promoters, type, tick);
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
                setHistoryNote(
                  "Couldn’t write the export file. If this page is embedded, open it in its own tab and try again.",
                ),
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
              // screen: `keepFocus` means the reader keeps their page.
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
            diligence={active.run.diligence}
            running={active.phase === "running" || active.phase === "starting"}
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
