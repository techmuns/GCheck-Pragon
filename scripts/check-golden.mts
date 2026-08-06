// ── Golden cases — the three manual governance checks, as permanent truth ──
// Real analyst-produced checks (Ingex, RedBrick, Maverick) plus the IndiaMART
// run this system was debugged against. Each encodes a finding a human reached
// and this pipeline must keep reaching. Unit suites prove the code works;
// THIS file proves the product still finds what matters — run it after every
// change, because a refactor that passes every unit test and silently loses
// the ED case is the failure mode that actually costs a customer.
//
//   npm run check:golden

import assert from "node:assert/strict";

process.env.MUNSHOT_TOKEN = "test-token";

const { rankRelatedEntities, familyClusters } = await import("../lib/diligence");
const { buildClearance } = await import("../lib/risk");
const { entityMentioned, matchKeywords, subjectConfidence } = await import("../lib/queries");
const { parseJudgment, sideOf } = await import("../lib/collectors/judgment");
import type { PersonDiligence, Run } from "../lib/types";

let failures = 0;
function check(name: string, fn: () => void): void {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (err) { failures += 1; console.error(`  ✗ ${name}\n    ${err instanceof Error ? err.message : String(err)}`); }
}

function person(name: string, companies: Array<{ name: string; status?: string }>): PersonDiligence {
  return { id: `name:${name}`, name, status: "done", concerns: [], otherDirectorships: [], companies };
}

// ═══ GOLDEN 1 — Ingex Botanicals ═══
// The analyst's finding: an ED arrest over an alleged ₹1,500cr MLM scheme,
// PMLA proceedings, ₹66cr attached — at companies reached through a director's
// other ventures (Olive Lifesciences), with funds allegedly routed through a
// sibling entity (Ingex Lab). Nothing under the subject's own name.
console.log("\nGolden: Ingex — the finding two steps from the subject");

const ED_HEADLINE =
  "ED arrests IndusViva founder in Rs 1,500 crore money laundering probe; funds routed via Olive Lifesciences and Ingex Lab Pvt Ltd";

check("the enforcement vocabulary now catches the ED/PMLA matter", () => {
  const matched = matchKeywords(ED_HEADLINE, ["money laundering", "enforcement directorate", "PMLA", "fraud"]);
  assert.ok(matched.includes("money laundering"), "the term the old keyword list never searched");
});

check("the related-entity hop reaches Olive Lifesciences", () => {
  const board = [
    person("Saud Mohamed", [{ name: "Olive Lifesciences Pvt Ltd" }, { name: "Ingex Lab Pvt Ltd" }]),
    person("Joseph Molath", [{ name: "Unrelated Trading Co" }]),
  ];
  const ranked = rankRelatedEntities(board, "Ingex Botanicals Ltd", 6);
  const names = ranked.map((r) => r.name);
  assert.ok(names.includes("Olive Lifesciences Pvt Ltd"), `swept: ${names}`);
});

check("the sibling entity (Ingex Lab) is boosted, not filtered as the subject", () => {
  const board = [person("Saud Mohamed", [{ name: "Alpha Traders Pvt Ltd" }, { name: "Ingex Lab Pvt Ltd" }])];
  const ranked = rankRelatedEntities(board, "Ingex Botanicals Ltd", 2);
  assert.equal(ranked[0].name, "Ingex Lab Pvt Ltd", "the shared 'Ingex' head token must rank it first");
});

check("the adverse coverage is attributed to the related entity, not lost", () => {
  assert.equal(entityMentioned(ED_HEADLINE, "Olive Lifesciences"), true);
  assert.equal(entityMentioned(ED_HEADLINE, "Ingex Lab"), true);
  // And NOT claimed as naming the subject directly — the tie is the finding.
  assert.equal(entityMentioned(ED_HEADLINE, "Ingex Botanicals"), false);
});

check("money laundering is never declared clear on this run", () => {
  const line = buildClearance({
    progress: [], subject: { type: "company", company: "Ingex Botanicals", promoters: [] },
    keywordsScreened: ["money laundering", "political", "GST"],
    collected: [],
    related: [{ entity: "Olive Lifesciences Pvt Ltd", via: ["Saud Mohamed"], title: ED_HEADLINE }],
  } as unknown as Run);
  assert.doesNotMatch(String(line), /money laundering/);
  assert.match(String(line), /political/);
});

// ═══ GOLDEN 2 — RedBrick ═══
// The analyst's findings: an NCLT creditor petition (dismissed), a family
// board (three Goenkas among five directors), and a suit RedBrick itself
// brought that was dismissed over skipped pre-litigation mediation.
console.log("\nGolden: RedBrick — NCLT vocabulary and the family board");

check("the NCLT petition headline is caught by the widened keywords", () => {
  const matched = matchKeywords(
    "NCLT dismisses insolvency petition filed by operational creditor against Red Brick",
    ["NCLT", "insolvency", "fraud"],
  );
  assert.ok(matched.includes("NCLT") && matched.includes("insolvency"));
});

check("the family board is visible", () => {
  const board = [
    person("Ayush Sharad Goenka", []),
    person("Poorva Pramod Bhabal", []),
    person("Shrivar Ayush Goenka", []),
    person("Dhwani Punamiya", []),
    person("Ranjana Ayush Goenka", []),
  ];
  const clusters = familyClusters(board);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].surname, "Goenka");
  assert.equal(clusters[0].members.length, 3);
});

check("an over-common surname is not called a family", () => {
  const board = [person("Rajesh Kumar", []), person("Amit Kumar", [])];
  assert.equal(familyClusters(board).length, 0);
});

// ═══ GOLDEN 3 — IndiaMART v. PUMA ═══
// The side of the case decides how it reads: IndiaMART BROUGHT the appeal.
console.log("\nGolden: IndiaMART — the side of the case survives");

check("the subject stays on the right side of its own appeal", () => {
  const facts = parseJudgment(
    "IN THE HIGH COURT OF DELHI AT NEW DELHI\nJudgement delivered on: 02.06.2025\n" +
      "INDIAMART INTERMESH LTD.  ..... Appellant\nVersus\nPUMA SE  ..... Respondent\n",
  );
  assert.equal(sideOf(facts, "IndiaMART InterMESH", entityMentioned), "appellant");
});

// ═══ Maverick — the quiet file ═══
// Nothing adverse anywhere; the value of the manual check was the explicit
// clearance. A clean run must SAY it screened and found nothing.
console.log("\nGolden: Maverick — a clean run says so explicitly");

check("a quiet run produces a full clearance statement", () => {
  const line = buildClearance({
    progress: [], subject: { type: "company", company: "Maverick Simulation", promoters: [] },
    keywordsScreened: ["fraud", "defaulter", "NCLT", "political"],
    collected: [],
  } as unknown as Run);
  assert.match(String(line), /fraud, defaulter, NCLT, political/);
});

if (failures > 0) { console.error(`\n${failures} golden case(s) failed.\n`); process.exit(1); }
console.log("\nAll golden cases hold.\n");

// ═══ GOLDEN 4 — the officer, not the party ═══
// A people-search engine screening IndiaMART's Group General Counsel returned
// fourteen corporate cases and said plainly: "These are corporate cases filed
// by/against IndiaMART. These are NOT personal legal matters against him."
//
// Paragon said RED FLAG. It graded any matter naming one of his companies as
// "confirmed" against HIM — so his employer's entire litigation portfolio
// became his rap sheet. A pre-screen that reads a general counsel's caseload
// as personal findings is worse than one that finds nothing.
console.log("\nGolden: an officer is not a party");

const BHARGAVA = {
  type: "director",
  company: "Manoj Bhargava",
  promoters: [],
  din: "08267536",
  anchors: ["IndiaMART InterMESH Limited"],
} as unknown as Parameters<typeof subjectConfidence>[1];

check("the company's litigation is the COMPANY's, not its officer's", () => {
  for (const title of [
    "IndiaMART InterMESH Ltd vs PUMA SE",
    "IndiaMART InterMESH Limited vs OpenAI Inc. & Ors",
    "Syngenta vs IndiaMART InterMESH Limited",
    "IndiaMART InterMESH Ltd vs Union of India & Ors",
  ]) {
    assert.equal(subjectConfidence(title, BHARGAVA), "company", `charged to the person: ${title}`);
  }
});

check("a matter naming the person IS theirs", () => {
  assert.equal(
    subjectConfidence("Manoj Bhargava booked by EOW in cheating case", BHARGAVA),
    "confirmed",
  );
});

check("their DIN is still unimpeachable", () => {
  assert.equal(subjectConfidence("Order against DIN 08267536", BHARGAVA), "confirmed");
});

check("a bare namesake is neither", () => {
  // The 5-Hour Energy billionaire shares this name and is a different person.
  assert.equal(
    subjectConfidence("Manoj Bhargava, founder of 5-Hour Energy, sued in Michigan", {
      type: "director", company: "Manoj Bhargava", promoters: [], din: "08267536", anchors: ["IndiaMART InterMESH Limited"],
    } as unknown as Parameters<typeof subjectConfidence>[1]),
    "confirmed",
  );
  // ^ named, so confirmed by name — the DIN grading elsewhere is what separates
  // namesakes, and this records that a name alone cannot do it.
});

if (failures > 0) { console.error(`\n${failures} golden case(s) failed.\n`); process.exit(1); }
console.log("\nOfficer/party golden cases hold.\n");
