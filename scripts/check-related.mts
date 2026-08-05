// ── Related-entity sweep & clearance check ─────────────────────────────────
// Benchmarked against real manual governance checks. The one material finding
// in them was TWO steps from the subject: a director's other venture, hit by an
// ED/PMLA matter, with funds routed through a sibling entity — nothing under
// the subject's own name. And every manual check closes by naming what was
// screened and found clear. Both behaviours are pinned here.
//
//   npm run check:related

import assert from "node:assert/strict";

process.env.MUNSHOT_TOKEN = "test-token";

const { rankRelatedEntities } = await import("../lib/diligence");
const { buildClearance } = await import("../lib/risk");
import type { PersonDiligence, Run } from "../lib/types";

let failures = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures += 1; console.error(`  ✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`); }
}

function person(name: string, companies: Array<{ name: string; status?: string }>): PersonDiligence {
  return { id: `name:${name}`, name, status: "done", concerns: [], otherDirectorships: [], companies };
}

console.log("\nRelated-entity ranking");

check("a company two directors share outranks everything", () => {
  const ranked = rankRelatedEntities(
    [
      person("A", [{ name: "Solo Ventures Pvt Ltd" }, { name: "Shared Holdings Pvt Ltd" }]),
      person("B", [{ name: "Shared Holdings Pvt Ltd" }, { name: "Other Co Pvt Ltd" }]),
    ],
    "Subject Ltd",
    2,
  );
  assert.equal(ranked[0].name, "Shared Holdings Pvt Ltd");
  assert.deepEqual(ranked[0].via.sort(), ["A", "B"]);
});

check("a struck-off entity outranks a healthy single-link one", () => {
  const ranked = rankRelatedEntities(
    [person("A", [{ name: "Healthy Co" }, { name: "Shell Co", status: "Strike Off" }])],
    "Subject Ltd",
    1,
  );
  assert.equal(ranked[0].name, "Shell Co");
});

check("the subject itself is never swept", () => {
  const ranked = rankRelatedEntities(
    [person("A", [{ name: "Subject Limited" }, { name: "Genuine Other Pvt Ltd" }])],
    "Subject",
    5,
  );
  assert.deepEqual(ranked.map((r) => r.name), ["Genuine Other Pvt Ltd"]);
});

check("the same entity spelled two ways is one entity", () => {
  const ranked = rankRelatedEntities(
    [
      person("A", [{ name: "Olive Lifesciences Pvt. Ltd." }]),
      person("B", [{ name: "Olive  Lifesciences Pvt Ltd" }]),
    ],
    "Ingex Botanicals",
    5,
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].via.length, 2);
});

check("the cap holds and drops the least significant", () => {
  const names = ["Alpha Traders", "Bravo Mills", "Charlie Foods", "Delta Steel", "Echo Textiles", "Foxtrot Agro", "Golf Motors", "Hotel Exports"];
  const people = [person("A", names.map((n) => ({ name: `${n} Pvt Ltd` })))];
  assert.equal(rankRelatedEntities(people, "Subject", 6).length, 6);
});

check("an all-noise name is dropped rather than guessed at", () => {
  // "Company Pvt Ltd" reduces to nothing distinctive; the permissive matcher
  // treats it as the subject and the sweep skips it — a search for a name that
  // names nothing would only return noise to misattribute.
  const ranked = rankRelatedEntities([person("A", [{ name: "Company Pvt Ltd" }])], "Subject", 5);
  assert.equal(ranked.length, 0);
});

console.log("\nClearance — screened and found clear");

const runBase = { progress: [], subject: { type: "company", company: "X", promoters: [] } } as unknown as Run;

check("keywords with no findings are declared clear", () => {
  const line = buildClearance({
    ...runBase,
    keywordsScreened: ["fraud", "PMLA", "political"],
    collected: [],
  });
  assert.ok(line);
  assert.match(line!, /fraud, PMLA, political/);
});

check("a keyword that surfaced a finding is NEVER declared clear", () => {
  // Claiming "clear on fraud" while a fraud finding sits above it would be the
  // exact lie the clearance line exists to prevent.
  const line = buildClearance({
    ...runBase,
    keywordsScreened: ["fraud", "political"],
    collected: [
      {
        sourceId: "google", sourceName: "g", kind: "api", status: "done",
        hits: [{ title: "Company director booked in fraud case" }],
      },
    ],
  } as unknown as Run);
  assert.ok(line);
  assert.doesNotMatch(line!, /\bfraud\b/);
  assert.match(line!, /political/);
});

check("related-entity findings also block a clearance", () => {
  const line = buildClearance({
    ...runBase,
    keywordsScreened: ["money laundering", "political"],
    collected: [],
    related: [{ entity: "Olive Lifesciences", via: ["A"], title: "ED probes money laundering at Olive" }],
  } as unknown as Run);
  assert.doesNotMatch(String(line), /money laundering/);
});

check("no screened record means no clearance claim at all", () => {
  assert.equal(buildClearance({ ...runBase, collected: [] }), undefined);
});

if (failures > 0) { console.error(`\n${failures} check(s) failed.\n`); process.exit(1); }
console.log("\nAll related-entity and clearance checks passed.\n");
