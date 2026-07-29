import { NextRequest, NextResponse } from "next/server";
import { formatSuggestion, parseDirectorInput } from "@/lib/directorId";
import { resolveCandidates } from "@/lib/collectors/directors";

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
// Companies keep the illustrative seed list; wiring them to a real source is a
// separate job.

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

  if (kind === "promoter") {
    return NextResponse.json({ suggestions: await directorSuggestions(raw) });
  }

  const q = raw.toLowerCase();
  return NextResponse.json({ suggestions: COMPANIES.filter((n) => n.toLowerCase().includes(q)).slice(0, 6) });
}

async function directorSuggestions(raw: string): Promise<string[]> {
  const parsed = parseDirectorInput(raw);
  const worthLooking = Boolean(parsed.din) || parsed.name.length >= MIN_LOOKUP_CHARS;

  if (worthLooking) {
    const candidates = await withBudget(resolveCandidates(parsed), LOOKUP_BUDGET_MS);
    if (candidates && candidates.length > 0) {
      return candidates.slice(0, 6).map(formatSuggestion);
    }
  }

  // Nothing resolved — the registry may be unreachable, or this person simply
  // isn't in it. Fall back to the seed list so the box never goes dead, and let
  // a plain name through unchanged: the run still works, it just says honestly
  // that it couldn't confirm which person it covered.
  const q = parsed.name.toLowerCase();
  return q ? PROMOTERS.filter((n) => n.toLowerCase().includes(q)).slice(0, 6) : [];
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
