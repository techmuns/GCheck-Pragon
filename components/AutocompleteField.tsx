"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl } from "@/lib/api";

interface Props {
  kind: "company" | "promoter";
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
}

// A clean, single-purpose autocomplete input. Suggestions come from
// /api/autocomplete; keyboard-navigable, dismisses on blur/escape.
export default function AutocompleteField({
  kind,
  value,
  onChange,
  onCommit,
  placeholder,
  label,
  autoFocus,
}: Props) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    // Director suggestions are a live registry lookup against a metered search
    // backend, not a local filter — so the pause before firing is longer than a
    // pure-UI debounce would need. Same feel to type against; far fewer calls.
    const t = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/autocomplete?kind=${kind}&q=${encodeURIComponent(q)}`));
        const data = await res.json();
        if (!cancelled) {
          setSuggestions(data.suggestions ?? []);
          setActive(-1);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 350);
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

  function choose(v: string) {
    onChange(v);
    setOpen(false);
    setSuggestions([]);
    onCommit?.(v);
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
        className="w-full rounded-xl border border-[rgba(23,43,77,0.14)] bg-white/90 px-4 py-3 text-[15px] text-ink-primary placeholder:text-ink-secondary/60 shadow-soft outline-none transition focus:border-navy-primary/40 focus:ring-2 focus:ring-navy-primary/15"
        autoComplete="off"
        spellCheck={false}
      />
      {showList && (
        <ul className="card-surface fade-in absolute z-20 mt-1.5 w-full overflow-hidden p-1">
          {suggestions.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={`w-full rounded-lg px-3 py-2 text-left text-[14px] transition ${
                  i === active ? "bg-navy-primary/8 text-navy-deep" : "text-ink-primary hover:bg-ice"
                }`}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
