"use client";

import { useEffect, useState } from "react";
import type { SourceProgress, Subject } from "@/lib/types";

interface Props {
  subject: Subject;
  progress: SourceProgress[];
}

const STATUS_LABEL: Record<SourceProgress["status"], string> = {
  pending: "Waiting",
  running: "Checking…",
  done: "Done",
  skipped: "Skipped",
  error: "Couldn’t reach",
  locked: "Upgrade",
};

function statusDot(status: SourceProgress["status"]): string {
  switch (status) {
    case "done":
      return "#2F855A";
    case "running":
      return "#B7791F";
    case "error":
      return "#C75D54";
    case "locked":
      return "#B68B3A";
    default:
      return "#C2CAD6";
  }
}

// Reassuring lines that cycle while the research runs.
const MESSAGES = [
  "Scanning news and search…",
  "Looking through court records…",
  "Cross-checking the people involved…",
  "Weighing what matters most…",
  "Writing up the brief…",
];

export default function ResearchProgress({ subject, progress }: Props) {
  const [msg, setMsg] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMsg((m) => (m + 1) % MESSAGES.length), 2600);
    return () => clearInterval(t);
  }, []);

  const done = progress.filter((p) => p.status === "done" || p.status === "locked" || p.status === "skipped" || p.status === "error").length;
  const pct = progress.length ? Math.round((done / progress.length) * 100) : 0;

  return (
    <div className="card-surface fade-in mx-auto w-full max-w-3xl p-6 sm:p-8">
      {/* Header with animated scan orb */}
      <div className="flex items-center gap-4">
        <div className="relative h-12 w-12 shrink-0">
          <div
            className="scan-orb absolute inset-0 rounded-full"
            style={{ background: "radial-gradient(circle at 35% 30%, #315AA9, #14294c)", boxShadow: "0 6px 20px rgba(23,43,77,0.28)" }}
          />
          <div className="spin absolute inset-0 rounded-full border-2 border-transparent" style={{ borderTopColor: "rgba(228,198,124,0.9)", borderRightColor: "rgba(228,198,124,0.35)" }} />
        </div>
        <div className="min-w-0">
          <div className="eyebrow mb-0.5">Running pre-screen</div>
          <h2 className="truncate font-display text-[22px] leading-tight text-navy-deep">{subject.company}</h2>
          {subject.promoters.length > 0 && (
            <p className="truncate text-[13px] text-ink-secondary">{subject.promoters.join(" · ")}</p>
          )}
        </div>
      </div>

      {/* Cycling status line */}
      <div className="mt-5 h-5">
        <p key={msg} className="msg-swap text-[13.5px] font-medium text-navy-primary">
          {MESSAGES[msg]}
        </p>
      </div>

      {/* Overall progress bar */}
      <div className="mt-2">
        <div className="bar-track h-1.5 w-full overflow-hidden rounded-full bg-soft-border">
          {pct > 0 && (
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, backgroundImage: "linear-gradient(90deg,#27457E,#168E8E)" }}
            />
          )}
        </div>
      </div>

      {/* Per-source rows */}
      <ul className="mt-5 space-y-2">
        {progress.map((p) => {
          const running = p.status === "running";
          const locked = p.status === "locked";
          const showNote = p.note && (locked || p.status === "error" || (p.status === "done" && p.hits === 0));
          return (
            <li key={p.sourceId} className={`surface-soft overflow-hidden px-3.5 py-2.5 ${running ? "shimmer" : ""}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${running ? "pulse-ring" : ""}`}
                    style={{ backgroundColor: statusDot(p.status) }}
                  />
                  <span className="text-[14px] text-ink-primary">{p.name}</span>
                </div>
                {locked ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(182,139,58,0.4)] bg-gold-soft px-2 py-0.5 text-[11px] font-semibold text-[#8A5D14]">
                    🔒 Upgrade
                  </span>
                ) : p.status === "done" ? (
                  <span className="tabular text-[12.5px] font-medium text-signal-positive">{p.hits ?? 0} found</span>
                ) : (
                  <span className="text-[12.5px] text-ink-secondary">{STATUS_LABEL[p.status]}</span>
                )}
              </div>
              {running && (
                <div className="bar-track mt-2 h-1 w-full overflow-hidden rounded-full bg-[rgba(23,43,77,0.06)]" />
              )}
              {showNote && <p className="mt-1.5 pl-[22px] text-[11.5px] leading-snug text-ink-secondary/80">{p.note}</p>}
            </li>
          );
        })}
      </ul>

      <p className="mt-5 text-center text-[12px] text-ink-secondary/80">This usually takes under a minute.</p>
    </div>
  );
}
