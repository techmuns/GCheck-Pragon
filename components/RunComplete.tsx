"use client";

import { useEffect } from "react";
import type { Run } from "@/lib/types";

// ── The hand-off ────────────────────────────────────────────────────────────
// A run that takes minutes used to end by simply becoming the brief: the last
// source settled and the report was on screen, mid-blink, with no moment
// between the two. Work that the reader has been watching happen deserves to
// be handed over rather than swapped, and a reader who has been watching needs
// a beat to change what they are reading for — from "is it working" to "what
// did it find".
//
// So the walk closes on itself: one tick, what was covered, and a line saying
// the brief is next. Short — this is a punctuation mark, not a screen — and
// self-advancing, because a button here would ask the reader to confirm they
// want the thing they have been waiting for.

interface Props {
  run: Run;
  /** Fired once the beat has been held. */
  onDone: () => void;
}

/** Long enough to read the tick and the counts, short enough that a reader
 *  who already knows what it says is not made to wait through it. */
const HOLD_MS = 1700;

export default function RunComplete({ run, onDone }: Props) {
  useEffect(() => {
    const t = setTimeout(onDone, HOLD_MS);
    return () => clearTimeout(t);
  }, [onDone]);

  const progress = run.progress ?? [];
  const covered = progress.filter((p) => p.status === "done").length;
  const found = progress.reduce((n, p) => n + (p.hits ?? 0), 0);
  const missed = progress.filter((p) => p.status === "error" || p.status === "locked").length;

  return (
    <div className="card-surface fade-in mx-auto w-full max-w-md p-7 text-center" role="status" aria-live="polite">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-signal-positive/10">
        <span className="rc-tick text-[26px] leading-none text-signal-positive" aria-hidden>
          ✓
        </span>
      </div>

      <h2 className="mt-3.5 font-display text-[20px] leading-tight text-navy-deep">Research complete</h2>

      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-secondary">
        {covered} {covered === 1 ? "source" : "sources"} checked
        {found > 0 && <> · {found} {found === 1 ? "record" : "records"} read</>}
        {/* Named here rather than left for the reader to notice in the brief:
            a coverage hole is the one thing a completion screen must not
            imply away by saying only what went well. */}
        {missed > 0 && (
          <>
            {" "}
            · {missed} {missed === 1 ? "source" : "sources"} unavailable
          </>
        )}
      </p>

      <div className="mt-4">
        <div className="h-1 w-full overflow-hidden rounded-full bg-soft-border">
          <div className="rc-fill h-full rounded-full" />
        </div>
        <p className="mt-2 text-[12.5px] text-ink-secondary/85">Putting your brief together…</p>
      </div>
    </div>
  );
}
