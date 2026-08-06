// ── Relevance & lookback check ─────────────────────────────────────────────
// A real run put three items under "Key concerns": one genuine fraud
// allegation, a law firm's press release congratulating itself on advising the
// company's USD 12m raise, and a JOB POSTING for a Legal & Compliance Manager.
// Two of the three were noise, and noise beside a red flag costs more than the
// space it takes — the reader stops trusting the item next to it.
//
// Separately, an undated news query returns this quarter, so a matter from
// eighteen months ago never appeared at all. The planner now sweeps year
// windows too.
//
//   npm run check:relevance

import assert from "node:assert/strict";

const { nonAdverseKind } = await import("../lib/relevance");
const { lookbackWindows } = await import("../lib/collectors/news");

let failures = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures += 1; console.error(`  ✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`); }
}

console.log("\nWhat is not a concern — the three from the real run");

check("a job posting is not a governance matter", () => {
  assert.equal(
    nonAdverseKind("Legal & Compliance Role @ Orange Health Labs", undefined,
      "Legal & Compliance Role. Orange Health Labs ... Coordinate with regulators, auditors"),
    "recruitment",
  );
});

check("an adviser's own mandate announcement is not adverse", () => {
  assert.equal(
    nonAdverseKind("River Law's Post", undefined,
      "Rajaram Legal is excited to have advised Orange Health Labs on their USD 12 million..."),
    "advisory-pr",
  );
});

check("a funding round is not adverse", () => {
  assert.ok(nonAdverseKind("Orange Health Labs raises USD 12 million in Series B"));
  assert.ok(nonAdverseKind("Startup secures Rs 40 crore funding round"));
});

check("a ratings/directory page reports nothing", () => {
  assert.equal(nonAdverseKind("Orange Health Labs: Blood Test - Ratings & Reviews"), "directory");
});

check("recruitment hosts are caught by URL alone", () => {
  assert.equal(nonAdverseKind("Compliance Manager", "https://www.naukri.com/job-listings-x"), "recruitment");
  assert.equal(nonAdverseKind("Manager", "https://example.com/careers/legal"), "recruitment");
});

console.log("\nWhat must still get through");

check("real adverse coverage is never set aside", () => {
  const real = [
    ["ED arrests founder in Rs 1,500 crore money laundering probe", undefined],
    ["NCLT admits insolvency petition against the company", undefined],
    ["SEBI penalises promoter for disclosure lapses", undefined],
    ["Company booked for fraud by EOW", undefined],
    ["Delhi HC stays notice against Indiamart Intermesh Ltd", undefined],
  ] as const;
  for (const [title, url] of real) {
    assert.equal(nonAdverseKind(title, url), undefined, `wrongly set aside: ${title}`);
  }
});

check("an adverse signal overrules a benign shape", () => {
  // A raise announced by a company simultaneously under investigation is still
  // a story about the investigation.
  assert.equal(
    nonAdverseKind("Firm raises USD 12 million weeks after fraud investigation opened"),
    undefined,
  );
  // A careers page is still a careers page when nothing adverse is present.
  assert.equal(nonAdverseKind("Careers at the company", "https://x.com/careers/"), "recruitment");
});

console.log("\nTwo years of coverage");

check("the sweep reaches back two full years", () => {
  const windows = lookbackWindows(new Date("2026-08-06T00:00:00Z"));
  assert.deepEqual(windows, ["2026", "2025", "2024"]);
});

check("the lookback is configurable", () => {
  process.env.NEWS_LOOKBACK_YEARS = "4";
  assert.equal(lookbackWindows(new Date("2026-01-01T00:00:00Z")).length, 5);
  delete process.env.NEWS_LOOKBACK_YEARS;
});

if (failures > 0) { console.error(`\n${failures} check(s) failed.\n`); process.exit(1); }
console.log("\nAll relevance and lookback checks passed.\n");
