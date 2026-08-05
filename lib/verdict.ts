import { listConcerns } from "./printBrief";
import type { PersonDiligence, Run, Severity } from "./types";

// ── One tally, read by everything that shows a verdict ───────────────────────
// The verdict and the numbers under it used to disagree in public: the banner
// read RED FLAGS while the tally beside it read "0 red flags", because the
// verdict was the worst severity across every section while the count only ever
// looked at the itemised concerns. That reconciliation was fixed once, inside
// the brief — and then the rail, the switcher and (now) the history list each
// went on reading `run.brief.verdict` raw, which is the same bug wearing a
// different hat: a run History calls red while the rail beside it says "Clear".
//
// So the reconciliation lives here, in one function every surface calls. A
// screen that shows a verdict imports `reconcile`; nothing recomputes it.

export const RANK: Record<Severity, number> = { red: 3, amber: 2, clear: 1, info: 0 };

export const worstOf = (a: Severity, b: Severity): Severity => (RANK[a] >= RANK[b] ? a : b);

/** The board, counted. `done` includes a director whose own check errored — the
 *  person was screened; the screen is what failed, and pretending they are
 *  still pending would leave a board permanently short of its own total. */
export interface BoardStats {
  total: number;
  done: number;
  red: number;
  amber: number;
}

export function diligenceStats(people: PersonDiligence[]): BoardStats {
  return {
    total: people.length,
    done: people.filter((p) => p.status === "done" || p.status === "error").length,
    red: people.filter((p) => p.verdict === "red").length,
    amber: people.filter((p) => p.verdict === "amber").length,
  };
}

export interface Reconciled {
  /** The verdict to print, with the board folded in. */
  verdict: Severity;
  /** Red items across the itemised concerns, the other sections, and the board. */
  red: number;
  amber: number;
  board: BoardStats;
}

/**
 * Reconcile a finished run into the one verdict and the counts that agree with it.
 *
 * Returns null for a run with no brief yet — a caller showing a verdict for a
 * run that has not produced one is showing something it invented.
 */
export function reconcile(run: Run): Reconciled | null {
  const brief = run.brief;
  if (!brief) return null;

  const people = run.diligence ?? [];
  const board = diligenceStats(people);

  const counts: Record<Severity, number> = { red: 0, amber: 0, clear: 0, info: 0 };
  for (const c of listConcerns(run)) counts[c.severity] += 1;
  for (const s of brief.sections) {
    // The red-flags section is the itemised list `listConcerns` already read;
    // counting it again would double every concern.
    if (s.id === "red-flags") continue;
    for (const f of s.findings) counts[f.severity] += 1;
  }

  const red = counts.red + board.red;
  const amber = counts.amber + board.amber;

  let verdict: Severity = brief.verdict;
  for (const p of people) if (p.verdict) verdict = worstOf(verdict, p.verdict);
  if (red > 0) verdict = worstOf(verdict, "red");
  else if (amber > 0 && verdict === "red") verdict = "amber";

  return { verdict, red, amber, board };
}
