import type { PersonDiligence, Run } from "./types";

// ── Board relationship network ───────────────────────────────────────────────
// A board is rarely a set of strangers. When several directors also sit together
// on ANOTHER company, that company is a related-party channel — the vehicle
// through which value can move between people who are supposed to be checking
// each other. Institutional diligence asks "who is connected to whom, and
// through what", and the board diligence already gathered the raw material: each
// director's own registry company list. This turns those lists into the shared
// edges between them.
//
// This is interlock analysis, not beneficial ownership: it says who sits with
// whom, not who owns what. Shareholding and ultimate beneficial ownership need
// the paid registry (PrivateCircle) and are surfaced as a coverage gap until it
// is unlocked, rather than guessed at.

const ADVERSE_STATUS = /strike|struck|liquidat|dissolv|defunct|amalgamat|dormant/i;

export interface Interlock {
  /** The shared company, in its most complete spelling. */
  company: string;
  status?: string;
  /** Board members who both sit on it. */
  directors: string[];
  /** The company itself is not in good standing on the register. */
  flagged: boolean;
}

export interface NetworkView {
  interlocks: Interlock[];
  boardSize: number;
  /** Directors whose registry company list we actually resolved. */
  withRecord: number;
  /** True once shareholding/UBO would need the paid registry to go further. */
  ownershipGated: boolean;
}

function normKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'"()-]/g, " ")
    .replace(/\b(private|limited|ltd|pvt|llp|company|co|corporation|inc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The interlocks across a company's board.
 *
 * Company mode only, and only once the board has been screened — the shared
 * companies come from each director's own record. The subject company itself is
 * excluded: every director sharing it is the definition of a board, not a
 * finding.
 */
export function buildNetwork(run: Run): NetworkView | null {
  if (run.subject.type === "director") return null;
  const people = run.diligence ?? [];
  if (people.length === 0) return null;

  const subjectKey = normKey(run.subject.company);

  interface Agg {
    display: string;
    status?: string;
    directors: Set<string>;
    flagged: boolean;
  }
  const byCompany = new Map<string, Agg>();
  let withRecord = 0;

  for (const p of people) {
    const companies = uniqueByKey(p.companies ?? []);
    if (companies.length > 0) withRecord += 1;
    for (const c of companies) {
      const key = normKey(c.name);
      if (!key || key === subjectKey) continue;
      const existing = byCompany.get(key);
      const flagged = Boolean(c.status && ADVERSE_STATUS.test(c.status));
      if (!existing) {
        byCompany.set(key, { display: c.name, status: c.status, directors: new Set([p.name]), flagged });
      } else {
        existing.directors.add(p.name);
        // Keep the longer, more complete spelling; keep any adverse status.
        if (c.name.length > existing.display.length) existing.display = c.name;
        if (flagged) {
          existing.flagged = true;
          existing.status = c.status;
        }
      }
    }
  }

  const interlocks: Interlock[] = [...byCompany.values()]
    .filter((a) => a.directors.size >= 2)
    .map((a) => ({ company: a.display, status: a.status, directors: [...a.directors], flagged: a.flagged }))
    // Most-connected first; a flagged shared company outranks a clean one at the
    // same degree, because that is the one worth opening.
    .sort((x, y) => y.directors.length - x.directors.length || Number(y.flagged) - Number(x.flagged))
    .slice(0, 12);

  return {
    interlocks,
    boardSize: people.length,
    withRecord,
    ownershipGated: true,
  };
}

/** Distinct companies within one person's list, keyed on the normalised name. */
function uniqueByKey(companies: Array<{ name: string; status?: string }>): Array<{ name: string; status?: string }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; status?: string }> = [];
  for (const c of companies) {
    const k = normKey(c.name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Count of board members carrying a red or amber verdict — used by the score. */
export function boardFlagCounts(people: PersonDiligence[]): { red: number; amber: number } {
  return {
    red: people.filter((p) => p.verdict === "red").length,
    amber: people.filter((p) => p.verdict === "amber").length,
  };
}
