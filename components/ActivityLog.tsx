"use client";

import { useEffect, useRef, useState } from "react";
import type { RunEvent, RunEventLevel } from "@/lib/types";

// ── The run, as it happens ──────────────────────────────────────────────────
// A pre-screen that takes minutes and shows six status words is asking to be
// trusted rather than read. This is the other half of the bargain: every query
// issued, every page opened, every cache reuse and every skip, with the reason,
// in the order it happened. If the brief later says a source found nothing, the
// reader can see exactly what was asked.

interface Props {
  events: RunEvent[];
  /** Collapsed by default once the run is over — during it, the log is the point. */
  defaultOpen?: boolean;
}

const GLYPH: Record<RunEventLevel, string> = {
  step: "•",
  query: "→",
  fetch: "↓",
  cache: "≡",
  skip: "–",
  warn: "!",
};

const COLOUR: Record<RunEventLevel, string> = {
  step: "#27457E",
  query: "#168E8E",
  fetch: "#5A6C8C",
  cache: "#9AA6B6",
  skip: "#B68B3A",
  warn: "#C75D54",
};

export default function ActivityLog({ events, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const listRef = useRef<HTMLOListElement>(null);
  // Whether the reader is still at the bottom. A log that yanks you back down
  // while you are reading a line is worse than one that does not scroll at all,
  // so it only follows when you have not scrolled away.
  const pinned = useRef(true);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !open || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [events, open]);

  if (events.length === 0) return null;

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  return (
    <div className="mt-5 rounded-xl border border-[rgba(23,43,77,0.08)] bg-white/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3.5 py-2 text-left"
        aria-expanded={open}
      >
        <span className="eyebrow">Activity · {events.length} steps</span>
        <span className="text-[12px] text-ink-secondary" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <ol
          ref={listRef}
          onScroll={onScroll}
          className="max-h-64 space-y-0.5 overflow-y-auto border-t border-[rgba(23,43,77,0.06)] px-3.5 py-2"
        >
          {events.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-[11.5px] leading-relaxed">
              <span className="tabular shrink-0 text-ink-secondary/60">{clock(e.at)}</span>
              <span className="shrink-0 font-semibold" style={{ color: COLOUR[e.level] ?? COLOUR.step }} aria-hidden>
                {GLYPH[e.level] ?? GLYPH.step}
              </span>
              <span className="min-w-0 text-ink-primary/90">
                {e.text}
                {e.url && <span className="ml-1.5 text-ink-secondary/70">{hostOf(e.url)}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString(undefined, { hour12: false });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
