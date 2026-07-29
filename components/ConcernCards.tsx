"use client";

import type { Citation } from "@/lib/types";
import type { Concern } from "@/lib/printBrief";
import { severityStyle } from "./severity";

// ── Key Concerns, on screen ───────────────────────────────────────────────────
// The same specific summary the downloadable one-pager carries — the matter
// itself as the headline, the hard facts under it (who it names, which
// authority, how much, as of when), the source's own words, and a "so what"
// written from that matter's stage. Both surfaces read from buildConcerns, so
// the screen and the PDF can never tell different stories.
//
// The one difference is room: the page clamps each field to fit A4, this does
// not, so the dashboard shows the full quote and the full consequence.

export default function ConcernCards({
  concerns,
  citations,
}: {
  concerns: Concern[];
  citations: Citation[];
}) {
  const urlByRef = new Map(citations.filter((c) => c.url).map((c) => [c.ref, c.url as string]));
  return (
    <ul className="space-y-2.5">
      {concerns.map((c, i) => (
        <ConcernCard c={c} url={c.sourceRef !== undefined ? urlByRef.get(c.sourceRef) : undefined} key={i} />
      ))}
    </ul>
  );
}

function ConcernCard({ c, url }: { c: Concern; url?: string }) {
  const s = severityStyle[c.severity];
  return (
    <li className="surface-soft p-3.5" style={{ borderLeft: `3px solid ${s.dot}` }}>
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-[14.5px] font-semibold leading-snug text-navy-deep">{c.title}</h4>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${s.chip}`}>
          {c.claim}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.chip}`}>
          {c.category}
        </span>
        {c.facts.map((f, i) => (
          <span key={i} className="text-[12.5px] text-ink-primary">
            <span className="eyebrow !text-[9.5px]">{f.label}</span> {f.value}
          </span>
        ))}
      </div>

      {c.evidence && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-secondary">
          &ldquo;{c.evidence}&rdquo;
          {c.evidenceSource && <span className="italic text-ink-secondary/80"> — {c.evidenceSource}</span>}
          <Ref n={c.sourceRef} url={url} />
        </p>
      )}

      <p className="mt-2 border-t border-dotted border-[rgba(23,43,77,0.14)] pt-2 text-[12.5px] leading-relaxed text-ink-secondary">
        <span className="eyebrow !text-[9.5px]">So what</span> {c.whyItMatters}
      </p>
    </li>
  );
}

/** Citation number — a live link to the source wherever one exists, matching
 *  the exported PDF, so neither surface makes a reader hunt the appendix. */
function Ref({ n, url }: { n?: number; url?: string }) {
  if (n === undefined) return null;
  if (!url) return <sup className="ml-0.5 text-[11px] font-semibold text-navy-primary/70">[{n}]</sup>;
  return (
    <sup className="ml-0.5 text-[11px] font-semibold">
      <a href={url} target="_blank" rel="noreferrer" className="text-royal underline-offset-2 hover:underline">
        [{n}]
      </a>
    </sup>
  );
}
