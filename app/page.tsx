"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import SearchForm from "@/components/SearchForm";
import AuroraBackground from "@/components/AuroraBackground";
import PrepCountdown from "@/components/PrepCountdown";
import ResearchProgress from "@/components/ResearchProgress";
import BriefView from "@/components/BriefView";
import { apiUrl } from "@/lib/api";
import { addRecentSearch } from "@/lib/history";
import { displayName } from "@/lib/directorId";
import type { Run } from "@/lib/types";

type Phase = "idle" | "running" | "done" | "error";

// A run is bounded server-side (each source has its own deadline), so anything
// past this is a run that will never land — a recycled instance, most likely.
const RUN_TIMEOUT_MS = 4 * 60 * 1000;
// Consecutive failed polls tolerated before giving up. At 500ms apart, this
// rides out a brief blip without stringing the user along through an outage.
const MAX_POLL_FAILURES = 10;

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The progress UI walks source by source at its own pace. The brief waits for
  // that walk to finish even if the backend answers first, so the user always
  // sees the full "collecting, one source at a time" sequence.
  const [walked, setWalked] = useState(false);
  // The counted pre-search countdown runs first, over the request kick-off.
  // We track only whether its beats have finished; the prep view then *holds*
  // until the run actually lands, so a slow/cold-started backend never drops
  // the user onto a bare interstitial.
  const [countdownDone, setCountdownDone] = useState(false);
  // Subject shown during the countdown, before the run object comes back.
  const [pending, setPending] = useState<Run["subject"] | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onWalkComplete = useCallback(() => setWalked(true), []);
  const onPrepped = useCallback(() => setCountdownDone(true), []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const start = useCallback(
    async (company: string, promoters: string[], type: "company" | "director" = "company") => {
      setError(null);
      setWalked(false);
      setCountdownDone(false);
      // The director box can carry a DIN and a company alongside the name — an
      // autocomplete pick, or a DIN typed straight in. The request needs all of
      // it; the screen only ever shows the person.
      setPending({ type, company: type === "director" ? displayName(company) : company, promoters });
      setPhase("running");
      // Stored raw, so "Run again" re-runs the same person rather than falling
      // back to their name and picking up whoever else shares it.
      addRecentSearch({ type, company, promoters });
      try {
        const res = await fetch(apiUrl("/api/research"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type, company, promoters }),
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Could not start the pre-screen.");
        const { id } = await res.json();

        // Poll the run until it completes. Every exit from this loop has to be
        // accounted for — a poll that can only stop on success leaves the user
        // on a progress screen that never resolves.
        stopPolling();
        const startedAt = Date.now();
        let consecutiveFailures = 0;
        const fail = (message: string) => {
          stopPolling();
          setError(message);
          setPhase("error");
        };
        pollRef.current = setInterval(async () => {
          // The instance can be recycled mid-run (the run store is in-memory),
          // and no amount of further polling will bring that run back.
          if (Date.now() - startedAt > RUN_TIMEOUT_MS) {
            fail("The pre-screen is taking longer than expected. Please try again.");
            return;
          }
          try {
            const r = await fetch(apiUrl(`/api/research/${id}`));
            if (r.status === 404) {
              fail("This pre-screen is no longer available — the server restarted. Please run it again.");
              return;
            }
            if (!r.ok) {
              // A transient 5xx is worth riding out; a persistent one is not.
              if (++consecutiveFailures >= MAX_POLL_FAILURES) fail("Lost contact with the server. Please try again.");
              return;
            }
            const data: Run = await r.json();
            consecutiveFailures = 0;
            setRun(data);
            if (data.status === "complete") {
              stopPolling();
              setPhase("done");
            } else if (data.status === "error") {
              fail(data.error ?? "The pre-screen failed.");
            }
          } catch {
            // Offline, or the request was cut off. Same rule as a bad status:
            // tolerate a blip, give up on a pattern. Without this catch the
            // rejection escapes the interval callback entirely and the loop
            // spins on in silence.
            if (++consecutiveFailures >= MAX_POLL_FAILURES) fail("Lost contact with the server. Please try again.");
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
    setWalked(false);
    setCountdownDone(false);
    setPending(null);
    setPhase("idle");
  }, [stopPolling]);

  // Three staged views, in order: the counted countdown, the source walk, then
  // the brief. Each waits for the one before it to finish its own beat, so a
  // fast backend never cuts the sequence short.
  const busy = phase === "running" || phase === "done";
  // "Prepped" means the countdown has finished AND the run has landed. Until the
  // run arrives, the prep view stays up (holding), so the wait is never a bare
  // screen — even when a cold-started backend takes a while to answer.
  const prepped = countdownDone && run !== null;
  const showPrep = busy && !prepped && (pending !== null || run !== null);
  // Once the beats are done but the run still hasn't landed, the prep card holds
  // on a reassuring "setting things up" state instead of counting further.
  const prepHolding = countdownDone && run === null;
  // Hold on the progress view until BOTH the run is complete and the walk has
  // visited every source. A run with no sources to walk has nothing to hold for.
  const nothingToWalk = (run?.progress.length ?? 0) === 0;
  const revealed = walked || nothingToWalk;
  const showProgress = prepped && run !== null && (phase === "running" || (phase === "done" && !revealed));
  const showBrief = phase === "done" && prepped && revealed && run?.brief;
  const centered = phase === "idle" || phase === "error" || showPrep;

  return (
    <main
      className={`flex min-h-screen w-full flex-col items-center px-4 py-10 sm:px-6 lg:px-8 ${
        centered ? "justify-center" : ""
      }`}
    >
      {/* Calm aurora backdrop — behind the search box and lead-in states; it
          steps aside once the data brief takes over. */}
      {centered && <AuroraBackground />}

      {phase === "idle" && <SearchForm onSubmit={start} />}

      {showPrep && (
        <PrepCountdown subject={run?.subject ?? pending!} onDone={onPrepped} holding={prepHolding} />
      )}

      {showProgress && run && (
        <ResearchProgress subject={run.subject} progress={run.progress} onWalkComplete={onWalkComplete} />
      )}

      {showBrief && run && <BriefView run={run} onReset={reset} />}

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

      <footer className="mt-10 flex items-center gap-2 text-[11px] text-ink-secondary/60">
        <span>Paragon Partners · Governance Pre-Screen</span>
        <span aria-hidden>·</span>
        <Link href="/admin" className="text-navy-primary/60 transition hover:text-navy-primary">
          Settings
        </Link>
      </footer>
    </main>
  );
}
