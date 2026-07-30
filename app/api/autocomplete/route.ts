import { NextRequest, NextResponse } from "next/server";
import { displayName, formatSuggestion, parseDirectorInput } from "@/lib/directorId";
import { resolveCandidates } from "@/lib/collectors/directors";
import { searchStocks } from "@/lib/collectors/stocks";
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

const COMPANIES = [
  "Reliance Industries",
  "Tata Consultancy Services",
  "Adani Enterprises",
  "Infosys",
  "HDFC Bank",
  "Bharti Airtel",
  "Larsen & Toubro",
  "Bajaj Finance",
  "Wipro",
  "Mahindra & Mahindra",
];

const PROMOTERS = [
  "Mukesh Ambani",
  "Gautam Adani",
  "Anand Mahindra",
  "Uday Kotak",
  "Kumar Mangalam Birla",
  "Rahul Bajaj",
  "Azim Premji",
  "N. R. Narayana Murthy",
];

/** Below this a name is too partial to spend a metered search on — "Ra" would
 *  match half the register. A DIN is exempt: it is complete as soon as it is
 *  recognisable. */
const MIN_LOOKUP_CHARS = 4;

/** A suggestion list is worth nothing if it arrives after the user has moved
 *  on. The lookup is abandoned past this — but it keeps running and lands in
 *  the shared search cache, so the next keystroke usually gets it for free. */
const LOOKUP_BUDGET_MS = 4000;

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const kind = req.nextUrl.searchParams.get("kind") === "promoter" ? "promoter" : "company";
  if (!raw) return NextResponse.json({ suggestions: [] });

  const suggestions = kind === "promoter" ? await directorSuggestions(raw) : await companySuggestions(raw);
  return NextResponse.json({ suggestions });
}

/** Wrap a bare name from the seed list as a suggestion with no extras. */
function plain(name: string): Suggestion {
  return { value: name, label: name };
}

async function companySuggestions(raw: string): Promise<Suggestion[]> {
  // The live stock search is the real source: it resolves a fragment to listed
  // entities with a ticker and a sector, which anchors the run to a company that
  // exists rather than to free text.
  try {
    const hits = await withBudget(searchStocks(raw), LOOKUP_BUDGET_MS);
    if (hits && hits.length > 0) return hits;
  } catch {
    /* fall through to the seed list */
  }

  // No token, unreachable, or nothing matched — fall back to the seed list so
  // the box never goes dead, and let whatever the user typed run regardless.
  const q = raw.toLowerCase();
  return COMPANIES.filter((n) => n.toLowerCase().includes(q)).slice(0, 6).map(plain);
}

async function directorSuggestions(raw: string): Promise<Suggestion[]> {
  const parsed = parseDirectorInput(raw);
  const worthLooking = Boolean(parsed.din) || parsed.name.length >= MIN_LOOKUP_CHARS;

  if (worthLooking) {
    const candidates = await withBudget(resolveCandidates(parsed), LOOKUP_BUDGET_MS);
    if (candidates && candidates.length > 0) {
      // The full formatted string is what the run parses the DIN back out of, so
      // it stays the value; the dropdown shows the name over its DIN and company.
      return candidates.slice(0, 6).map((c) => {
        const value = formatSuggestion(c);
        return { value, label: displayName(value), sub: subFor(value) };
      });
    }
  }

  // Nothing resolved — the registry may be unreachable, or this person simply
  // isn't in it. Fall back to the seed list so the box never goes dead, and let
  // a plain name through unchanged: the run still works, it just says honestly
  // that it couldn't confirm which person it covered.
  const q = parsed.name.toLowerCase();
  return q ? PROMOTERS.filter((n) => n.toLowerCase().includes(q)).slice(0, 6).map(plain) : [];
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
