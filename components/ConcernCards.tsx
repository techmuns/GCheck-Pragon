"use client";

import { useState } from "react";
import type { Citation } from "@/lib/types";
import type { Concern } from "@/lib/printBrief";
import { severityStyle } from "./severity";
import CitationRef, { sourceUrls } from "./CitationRef";

// ── Key Concerns, on screen ───────────────────────────────────────────────────
// Collapsed, a concern is one line to scan: what it is, how hard the claim is,
// and the single fact that says most. Opened, it is the whole record — every
// fact the source published, the source's own words, and what to ask about it.
//
// Those are two different readings at two different moments: the scan happens
// on the way into the room, the detail happens when something in the scan stops
// you. Printing everything at once served neither.
//
// The one-pager reads from the same buildConcerns, so the two surfaces cannot
// tell different stories; the difference is only that A4 has no room to expand.

export default function ConcernCards({
  concerns,
  citations,
}: {
  concerns: Concern[];
  citations: Citation[];
}) {
  const urlByRef = sourceUrls(citations);
  return (
    <ul className="space-y-2">
      {concerns.map((c, i) => (
        <ConcernCard
          key={i}
          c={c}
          url={c.sourceRef !== undefined ? urlByRef.get(c.sourceRef) : undefined}
          // The sharpest concern is already open: the reader should not have to
          // click to find out whether anything needs them.
          defaultOpen={i === 0}
        />
      ))}
    </ul>
  );
}

function ConcernCard({ c, url, defaultOpen }: { c: Concern; url?: string; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const s = severityStyle[c.severity];
  // Status says the most in the least space; failing that, lead with whatever
  // the record put first.
  const lead = c.facts.find((f) => /status/i.test(f.label)) ?? c.facts[0];

  return (
    <li className="overflow-hidden rounded-xl border" style={{ borderColor: s.border, background: s.tint }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-white/45"
      >
        <span className="mt-[7px] inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.dot }} />
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold leading-snug text-navy-deep">{c.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-secondary">
            <span className="font-semibold" style={{ color: s.ink }}>
              {c.category}
            </span>
            {lead && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {lead.label}: <span className="font-medium text-ink-primary">{lead.value}</span>
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <span className="text-ink-secondary/70">{open ? "hide detail" : "see detail"}</span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.chip}`}>
            {c.claim}
          </span>
          <span className={`text-[11px] text-ink-secondary/60 transition ${open ? "rotate-180" : ""}`} aria-hidden>
            ▾
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t bg-white/60 px-4 py-3.5" style={{ borderColor: s.border }}>
          {c.facts.length > 0 && (
            <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
              {c.facts.map((f, i) => (
                <div key={i} className="flex items-baseline gap-2 text-[12.5px]">
                  <dt className="w-[100px] shrink-0 text-ink-secondary/80">{f.label}</dt>
                  <dd className="min-w-0 flex-1 break-words font-medium text-ink-primary">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {c.evidence && (
            <p
              className="mt-3 border-l-2 pl-3 text-[12.5px] italic leading-relaxed text-ink-primary/90"
              style={{ borderColor: s.border }}
            >
              &ldquo;{c.evidence}&rdquo;
              {c.evidenceSource && <span className="not-italic text-ink-secondary"> — {c.evidenceSource}</span>}
              <CitationRef n={c.sourceRef} url={url} />
            </p>
          )}

        </div>
      )}
    </li>
  );
}
