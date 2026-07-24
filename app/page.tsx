"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SearchForm from "@/components/SearchForm";
import ResearchProgress from "@/components/ResearchProgress";
import BriefView from "@/components/BriefView";
import type { Run } from "@/lib/types";

type Phase = "idle" | "running" | "done" | "error";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const start = useCallback(
    async (company: string, promoters: string[]) => {
      setError(null);
      setPhase("running");
      try {
        const res = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company, promoters }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Could not start the pre-screen.");
        const { id } = await res.json();

        // Poll the run until it completes.
        stopPolling();
        pollRef.current = setInterval(async () => {
          const r = await fetch(`/api/research/${id}`);
          if (!r.ok) return;
          const data: Run = await r.json();
          setRun(data);
          if (data.status === "complete") {
            stopPolling();
            setPhase("done");
          } else if (data.status === "error") {
            stopPolling();
            setError(data.error ?? "The pre-screen failed.");
            setPhase("error");
          }
        }, 500);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setPhase("error");
      }
    },
    [stopPolling],
  );

  const reset = useCallback(() => {
    stopPolling();
    setRun(null);
    setError(null);
    setPhase("idle");
  }, [stopPolling]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      {phase === "idle" && <SearchForm onSubmit={start} />}

      {phase === "running" && run && <ResearchProgress subject={run.subject} progress={run.progress} />}
      {phase === "running" && !run && (
        <div className="card-surface fade-in w-full max-w-xl p-7 text-center text-ink-secondary">
          Starting pre-screen…
        </div>
      )}

      {phase === "done" && run && <BriefView run={run} onReset={reset} />}

      {phase === "error" && (
        <div className="card-surface fade-in w-full max-w-md p-6 text-center">
          <div className="eyebrow mb-1 !text-coral">Something went wrong</div>
          <p className="text-[14px] text-ink-primary">{error}</p>
          <button
            type="button"
            onClick={reset}
            className="blob-btn mt-4 rounded-xl px-5 py-2.5 text-[13px] font-semibold"
          >
            Try again
          </button>
        </div>
      )}

      <footer className="mt-10 text-[11px] text-ink-secondary/60">Paragon Partners · Governance Pre-Screen</footer>
    </main>
  );
}
