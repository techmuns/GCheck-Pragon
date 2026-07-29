"use client";

import type { Citation } from "@/lib/types";

// ── Citation numbers ────────────────────────────────────────────────────────
// A [n] in the text is the only thing standing between a claim and the record
// behind it, so it is a live link wherever the source has a URL — on screen and
// in the exported PDF alike. A reader following a finding should land on the
// source itself, never on a number they then have to hunt down the appendix.
//
// Every surface renders its numbers through this one component, so a citation
// can never be clickable in one place and inert in another.

/** ref → URL for every citation that has one. */
export function sourceUrls(citations: Citation[]): Map<number, string> {
  return new Map(citations.filter((c) => c.url).map((c) => [c.ref, c.url as string]));
}

export default function CitationRef({ n, url }: { n?: number; url?: string }) {
  if (n === undefined) return null;
  // No URL means no link — a fake one would be worse than a plain number.
  if (!url) return <sup className="ml-0.5 text-[11px] font-semibold text-navy-primary/70">[{n}]</sup>;
  return (
    <sup className="ml-0.5 text-[11px] font-semibold">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={url}
        className="text-royal underline-offset-2 hover:underline"
      >
        [{n}]
      </a>
    </sup>
  );
}
