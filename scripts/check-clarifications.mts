// ── Considered & not counted ────────────────────────────────────────────────
// The sweeps filter out results that name a different entity, and used to drop
// them silently. That left every quiet section ambiguous: a subject with no
// court cases and a subject whose four court cases all belonged to somebody
// else produced an identical page.
//
// This pins the two statements the block exists to keep apart — "searched,
// found nothing" and "found things, set them aside, here they are" — and that
// a source which found nothing and excluded nothing stays silent rather than
// padding the report with a line saying so.
//
//   npm run check:clarifications

import { buildPrintBrief } from "../lib/printBrief";
import type { CollectorResult, Run } from "../lib/types";

function runWith(collected: CollectorResult[]): Run {
  return {
    id: "check",
    status: "complete",
    subject: { type: "director", company: "AKASH MUKESH AMBANI", promoters: [], din: "06984194" },
    progress: [],
    collected,
    brief: { verdict: "clear", headline: "", citations: [], sections: [] },
  } as unknown as Run;
}

const clarify = (collected: CollectorResult[]) =>
  buildPrintBrief(runWith(collected), "31 Jul 2026")!.clarifications;

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}\n      expected ${e}\n      got      ${a}`);
  }
}

// ── A source that ran and genuinely found nothing must say so ──
const empty = clarify([
  {
    sourceId: "cibil", sourceName: "Loan Defaults", kind: "browser",
    status: "done", hits: [], queries: ["q1", "q2"],
  } as CollectorResult,
]);
check("a source that found nothing is reported", empty.length, 1);
check("…naming the source", empty[0]?.source, "Loan Defaults");
check("…and how much it searched", empty[0]?.text, "2 searches run — nothing on record.");

// ── A source that found things and set some aside must name them ──
const setAside = clarify([
  {
    sourceId: "indiankanoon", sourceName: "Court Cases", kind: "api",
    status: "done",
    hits: [{ title: "A case that was kept" }],
    queries: ["q1"],
    excluded: [
      { title: "Jindal Polybuttons Pvt Ltd vs Allure Interiors", url: "https://x/1", reason: "Case names a different party" },
    ],
  } as CollectorResult,
]);
check("a source with exclusions is reported", setAside.length, 1);
check("…the items are named", setAside[0]?.items[0]?.title, "Jindal Polybuttons Pvt Ltd vs Allure Interiors");
check("…with the reason", setAside[0]?.items[0]?.reason, "Case names a different party");

// ── A source that found things and excluded nothing has nothing to explain ──
check(
  "a clean source adds no line",
  clarify([
    {
      sourceId: "google", sourceName: "Google / News", kind: "api",
      status: "done", hits: [{ title: "kept" }], queries: ["q1"],
    } as CollectorResult,
  ]).length,
  0,
);

// ── A source that never ran belongs in Research Gaps, not here: this block is
// about what WAS examined, and claiming otherwise would be the opposite of the
// honesty it exists to provide. ──
check(
  "a locked source is not claimed as examined",
  clarify([
    {
      sourceId: "cibil", sourceName: "Loan Defaults", kind: "browser",
      status: "locked", note: "Upgrade required.", hits: [],
    } as CollectorResult,
  ]).length,
  0,
);

console.log(failures === 0 ? "\nclarifications tell silence apart from exclusion" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
