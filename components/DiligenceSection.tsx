"use client";

import { useState } from "react";
import type { DiligenceFinding, PersonDiligence, Severity } from "@/lib/types";
import { severityStyle } from "./severity";

// ── Board Diligence ──────────────────────────────────────────────────────────
// The per-director deep dive, streamed live: each board member is put through
// their own pre-screen — keyed to their DIN — and their verdict lands here as it
// completes, so the board fills in one card at a time rather than after a long
// blank wait. A card carries the person's verdict, a one-line reading, the items
// found for them (each linking to its source), and the other companies the
// register ties them to.

const VERDICT_LABEL: Record<Severity, string> = {
  red: "Red flag",
  amber: "Review",
  clear: "Clear",
  info: "Unresolved",
};

export default function DiligenceSection({ people, running }: { people: PersonDiligence[]; running: boolean }) {
  const total = people.length;
  const done = people.filter((p) => p.status === "done" || p.status === "error").length;
  const red = people.filter((p) => p.verdict === "red").length;
  const amber = people.filter((p) => p.verdict === "amber").length;
  const stillChecking = running && done < total;

  return (
    <div className="card-surface fade-in mb-3 p-5" data-diligence-root>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1.5">
        <div>
          <h3 className="font-display text-[15.5px] text-navy-deep">Board Diligence</h3>
          <p className="text-[12px] text-ink-secondary">
            Every director run through their own deep pre-screen, checked by DIN — not by name.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[12.5px]">
          {red > 0 && <Tally n={red} label={red === 1 ? "red flag" : "red flags"} color={severityStyle.red.dot} />}
          {amber > 0 && <Tally n={amber} label="to review" color={severityStyle.amber.dot} />}
          <span className="tabular font-semibold text-ink-secondary">
            {done}/{total} checked
          </span>
        </div>
      </div>

      {stillChecking && (
        <div className="mb-3 h-1 w-full overflow-hidden rounded-full bg-soft-border" aria-hidden>
          <div
            className="h-full rounded-full"
            style={{ width: `${total ? (done / total) * 100 : 0}%`, background: "#27457E", transition: "width 400ms ease" }}
          />
        </div>
      )}

      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {people.map((p) => (
          <li key={p.id}>
            <PersonCard p={p} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tally({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      <span className="tabular font-semibold text-ink-primary">{n}</span>
      <span className="text-ink-secondary">{label}</span>
    </span>
  );
}

function PersonCard({ p }: { p: PersonDiligence }) {
  const [open, setOpen] = useState(false);
  const busy = p.status === "pending" || p.status === "running";
  const v = p.verdict ?? "info";
  const dot = busy ? "#94A3B8" : severityStyle[v].dot;
  const extraConcerns = Math.max(0, p.concerns.length - 2);
  const canExpand = extraConcerns > 0 || p.otherDirectorships.length > 0;
  const meta = [p.role, p.din ? `DIN ${p.din}` : null, p.tenure ? `${p.tenure} tenure` : null].filter(Boolean).join(" · ");

  return (
    <div
      className="h-full rounded-xl border border-[rgba(23,43,77,0.08)] bg-white p-3.5"
      style={{ borderLeft: `3px solid ${dot}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-[13.5px] font-semibold leading-tight text-navy-deep">{p.name}</span>
          {meta && <span className="mt-0.5 block text-[11px] leading-tight text-ink-secondary">{meta}</span>}
        </div>
        <VerdictChip p={p} />
      </div>

      {p.status === "error" ? (
        <p className="mt-2 text-[12px] italic text-ink-secondary/80">{p.note ?? "Couldn’t complete this check."}</p>
      ) : busy ? (
        <p className="mt-2 text-[12px] italic text-ink-secondary/70">Checking…</p>
      ) : (
        <>
          {p.headline && <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-primary">{p.headline}</p>}

          {p.concerns.length > 0 && (
            <ul className="mt-2 space-y-1">
              {(open ? p.concerns : p.concerns.slice(0, 2)).map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed">
                  <span
                    className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: severityStyle[f.severity].dot }}
                    aria-hidden
                  />
                  <span className="text-ink-primary">
                    {f.text}
                    <SourceLink f={f} />
                  </span>
                </li>
              ))}
            </ul>
          )}

          {open && p.otherDirectorships.length > 0 && (
            <div className="mt-2.5 border-t border-[rgba(23,43,77,0.06)] pt-2">
              <div className="eyebrow mb-1 !text-[9px]">Also linked to</div>
              <ul className="space-y-0.5">
                {p.otherDirectorships.map((f, i) => (
                  <li key={i} className="text-[11.5px] leading-relaxed text-ink-secondary">
                    {f.text}
                    <SourceLink f={f} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {open && p.note && <p className="mt-2 text-[11px] italic text-ink-secondary/70">{p.note}</p>}

          {canExpand && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="mt-2 text-[11.5px] font-medium text-navy-primary transition hover:text-navy-deep"
            >
              {open
                ? "Show less"
                : extraConcerns > 0
                  ? `+${extraConcerns} more · details`
                  : "Show details"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function VerdictChip({ p }: { p: PersonDiligence }) {
  if (p.status === "pending" || p.status === "running") {
    return (
      <span className="shrink-0 rounded-full bg-ice px-2 py-0.5 text-[10px] font-semibold text-ink-secondary">
        checking…
      </span>
    );
  }
  if (p.status === "error") {
    return <span className="shrink-0 rounded-full bg-ice px-2 py-0.5 text-[10px] font-semibold text-ink-secondary">n/a</span>;
  }
  const v = p.verdict ?? "info";
  const s = severityStyle[v];
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ background: s.tint, color: s.ink, border: `1px solid ${s.border}` }}
    >
      {VERDICT_LABEL[v]}
    </span>
  );
}

function SourceLink({ f }: { f: DiligenceFinding }) {
  if (!f.url) return null;
  return (
    <a
      href={f.url}
      target="_blank"
      rel="noreferrer"
      title={f.url}
      className="ml-1 align-super text-[10px] font-semibold text-royal no-underline hover:underline"
    >
      ↗
    </a>
  );
}
