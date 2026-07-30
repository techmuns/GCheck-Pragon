"use client";

import { useState } from "react";
import type { Citation } from "@/lib/types";
import type { NewsRow, Tone } from "@/lib/printBrief";
import CitationRef, { sourceUrls } from "./CitationRef";

// ── Recent News ─────────────────────────────────────────────────────────────
// A list of headlines is a list of things that exist. This is a table, because
// the reader's question is never "what was published" — it is "what does each
// of these say, and does it concern the person I am meeting".
//
// So every row carries three things a bare headline cannot: a summary of what
// the piece actually said, and an attribution line stating whether it was read
// in full, matched on the name alone, or is coverage of one of the subject's
// companies that never names them. That last distinction is the one that keeps
// a namesake's story out of someone else's file.

const TONE_DOT: Record<Tone, string> = {
  red: "#A32C3F",
  amber: "#C08A1E",
  green: "#1E7A54",
  neutral: "#8FA0B8",
};

const INITIAL = 5;

export default function NewsTable({ rows, citations }: { rows: NewsRow[]; citations: Citation[] }) {
  const [showAll, setShowAll] = useState(false);
  const urlByRef = sourceUrls(citations);

  if (rows.length === 0) {
    return <p className="text-[13px] italic text-ink-secondary/70">No coverage found.</p>;
  }

  const shown = showAll ? rows : rows.slice(0, INITIAL);

  return (
    <div>
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[rgba(23,43,77,0.10)]">
              <th className="w-[112px] px-1 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                Date
              </th>
              <th className="px-1 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                Story
              </th>
              <th className="w-[130px] px-1 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
                Outlet
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i} className="border-b border-[rgba(23,43,77,0.06)] align-top last:border-0">
                <td className="tabular px-1 py-2.5 text-[12px] text-ink-secondary">{r.date ?? "—"}</td>
                <td className="px-1 py-2.5">
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-[6px] inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: TONE_DOT[r.tone] }}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium leading-snug text-navy-deep">
                        {r.url ? (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {r.headline}
                          </a>
                        ) : (
                          r.headline
                        )}
                        {r.sourceRef !== undefined && <CitationRef n={r.sourceRef} url={urlByRef.get(r.sourceRef)} />}
                      </p>
                      {r.summary && (
                        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-primary/85">{r.summary}</p>
                      )}
                      {r.attribution && (
                        <p className="mt-1 text-[11px] italic text-ink-secondary/80">{r.attribution}</p>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-1 py-2.5 text-[12px] text-ink-secondary">{r.outlet || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > INITIAL && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2.5 text-[12px] font-medium text-navy-primary transition hover:text-navy-deep"
        >
          {showAll ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
