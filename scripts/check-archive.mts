// ── Does a saved brief still say what the live one said? ────────────────────
// The run archive stores a trimmed copy of a finished run so a past brief can
// be re-opened with no server behind it. Trimming is where that goes wrong
// quietly: every read site in the brief uses `?? []`, so a snapshot that drops
// too much still renders — as a shorter, calmer document, with nothing on
// screen saying so. "It renders" is therefore not the test.
//
// This is the test. For every fixture run, the snapshot is built and then
// diffed against the live run on the numbers a reader would actually notice:
// the risk score, the itemised concerns, the news table, the verdict and its
// counts, the board, and the clarifications — which are the lines that say
// what each source found, and the ones most easily turned into a falsehood by
// a trim that shrinks a hit list.
//
// No network, no credential, no cost — it runs on the same fixtures the print
// preview does, so it belongs in CI beside the other checks.

import { mockRun, type Size } from "../app/print-preview/mocks";
import { snapshotRun, byteLength, trimCollected } from "../lib/archive";
import { assessRisk } from "../lib/risk";
import { buildPrintBrief, listConcerns, formatGenerated } from "../lib/printBrief";
import { reconcile } from "../lib/verdict";
import type { CollectorResult, RunEvent, Run } from "../lib/types";

const SIZES: Size[] = ["short", "average", "max", "director", "read"];

/**
 * A run the size the fixtures never are.
 *
 * The whole budget — how many briefs can be kept, and whether they belong in
 * localStorage at all — rests on how big a real one serialises to, and the
 * print-preview mocks are a page each. So one is inflated to what a deep run
 * actually produces: a news sweep of two hundred articles with real snippets,
 * a web sweep behind it, and the activity log of the minutes it took.
 */
function fatten(run: Run): Run {
  const filler =
    "The company said in an exchange filing that the matter relates to a period before the current board took " +
    "office, and that it has sought legal advice. The regulator has not commented. ";
  const bulk = (n: number, id: string): CollectorResult["hits"] =>
    Array.from({ length: n }, (_, i) => ({
      title: `${id} result ${i + 1} — regulatory notice concerning the subject and its subsidiaries`,
      url: `https://example.test/${id}/${i}`,
      snippet: filler.repeat(6),
      entity: run.subject.company,
      date: "2026-03-14",
      matchedKeywords: ["probe", "notice"],
    }));

  const events: RunEvent[] = Array.from({ length: 400 }, (_, i) => ({
    at: new Date(Date.parse(run.createdAt) + i * 900).toISOString(),
    level: "query",
    sourceId: "news",
    text: `Searched "${run.subject.company} regulatory action" — page ${i + 1}`,
    url: `https://news.example.test/search?p=${i}`,
  }));

  const collected: CollectorResult[] = [
    ...(run.collected ?? []),
    { sourceId: "news", sourceName: "News Deep Dive", kind: "api", status: "done", hits: bulk(200, "news"), queries: ["a", "b"] },
    { sourceId: "google", sourceName: "Google & News", kind: "api", status: "done", hits: bulk(120, "google") },
  ];

  return { ...run, id: `${run.id}-fat`, events, collected };
}

let failures = 0;

function check(label: string, live: unknown, saved: unknown): void {
  const a = JSON.stringify(live);
  const b = JSON.stringify(saved);
  if (a === b) {
    console.log(`    ✓ ${label}: ${a}`);
    return;
  }
  failures += 1;
  console.log(`    ✗ ${label}: live ${a} → saved ${b}`);
}

/** What a reader would notice, reduced to comparable numbers. */
function shape(run: Run) {
  const rec = reconcile(run);
  const print = buildPrintBrief(run, formatGenerated(run.createdAt));
  return {
    verdict: rec?.verdict ?? null,
    red: rec?.red ?? 0,
    amber: rec?.amber ?? 0,
    board: rec?.board ?? null,
    risk: assessRisk(run).score,
    band: assessRisk(run).band,
    concerns: listConcerns(run).length,
    // Titles, not a count: the news table sorts by tone and then cuts to
    // twelve, so a trim that drops a hit which would have led the table changes
    // what is printed without changing how much of it there is.
    news: (print?.news ?? []).map((n) => `${n.tone}|${n.headline}`),
    people: print?.people.length ?? 0,
    citations: run.brief?.citations.length ?? 0,
    // The lines that report what each source found. A trim that shrinks a hit
    // list without saying so rewrites these into claims the run never made.
    clarifications: (print?.clarifications ?? []).map((c) => `${c.source}: ${c.text}`),
    scope: (print?.scope.lines ?? []).map((l) => `${l.name}:${l.status}`),
    gaps: print?.gaps ?? [],
  };
}

console.log("→ Archive fidelity: a saved brief against the run it was saved from\n");

const CASES: Array<[string, Run]> = [
  ...SIZES.map((s): [string, Run] => [s, mockRun(s)]),
  ["max + a deep sweep", fatten(mockRun("max"))],
];

for (const [size, live] of CASES) {
  const body = snapshotRun(live);

  console.log(`  ${size}`);
  if (!body) {
    failures += 1;
    console.log("    ✗ no snapshot produced for a run that has a brief");
    continue;
  }

  const liveBytes = byteLength(live);
  const savedBytes = byteLength(body);
  console.log(
    `    · ${(savedBytes / 1024).toFixed(1)} KB saved, from ${(liveBytes / 1024).toFixed(1)} KB live ` +
      `(${Math.round((savedBytes / Math.max(1, liveBytes)) * 100)}%)`,
  );

  const a = shape(live);
  const b = shape(body as Run);
  for (const key of Object.keys(a) as Array<keyof typeof a>) check(key, a[key], b[key]);

  // Trimming must never take a source that returned something down to nothing:
  // a done collector with no hits prints "nothing on record", which is a
  // statement about the world, not about the copy. And whatever it does drop,
  // the count it reports must stay the count the source actually returned.
  const trimmed = trimCollected(live.collected ?? []);
  // Matched by position — `trimCollected` maps one to one, and a run can carry
  // two collectors with the same sourceId.
  trimmed.forEach((c, i) => {
    const before = (live.collected ?? [])[i];
    if (!before) return;
    if (before.hits.length > 0 && c.hits.length === 0) {
      failures += 1;
      console.log(`    ✗ ${c.sourceId}: ${before.hits.length} hits trimmed to none`);
    }
    if (c.originalHits !== before.hits.length) {
      failures += 1;
      console.log(`    ✗ ${c.sourceId}: reports ${c.originalHits} hits, source returned ${before.hits.length}`);
    }
    if (c.hits.length < before.hits.length) {
      console.log(`    · ${c.sourceId}: ${before.hits.length} → ${c.hits.length} hits kept`);
    }
  });
  console.log("");
}

if (failures > 0) {
  console.error(`✗ ${failures} difference${failures === 1 ? "" : "s"} between a saved brief and the live one.`);
  process.exit(1);
}
console.log("✓ Saved briefs match the runs they were saved from.");
