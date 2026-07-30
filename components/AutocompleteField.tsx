"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";
import type { Suggestion } from "@/lib/types";

interface Props {
  kind: "company" | "promoter";
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  /** Fired when a dropdown row is picked, carrying its extras (a company's
   *  ticker) so the caller can use more than the plain text. */
  onSelect?: (s: Suggestion) => void;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
}

// A clean, single-purpose autocomplete input. Suggestions come from
// /api/autocomplete as structured rows — a primary line and a quiet second line
// (a company's sector · country, or a director's DIN · company) — so a name is
// something the reader can tell apart from its namesakes before they pick it.
export default function AutocompleteField({
  kind,
  value,
  onChange,
  onCommit,
  onSelect,
  placeholder,
  label,
  autoFocus,
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // A live lookup against a metered backend, not a local filter — so the pause
    // before firing is longer than a pure-UI debounce would need. Same feel to
    // type against; far fewer calls.
    const t = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/autocomplete?kind=${kind}&q=${encodeURIComponent(q)}`));
        const data = await res.json();
        if (!cancelled) {
          setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
          setActive(-1);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value, kind]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(s: Suggestion) {
    onChange(s.value);
    setOpen(false);
    setSuggestions([]);
    onSelect?.(s);
    onCommit?.(s.value);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) {
      if (e.key === "Enter") onCommit?.(value);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0) choose(suggestions[active]);
      else onCommit?.(value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && suggestions.length > 0;

  return (
    <div ref={boxRef} className="relative">
      <label className="eyebrow mb-1.5 block">{label}</label>
      <div className="relative">
        <input
          type="text"
          value={value}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full rounded-xl border border-[rgba(23,43,77,0.14)] bg-white px-4 py-3 text-[15px] text-ink-primary placeholder:text-ink-secondary/55 outline-none transition focus:border-navy-primary/45 focus:ring-2 focus:ring-navy-primary/12"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showList}
          aria-controls="ac-list"
          aria-autocomplete="list"
        />
        {loading && value.trim() && (
          <span
            className="pointer-events-none absolute right-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-navy-primary/25 border-t-navy-primary/70"
            aria-hidden
          />
        )}
      </div>
      {showList && (
        <ul id="ac-list" className="card-surface fade-in absolute z-20 mt-1.5 w-full overflow-hidden p-1" role="listbox">
          {suggestions.map((s, i) => (
            <li key={`${s.value}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                  i === active ? "bg-navy-primary/8" : "hover:bg-ice"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-navy-deep">{s.label}</span>
                  {s.sub && <span className="mt-0.5 block truncate text-[12px] text-ink-secondary">{s.sub}</span>}
                </span>
                {s.ticker && (
                  <span className="shrink-0 rounded bg-navy-primary/8 px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide text-navy-primary">
                    {s.ticker}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
