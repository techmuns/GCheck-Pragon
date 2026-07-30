"use client";

import { useState } from "react";
import type { Citation, RawHit } from "@/lib/types";
import { buildProfile, type ProfileMetric } from "@/lib/profileView";
import CitationRef from "./CitationRef";

// ── Profile & Background card ────────────────────────────────────────────────
// The registry snapshot answers "which legal entity is this" in a CIN. This
// answers the question a partner actually asks before a meeting: who is this,
// what do they run, and what have they done. It reads the profile the collector
// assembled from public sources (Forbes, Wikipedia, …) and lays it out the way
// the reader scans it — the role first, the headline figures as tiles, the
// placing facts inline, then the career milestones.
//
// Every value keeps the URL of the page it was read from, so each fact links to
// its own source. Nothing here is derived on the client beyond layout — the same
// `buildProfile` feeds the assembler's citations, so the card and the numbers
// behind it cannot drift.

const INITIAL_HIGHLIGHTS = 6;

export default function ProfileCard({ hits, citations }: { hits: RawHit[]; citations: Citation[] }) {
  const [showAll, setShowAll] = useState(false);
  const view = buildProfile(hits);

  // ref for a fact's own source URL — the same numbers the appendix lists.
  const refByUrl = new Map<string, number>();
  for (const c of citations) if (c.url) refByUrl.set(c.url, c.ref);
  const refFor = (url?: string) => (url ? refByUrl.get(url) : undefined);

  if (!view) {
    return <p className="text-[13px] italic text-ink-secondary/70">No public profile found.</p>;
  }

  const highlights = showAll ? view.highlights : view.highlights.slice(0, INITIAL_HIGHLIGHTS);

  return (
    <div>
      {/* Role + business, then the one-paragraph placing */}
      {view.role && (
        <p className="text-[15px] font-semibold leading-snug text-navy-deep">
          {view.role}
          {view.employer && <span className="font-medium text-ink-primary"> · {view.employer}</span>}
          <CitationRef n={refFor(view.primaryUrl)} url={view.primaryUrl} />
        </p>
      )}
      {view.bio && (
        <p className={`text-[13.5px] leading-relaxed text-ink-primary/90 ${view.role ? "mt-1.5" : ""}`}>
          {view.bio}
          {!view.role && <CitationRef n={refFor(view.primaryUrl)} url={view.primaryUrl} />}
        </p>
      )}

      {/* Headline figures — net worth, ranking, revenue… */}
      {view.metrics.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {view.metrics.map((m) => (
            <MetricTile key={m.label} metric={m} refN={refFor(m.url)} />
          ))}
        </div>
      )}

      {/* Placing facts — nationality, born, education, HQ */}
      {view.attributes.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
          {view.attributes.map((a) => (
            <div key={a.label} className="flex items-baseline gap-1.5">
              <dt className="eyebrow !text-[9px]">{a.label}</dt>
              <dd className="text-[13px] text-ink-primary">
                {a.value}
                <CitationRef n={refFor(a.url)} url={a.url} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* Career & background milestones */}
      {view.highlights.length > 0 && (
        <div className="mt-3.5 border-t border-[rgba(23,43,77,0.08)] pt-3">
          <div className="eyebrow mb-2">Career &amp; background</div>
          <ul className="space-y-1.5">
            {highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span
                  className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: "#2E6AAF" }}
                  aria-hidden
                />
                <span className="text-[13.5px] leading-relaxed text-ink-primary">
                  {h.text}
                  <CitationRef n={refFor(h.url)} url={h.url} />
                </span>
              </li>
            ))}
          </ul>
          {view.highlights.length > INITIAL_HIGHLIGHTS && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2.5 text-[12px] font-medium text-navy-primary transition hover:text-navy-deep"
            >
              {showAll ? "Show fewer" : `Show all ${view.highlights.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MetricTile({ metric, refN }: { metric: ProfileMetric; refN?: number }) {
  return (
    <div className="surface-soft px-3 py-2.5">
      <div className="text-[17px] font-semibold leading-tight text-navy-deep">
        {metric.value}
        <CitationRef n={refN} url={metric.url} />
      </div>
      <div className="eyebrow mt-1 !text-[9px]">{metric.label}</div>
    </div>
  );
}
