"use client";

import { useState } from "react";
import type { DiligenceFinding, PersonDiligence, Severity } from "@/lib/types";
import { severityStyle } from "./severity";
import { diligenceStats } from "@/lib/verdict";

// ── Board diligence ──────────────────────────────────────────────────────────
// One card per director, each carrying their own verdict, the items found for
// them, and the companies the register ties them to. Content only — the page
// supplies the heading and the frame.
//
// Density is the point here. A board of ten was producing ten tall cards each
// dominated by a long "also linked to" list, which buried the one director who
// actually had something against them. So the companies list is collapsed by
// default, findings are capped until expanded, and the verdict is legible from
// the card's edge colour before a word is read.

const VERDICT_LABEL: Record<Severity, string> = {
  red: "Red flag",
  amber: "Review",
  clear: "Clear",
  info: "Unresolved",
};

// The board tally lives in lib/verdict.ts, beside the verdict it feeds — two
// counters is how the brief and the rail came to print different numbers for
// the same board. Re-exported here so existing importers keep working.
export { diligenceStats };

export default function DiligenceGrid({ people, running }: { people: PersonDiligence[]; running: boolean }) {
  const { total, done } = diligenceStats(people);
  // A director carrying something outranks one who came back clean: on a long
  // board the reader should meet the problem first, not scroll for it.
  const rank = (p: PersonDiligence) => (p.verdict === "red" ? 0 : p.verdict === "amber" ? 1 : p.status === "error" ? 3 : 2);
  const ordered = [...people].sort((a, b) => rank(a) - rank(b));

  return (
    <div>
      {running && done < total && (
        <div className="mb-3 h-0.5 w-full overflow-hidden rounded-full bg-[rgba(23,43,77,0.08)]" aria-hidden>
          <div
            className="h-full rounded-full bg-navy-primary"
            style={{ width: `${total ? (done / total) * 100 : 0}%`, transition: "width 400ms var(--ease)" }}
          />
        </div>
      )}
      <ul className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        {ordered.map((p) => (
          <li key={p.id}>
            <PersonCard p={p} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PersonCard({ p }: { p: PersonDiligence }) {
  const [open, setOpen] = useState(false);
  const busy = p.status === "pending" || p.status === "running";
  const v = p.verdict ?? "info";
  const edge = busy || p.status === "error" ? "#CBD5E1" : severityStyle[v].dot;

  const VISIBLE = 2;
  const hiddenConcerns = Math.max(0, p.concerns.length - VISIBLE);
  const companies = p.companies ?? [];
  const canExpand = hiddenConcerns > 0 || companies.length > 0;

  const meta = [p.role, p.din ? `DIN ${p.din}` : null, p.tenure].filter(Boolean).join(" · ");

  return (
    <div
      className="flex h-full flex-col rounded-lg border border-[rgba(23,43,77,0.09)] bg-white p-3.5"
      style={{ borderLeft: `2.5px solid ${edge}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-[13.5px] font-semibold leading-snug text-navy-deep">{p.name}</span>
          {meta && <span className="mt-0.5 block text-[11px] leading-snug text-ink-secondary">{meta}</span>}
        </div>
        <VerdictChip p={p} />
      </div>

      {p.status === "error" ? (
        <p className="mt-2 text-[12px] italic leading-snug text-ink-secondary/80">
          {p.note ?? "Couldn’t complete this check."}
        </p>
      ) : busy ? (
        <p className="mt-2 text-[12px] italic text-ink-secondary/70">Checking…</p>
      ) : (
        <>
          {p.concerns.length === 0 && p.headline && (
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-secondary">{p.headline}</p>
          )}

          {p.concerns.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {(open ? p.concerns : p.concerns.slice(0, VISIBLE)).map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed">
                  <span
                    className="mt-[7px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
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

          {open && companies.length > 0 && (
            <div className="mt-2.5 border-t border-[rgba(23,43,77,0.07)] pt-2">
              <div className="eyebrow mb-1 !text-[9px]">Also on the board of</div>
              <p className="text-[11.5px] leading-relaxed text-ink-secondary">
                {companies.map((c) => c.name).join(" · ")}
              </p>
            </div>
          )}

          {open && p.note && <p className="mt-2 text-[11px] italic text-ink-secondary/70">{p.note}</p>}

          {canExpand && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="no-print mt-auto pt-2 text-left text-[11.5px] font-medium text-navy-primary underline-offset-2 transition hover:underline"
            >
              {open
                ? "Show less"
                : hiddenConcerns > 0
                  ? `+${hiddenConcerns} more · ${companies.length} companies`
                  : `${companies.length} other ${companies.length === 1 ? "company" : "companies"}`}
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
      <span className="shrink-0 rounded-full bg-ice px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink-secondary">
        checking
      </span>
    );
  }
  if (p.status === "error") {
    return (
      <span className="shrink-0 rounded-full bg-ice px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink-secondary">
        n/a
      </span>
    );
  }
  const v = p.verdict ?? "info";
  const s = severityStyle[v];
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.07em]"
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
      className="ml-1 align-super text-[9.5px] font-semibold text-royal no-underline hover:underline"
    >
      ↗
    </a>
  );
}
