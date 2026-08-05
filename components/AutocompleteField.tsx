"use client";

import { useEffect, useRef, useState } from "react";
import { apiUrl, authHeaders } from "@/lib/api";
import { useHostContext } from "@/hooks/useHostContext";
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
//
// The field is built so that typing never waits on the network: an answer
// already in the session cache is shown outright, a shorter prefix's answer is
// narrowed locally to stand in until the real one lands, superseded requests are
// aborted, and only the newest response may write to the list.

/** Short, because a keystroke now costs nothing when the answer is cached and is
 *  aborted the moment the next one arrives. */
const DEBOUNCE_MS = 160;

/** Flattened form for local narrowing — matches the server's own matcher. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[.,&'"()-]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * A provisional list for a query we have not asked about yet, taken from the
 * longest already-answered prefix of it and filtered to what still matches.
 *
 * Only ever a stand-in: it cannot invent a row the server never sent, and it is
 * replaced by the authoritative answer as soon as that arrives. Returns null
 * when there is nothing to narrow, so the caller can tell "no provisional" from
 * "provisionally empty".
 */
function narrowFromPrefix(
  cache: Map<string, Suggestion[]>,
  kind: string,
  q: string,
): Suggestion[] | null {
  const lower = q.toLowerCase();
  for (let cut = lower.length - 1; cut >= 2; cut--) {
    const prior = cache.get(`${kind}:${lower.slice(0, cut)}`);
    if (!prior) continue;
    const needle = norm(q);
    const narrowed = prior.filter((s) => norm(`${s.label} ${s.value}`).includes(needle));
    return narrowed;
  }
  return null;
}
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

  // Everything this session has already looked up, keyed by kind + query. A
  // typeahead re-asks the same prefixes constantly — backspace one letter and
  // you are back on a query answered a second ago — and paying a round trip for
  // an answer already in hand is most of what makes a field feel slow.
  const cache = useRef<Map<string, Suggestion[]>>(new Map());
  // Only the newest request may write to state. Without this a slow early
  // response can land after a fast later one and overwrite the right list with
  // a stale one — the classic typeahead flicker.
  const seq = useRef(0);
  const inflight = useRef<AbortController | null>(null);
  // Picking a row sets the value, which would otherwise fire a fresh lookup for
  // the exact text we just resolved.
  const skipNext = useRef(false);
  // The live stock search behind the company box authenticates with the host's
  // session token. Held in a ref so a session refresh does not re-run the
  // lookup effect and re-query the text the user has already stopped typing.
  const { session } = useHostContext();
  const tokenRef = useRef<string | null>(null);
  useEffect(() => {
    tokenRef.current = session.token;
  }, [session.token]);

  useEffect(() => {
    const q = value.trim();
    if (skipNext.current) {
      skipNext.current = false;
      return;
    }
    if (!q) {
      inflight.current?.abort();
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const key = `${kind}:${q.toLowerCase()}`;

    // Already answered — show it and spend nothing.
    const hit = cache.current.get(key);
    if (hit) {
      setSuggestions(hit);
      setActive(-1);
      setLoading(false);
      return;
    }

    // Nothing exact, but a shorter prefix may already be answered. Narrowing it
    // locally gives the user a correct-looking list on the very keystroke rather
    // than an empty box, and the authoritative answer replaces it a moment later.
    const provisional = narrowFromPrefix(cache.current, kind, q);
    if (provisional) {
      setSuggestions(provisional);
      setActive(-1);
    }
    setLoading(true);

    const mine = ++seq.current;
    const t = setTimeout(async () => {
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      try {
        const res = await fetch(apiUrl(`/api/autocomplete?kind=${kind}&q=${encodeURIComponent(q)}`), {
          headers: authHeaders(tokenRef.current),
          signal: controller.signal,
        });
        const data = await res.json();
        const list: Suggestion[] = Array.isArray(data.suggestions) ? data.suggestions : [];
        cache.current.set(key, list);
        // Bound the map — a long session of typing would otherwise grow it
        // without limit. Insertion order is Map's iteration order, so the first
        // key is the coldest.
        if (cache.current.size > 200) {
          const oldest = cache.current.keys().next();
          if (!oldest.done) cache.current.delete(oldest.value);
        }
        if (mine === seq.current) {
          setSuggestions(list);
          setActive(-1);
        }
      } catch {
        // An abort is the expected path when the user keeps typing, and a
        // failure should never wipe a provisional list that is still useful.
        if (mine === seq.current && !provisional) setSuggestions([]);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(t);
  }, [value, kind]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(s: Suggestion) {
    // The value is about to become the row we just resolved; looking it up again
    // would spend a call to be told what the user has already picked.
    skipNext.current = true;
    inflight.current?.abort();
    seq.current += 1;
    onChange(s.value);
    setOpen(false);
    setSuggestions([]);
    setLoading(false);
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
        {/* Only when there is genuinely nothing on screen yet. A spinner over a
            list the user is already reading says "wait" about an answer that has
            arrived, which is what made the field feel slower than it was. */}
        {loading && value.trim() && suggestions.length === 0 && (
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
