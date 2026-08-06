"use client";

import { useEffect, useState } from "react";
import type { Subject } from "@/lib/types";

interface Props {
  subject: Subject;
  /** Fired once the countdown has closed the ring. */
  onDone?: () => void;
  /** True once the beats are done but the run hasn't landed yet — the ring
      stays closed and the caption reassures instead of declaring "Ready". */
  holding?: boolean;
}

// ── Pre-search countdown ────────────────────────────────────────────────────
// The moment between "Run pre-screen" and the source walk. Rather than a bare
// "Starting…" line, the ring closes over three counted beats so the wait reads
// as deliberate preparation. Each beat names a real step of the setup.
const BEATS = [
  { n: 1, label: "Reading the name", sub: "Working out who we're screening" },
  { n: 2, label: "Lining up the sources", sub: "Registry, courts, news and filings" },
  { n: 3, label: "Setting the checks", sub: "Governance keywords and red-flag rules" },
] as const;

const BEAT_MS = 480;
// A short hold on the closed ring, so "Ready" registers before the walk begins.
const READY_MS = 300;
// When the run has already landed there is no wait to dress up, so the beats
// collapse to an acknowledgement. The lead-in exists to make an unavoidable
// pause feel deliberate; spending it against a backend that answered in
// milliseconds is just a slower product.
const LANDED_MS = 90;

export default function PrepCountdown({ subject, onDone, holding = false }: Props) {
  // 0..2 = counting, 3 = ring closed / "Ready".
  const [beat, setBeat] = useState(0);

  // How long the run has been waiting past the beats, so the caption can stop
  // saying the same thing at second two and second forty.
  const [heldMs, setHeldMs] = useState(0);

  useEffect(() => {
    if (beat > BEATS.length) return;
    const last = beat === BEATS.length;
    // `holding` false means the run has already landed — rush to the walk.
    const landed = !holding;
    const t = setTimeout(
      () => {
        if (last) onDone?.();
        setBeat((b) => b + 1);
      },
      landed ? LANDED_MS : last ? READY_MS : BEAT_MS,
    );
    return () => clearTimeout(t);
  }, [beat, onDone, holding]);

  useEffect(() => {
    if (!holding) {
      setHeldMs(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setHeldMs(Date.now() - started), 1000);
    return () => clearInterval(id);
  }, [holding]);

  const ready = beat >= BEATS.length;
  const current = ready ? null : BEATS[beat];

  // Ring geometry — a third closes on each count, so the ring is already moving
  // on "1" and completes as "3" lands, with the tick confirming it.
  const R = 54;
  const CIRC = 2 * Math.PI * R;
  const filled = Math.min(beat + 1, BEATS.length) / BEATS.length;

  return (
    <div className="card-surface fade-in mx-auto w-full max-w-xl p-8 text-center sm:p-10">
      <div className="eyebrow mb-6">
        {subject.type === "director" ? "Preparing the director check" : "Preparing the pre-screen"}
      </div>

      {/* The closing ring */}
      <div className="relative mx-auto h-[132px] w-[132px]">
        <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90">
          <circle cx="66" cy="66" r={R} fill="none" stroke="rgba(23,43,77,0.08)" strokeWidth="4" />
          <circle
            cx="66"
            cy="66"
            r={R}
            fill="none"
            stroke="url(#prepGrad)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - filled)}
            className="prep-ring"
          />
          <defs>
            <linearGradient id="prepGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#27457E" />
              <stop offset="55%" stopColor="#168E8E" />
              <stop offset="100%" stopColor="#E4C67C" />
            </linearGradient>
          </defs>
        </svg>

        {/* Counter — the numeral swaps per beat, then gives way to a tick */}
        <div className="absolute inset-0 flex items-center justify-center">
          {ready ? (
            holding ? (
              <span key="holding" className="flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-navy-primary [animation-delay:0ms]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-navy-primary [animation-delay:150ms]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-navy-primary [animation-delay:300ms]" />
              </span>
            ) : (
              <span key="ready" className="count-pop font-display text-[40px] leading-none text-signal-positive">
                ✓
              </span>
            )
          ) : (
            <span key={current!.n} className="count-pop tabular font-display text-[44px] leading-none text-navy-deep">
              {current!.n}
            </span>
          )}
        </div>
      </div>

      {/* Beat caption */}
      <div className="mt-6 min-h-[46px]">
        <p key={`l-${beat}-${holding}`} className="msg-swap font-display text-[17px] leading-tight text-navy-deep">
          {ready ? (holding ? "Setting things up…" : "Ready") : current!.label}
        </p>
        <p key={`s-${beat}-${holding}`} className="msg-swap mt-1 text-[12.5px] text-ink-secondary">
          {ready
            ? holding
              ? heldMs > 8000
                ? "The engine sleeps when idle — the first run after a quiet spell takes a moment to wake it. Starting now."
                : "Starting the sweep"
              : `Screening ${subject.company}`
            : current!.sub}
        </p>
      </div>

      {/* Beat pips */}
      <div className="mt-6 flex items-center justify-center gap-2">
        {BEATS.map((b, i) => {
          const reached = i <= beat;
          return (
            <span
              key={b.n}
              className="h-1.5 rounded-full transition-all duration-500"
              style={{
                width: reached ? 22 : 8,
                backgroundColor: reached ? "#27457E" : "rgba(23,43,77,0.16)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
