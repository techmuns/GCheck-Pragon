"use client";

import { useCallback, useEffect, useState } from "react";
import SearchForm from "@/components/SearchForm";
import AuroraBackground from "@/components/AuroraBackground";
import PrepCountdown from "@/components/PrepCountdown";
import ResearchProgress from "@/components/ResearchProgress";
import BriefView from "@/components/BriefView";
import RunSidebar from "@/components/RunSidebar";
import { useRuns } from "@/lib/useRuns";

export default function Home() {
  const { runs, active, activeKey, start, select, close } = useRuns();

  // The counted lead-in belongs to whichever run is being started, not to the
  // page — switching away from a run and back must not replay its countdown.
  const [prepped, setPrepped] = useState<Record<string, boolean>>({});
  const onPrepped = useCallback(() => {
    if (activeKey) setPrepped((p) => ({ ...p, [activeKey]: true }));
  }, [activeKey]);

  // Drop the flag for runs that have gone, so the map cannot grow forever.
  useEffect(() => {
    setPrepped((p) => {
      const keys = new Set(runs.map((t) => t.key));
      const next = Object.fromEntries(Object.entries(p).filter(([k]) => keys.has(k)));
      return Object.keys(next).length === Object.keys(p).length ? p : next;
    });
  }, [runs]);

  const counted = activeKey ? Boolean(prepped[activeKey]) : false;
  // "Ready" means the lead-in has finished AND the run has landed. Until then
  // the prep card holds, so a cold-started backend never drops the user onto a
  // bare screen.
  const ready = counted && active?.run != null;

  const showForm = active === null;
  const showPrep = active !== null && active.phase !== "error" && !ready;
  const showProgress = active !== null && ready && active.phase === "running";
  const showBrief = active !== null && ready && active.phase === "done" && active.run?.brief != null;
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
      <RunSidebar runs={runs} activeKey={activeKey} onSelect={select} onClose={close} />

      {/* Content column, offset clear of the rail on desktop. */}
      <main
        className={`flex min-h-screen w-full flex-col items-center px-4 py-10 sm:px-6 lg:py-12 lg:pr-8 lg:pl-[17rem] ${
          centered ? "justify-center" : ""
        }`}
      >
        {showForm && <SearchForm onSubmit={start} />}

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

        {showBrief && active?.run && <BriefView run={active.run} onReset={() => select(null)} />}

        {showError && active && (
          <div className="card-surface fade-in w-full max-w-md p-6 text-center">
            <div className="eyebrow mb-1 !text-coral">Something went wrong</div>
            <p className="text-[14px] text-ink-primary">{active.error ?? "The pre-screen failed."}</p>
            <p className="mt-1 text-[12px] text-ink-secondary">
              Only this search stopped. Anything else still running is unaffected.
            </p>
            <button
              type="button"
              onClick={() => select(null)}
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
