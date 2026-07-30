import { NextRequest, NextResponse } from "next/server";
import { displayName, formatSuggestion, parseDirectorInput } from "@/lib/directorId";
import { resolveCandidates } from "@/lib/collectors/directors";
import { searchStocks } from "@/lib/collectors/stocks";
import { SEED_COMPANIES, SEED_DIRECTORS, matchLocal } from "@/lib/seedEntities";
import type { Suggestion } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/autocomplete?q=&kind=company|promoter
//
// For a person (kind=promoter) this endpoint is the whole disambiguation story.
// A name is not an identity — three registered directors can share "Rajesh
// Kumar" — so the suggestions carry each candidate's DIN and one of their
// companies beside the name:
//
//   Mukesh Dhirubhai Ambani · DIN 00001695 · Reliance Industries
//   Mukesh Kumar Ambani · DIN 07123456 · Ambani Textiles Private Limited
//
// The user picks the person they meant — they can tell them apart because the
// company is there — and the DIN rides back through the same single field. No
// new input, no new screen, and the reader never has to know what a DIN is.
// Typing a DIN directly works too: it resolves to the one person it belongs to.
//
// Companies now resolve against the live stock search (a real ticker + sector),
// with the seed list kept only as the offline fallback when the token is absent
// or the endpoint is unreachable — so the box never goes dead.

/** Below this a name is too partial to spend a metered search on — "Ra" would
 *  match half the register. A DIN is exempt: it is complete as soon as it is
 *  recognisable. */
const MIN_LOOKUP_CHARS = 4;

/**
 * How long a live lookup may hold the response.
 *
 * This used to be four seconds, which is not a budget so much as a promise that
 * the field will feel broken: the box spun for four seconds per keystroke
 * whenever the upstream was slow, and did it again on the very next letter. The
 * local index already has an answer ready, so the live call gets only as long as
 * a person will not notice — and when it misses, its result still lands in the
 * shared cache and is there instantly for the next keystroke.
 */
const LOOKUP_BUDGET_MS = 900;
/** Directors have no local index worth the name, so their lookup is allowed a
 *  little longer before falling back. */
const DIRECTOR_BUDGET_MS = 2500;

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const kind = req.nextUrl.searchParams.get("kind") === "promoter" ? "promoter" : "company";
  if (!raw) return NextResponse.json({ suggestions: [] });

  const suggestions = kind === "promoter" ? await directorSuggestions(raw) : await companySuggestions(raw);
  // A typed prefix repeats constantly as the user backspaces and retypes. The
  // client caches too; this makes the browser's own reuse free as well.
  return NextResponse.json(
    { suggestions },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}

/**
 * Companies: the local index answers, the live search improves it.
 *
 * The order matters. Previously the live call was the source and the seed list
 * the fallback, so a slow or dead upstream meant no suggestions until it timed
 * out. Now there is always an answer in hand and the network only ever adds to
 * it — the ticker and sector of a real listed entity, ranked first because that
 * is the better anchor for a run. Nothing here can fail: `searchStocks` is
 * already budgeted, breaker-guarded and cached, and its rejection is swallowed.
 */
async function companySuggestions(raw: string): Promise<Suggestion[]> {
  const local = matchLocal(SEED_COMPANIES, raw);
  const live = await withBudget(searchStocks(raw), LOOKUP_BUDGET_MS);
  if (!live || live.length === 0) return local;
  return mergeSuggestions(live, local);
}

/** Live results first, then any local match the live list didn't already name.
 *  Deduped on the normalised name so one company never appears twice. */
function mergeSuggestions(live: Suggestion[], local: Suggestion[], limit = 8): Suggestion[] {
  const key = (s: Suggestion) => s.value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const seen = new Set(live.map(key));
  const out = [...live];
  for (const s of local) {
    if (out.length >= limit) break;
    if (seen.has(key(s))) continue;
    seen.add(key(s));
    out.push(s);
  }
  return out.slice(0, limit);
}

async function directorSuggestions(raw: string): Promise<Suggestion[]> {
  const parsed = parseDirectorInput(raw);
  const local = matchLocal(SEED_DIRECTORS, parsed.name);
  const worthLooking = Boolean(parsed.din) || parsed.name.length >= MIN_LOOKUP_CHARS;

  if (worthLooking) {
    const candidates = await withBudget(resolveCandidates(parsed), DIRECTOR_BUDGET_MS);
    if (candidates && candidates.length > 0) {
      // The full formatted string is what the run parses the DIN back out of, so
      // it stays the value; the dropdown shows the name over its DIN and company.
      const resolved = candidates.slice(0, 6).map((c) => {
        const value = formatSuggestion(c);
        return { value, label: displayName(value), sub: subFor(value) };
      });
      // A resolved candidate carries a DIN and outranks a bare name, but a
      // well-known figure the registry search missed is still worth offering.
      return mergeSuggestions(resolved, local);
    }
  }

  // Nothing resolved — the registry may be unreachable, or this person simply
  // isn't in it. Fall back to the local index so the box never goes dead, and
  // let a plain name through unchanged: the run still works, it just says
  // honestly that it couldn't confirm which person it covered.
  return local;
}

/** The part of a formatted director suggestion after the name — "DIN … · Co". */
function subFor(formatted: string): string | undefined {
  const rest = formatted.split("·").slice(1).map((s) => s.trim()).filter(Boolean);
  return rest.length > 0 ? rest.join(" · ") : undefined;
}

/** The value if it arrives in time, else null. Never rejects — a suggestion
 *  list that failed and one that was slow are the same thing to the caller. */
async function withBudget<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([work.catch(() => null), budget]);
  } finally {
    clearTimeout(timer);
  }
}
