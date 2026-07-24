"use client";

import type { SourceProgress, Subject } from "@/lib/types";

interface Props {
  subject: Subject;
  progress: SourceProgress[];
}

const STATUS_LABEL: Record<SourceProgress["status"], string> = {
  pending: "Queued",
  running: "Searching…",
  done: "Done",
  skipped: "Skipped",
  error: "Error",
};

function statusDot(status: SourceProgress["status"]): string {
  switch (status) {
    case "done":
      return "#2F855A";
    case "running":
      return "#B7791F";
    case "error":
      return "#C75D54";
    default:
      return "#94A3B8";
  }
}

// The "muscle at work" view — one line per source, ticking to done.
export default function ResearchProgress({ subject, progress }: Props) {
  return (
    <div className="card-surface fade-in w-full max-w-xl p-6 sm:p-7">
      <div className="eyebrow mb-1">Running pre-screen</div>
      <h2 className="font-display text-[22px] leading-tight text-navy-deep">{subject.company}</h2>
      {subject.promoters.length > 0 && (
        <p className="mt-0.5 text-[13px] text-ink-secondary">{subject.promoters.join(" · ")}</p>
      )}

      <ul className="mt-5 space-y-2">
        {progress.map((p) => {
          const running = p.status === "running";
          return (
            <li
              key={p.sourceId}
              className="surface-soft flex items-center justify-between px-3.5 py-2.5"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: statusDot(p.status),
                    boxShadow: running ? "0 0 0 3px rgba(183,121,31,0.14)" : "none",
                  }}
                />
                <span className="text-[14px] text-ink-primary">{p.name}</span>
                <span className="eyebrow !text-[9px] !tracking-[0.06em] rounded bg-ice px-1.5 py-0.5">
                  {p.kind === "api" ? "API" : "Browser"}
                </span>
              </div>
              <span className="tabular text-[12.5px] text-ink-secondary">
                {p.status === "done" && p.hits !== undefined ? `${p.hits} hits` : STATUS_LABEL[p.status]}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-4 text-center text-[12px] text-ink-secondary/80">
        This usually takes under a minute.
      </p>
    </div>
  );
}
