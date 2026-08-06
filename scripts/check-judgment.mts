// ── Judgment reading check ─────────────────────────────────────────────────
// The brief used to print a cause-list title and stop: "Indiamart Intermesh Ltd
// vs Puma Se". That says a matter exists and nothing a partner can use — not
// which side the subject is on, not the court, not the bench, not the number
// the registry files it under. The judgment page carries all of it.
//
// The fixture below is the real Delhi High Court judgment as Indian Kanoon
// serves it, kept verbatim so this pins the actual layout rather than an
// idealised one. The second and third fixtures are other courts' formatting,
// because a parser that only reads Delhi's house style is not a parser.
//
//   npm run check:judgment

import assert from "node:assert/strict";

const { parseJudgment, sideOf, isDefendingSide, summariseJudgment, normaliseJudgmentDate } =
  await import("../lib/collectors/judgment");
const { entityMentioned } = await import("../lib/queries");

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Verbatim from indiankanoon.org/doc/85285346/
const INDIAMART_PUMA = `
*        IN THE HIGH COURT OF DELHI AT NEW DELHI

%                              Judgement delivered on: 02.06.2025

+        FAO(OS) (COMM) 6/2024, CM APPL. 2216 & 2219 of 2024

         INDIAMART INTERMESH LTD.                    ..... Appellant

                              Versus

         PUMA SE                                     ..... Respondent

Advocates who appeared in this case

For the Appellant   :   Mr Sandeep Sethi, Mr Rajshekhar Rao, Sr
                        Advocates with Mr Sidharth Chopra, Mr
                        Nitin Sharma, Mr Naman Tandon, Advocates.

For the Respondent  :   Mr. Ranjan Narula, Mr. Shakti Priyan Nair
                        and Mr. Parth Bajaj, Advocates

CORAM:
HON'BLE MR. JUSTICE VIBHU BAKHRU
HON'BLE MS. JUSTICE TARA VITASTA GANJU

                              JUDGMENT

VIBHU BAKHRU, J.

1. The appellant - IndiaMART Intermesh Limited [IIL] has filed the present
intra-court appeal, inter alia, impugning a judgment dated 03.01.2024
[impugned judgment] passed by the learned Single Judge.
`;

console.log("\nJudgment reading — IndiaMART InterMESH v. PUMA SE");

const facts = parseJudgment(INDIAMART_PUMA);

check("reads the court off the heading", () => {
  assert.match(String(facts.court), /High Court of Delhi at New Delhi/i);
});

check("reads the registry's case number", () => {
  assert.match(String(facts.caseNumber), /FAO\(OS\)/i);
  assert.match(String(facts.caseNumber), /6\/2024/);
});

check("reads the delivery date and normalises it", () => {
  assert.equal(facts.decidedOn, "2025-06-02");
});

check("reads both parties and their sides", () => {
  const appellant = facts.parties.find((p) => p.side === "appellant");
  const respondent = facts.parties.find((p) => p.side === "respondent");
  assert.ok(appellant, "no appellant found");
  assert.match(appellant!.name, /Indiamart Intermesh/i);
  assert.ok(respondent, "no respondent found");
  assert.match(respondent!.name, /PUMA SE/i);
});

check("reads the bench", () => {
  assert.equal(facts.bench.length, 2);
  assert.match(facts.bench[0], /Vibhu Bakhru/i);
  assert.match(facts.bench[1], /Tara Vitasta Ganju/i);
});

check("reads counsel by side", () => {
  assert.equal(facts.counsel.length, 2);
  assert.match(facts.counsel[0].side, /Appellant/i);
  assert.match(facts.counsel[0].advocates, /Sandeep Sethi/);
  assert.match(facts.counsel[1].advocates, /Ranjan Narula/);
});

check("places the subject on the right side of the matter", () => {
  // This is the fact the whole module exists for. The subject BROUGHT this
  // appeal; reading it the other way would put a company's own appeal in its
  // file as a case against it.
  const side = sideOf(facts, "IndiaMART InterMESH", entityMentioned);
  assert.equal(side, "appellant");
  assert.equal(isDefendingSide(side), false);
});

check("summarises using only what the document carried", () => {
  const side = sideOf(facts, "IndiaMART InterMESH", entityMentioned);
  const line = summariseJudgment(facts, side, "IndiaMART InterMESH");
  assert.match(line, /is the appellant against PUMA SE/i);
  assert.match(line, /High Court of Delhi/i);
  assert.match(line, /Vibhu Bakhru and Tara Vitasta Ganju/i);
});

// ── Other courts, other house styles ───────────────────────────────────────

console.log("\nOther formats");

const SUPREME = `
IN THE SUPREME COURT OF INDIA
CIVIL APPELLATE JURISDICTION

CA No. 4512 of 2019

STATE BANK OF INDIA
..... Appellant
Versus
V. RAMAKRISHNAN
..... Respondent

Date of Decision: 14th August, 2018

CORAM:
HON'BLE MR. JUSTICE R.F. NARIMAN
`;

check("reads a Supreme Court judgment with the side on its own line", () => {
  const f = parseJudgment(SUPREME);
  assert.match(String(f.court), /Supreme Court of India/i);
  assert.equal(f.decidedOn, "2018-08-14");
  assert.match(String(f.caseNumber), /CA No\. 4512 of 2019/i);
  const appellant = f.parties.find((p) => p.side === "appellant");
  assert.match(String(appellant?.name), /State Bank of India/i);
  assert.match(f.bench[0], /Nariman/i);
});

const WRIT = `
IN THE HIGH COURT OF JUDICATURE AT BOMBAY

WP No. 1123 of 2021

INDIA MART INTERMESH LIMITED  ..... Petitioner
                Versus
COLLECTOR OF STAMPS & ANR     ..... Respondent

Judgment delivered on: 18.04.2024
`;

check("recognises the subject when the court spaces the name differently", () => {
  // "INDIA MART INTERMESH LIMITED" is the same company as "IndiaMART
  // InterMESH" — the fix that stopped these being discarded as a different
  // party has to hold here too, or the side comes back undefined.
  const f = parseJudgment(WRIT);
  const side = sideOf(f, "IndiaMART InterMESH", entityMentioned);
  assert.equal(side, "petitioner");
  assert.equal(isDefendingSide(side), false);
});

check("a defending side is reported as one", () => {
  const f = parseJudgment(WRIT);
  const side = sideOf(f, "Collector of Stamps", entityMentioned);
  assert.equal(side, "respondent");
  assert.equal(isDefendingSide(side), true);
});

check("finds the judgment beneath a site's own page furniture", () => {
  // What a text extractor actually returns for an Indian Kanoon page: site
  // navigation, premium banners and related-case links ABOVE the judgment. The
  // parser scans bounded windows from the top, so on a real run this noise
  // pushed the cause title out of every window and all five reads yielded
  // nothing — the document has to be cut down to where the court begins.
  const NOISY =
    [
      "Indian Kanoon - Search engine for Indian Law",
      "Premium Members Advanced Search Disclaimer Mobile View",
      "Try out our Premium Member Services -- Free for one month.",
      "Cites 18 docs - [View All]",
      "The Trade Marks Act, 1999",
      "Section 29 in The Trade Marks Act",
      "Puma Se vs Indiamart Intermesh Ltd on 3 January, 2024",
      "User Queries", "trademark", "intermediary", "e-commerce",
      "Take notes as you read a judgment and organise your reading lists",
      "Delhi High Court",
    ].join("\n") +
    "\n" +
    INDIAMART_PUMA;
  const f = parseJudgment(NOISY);
  assert.match(String(f.court), /High Court of Delhi/i);
  assert.equal(f.decidedOn, "2025-06-02");
  const side = sideOf(f, "IndiaMART InterMESH", entityMentioned);
  assert.equal(side, "appellant");
  // The related-case link above the judgment names the parties the other way
  // round — slicing to the judgment is also what keeps it from being read as
  // part of the cause title.
  const appellants = f.parties.filter((p) => p.side === "appellant");
  assert.equal(appellants.length, 1);
});

check("a page that is not a judgment yields nothing rather than nonsense", () => {
  const f = parseJudgment("This page could not be loaded. Please try again later.");
  assert.equal(f.court, undefined);
  assert.equal(f.parties.length, 0);
  assert.equal(f.bench.length, 0);
  assert.equal(sideOf(f, "IndiaMART InterMESH", entityMentioned), undefined);
});

check("dates in every form the courts print", () => {
  assert.equal(normaliseJudgmentDate("02.06.2025"), "2025-06-02");
  assert.equal(normaliseJudgmentDate("18-04-2024"), "2024-04-18");
  assert.equal(normaliseJudgmentDate("2nd June 2025"), "2025-06-02");
  assert.equal(normaliseJudgmentDate("18 April, 2024"), "2024-04-18");
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll judgment-reading checks passed.\n");

// ── The table a partner reads ──────────────────────────────────────────────
// Parsing the judgment is only half of it: the row built from those facts has
// to answer, in plain English, who brought the matter and whether it is still
// running. A bulleted cause title answered neither.

const { buildCourtCases, prettyDate: pretty } = await import("../lib/courtCases");

console.log("\nCourt case rows");

check("a case the subject brought reads as theirs, not against them", () => {
  const [row] = buildCourtCases(
    [
      {
        title: "Indiamart Intermesh Ltd vs Puma Se on 2 June, 2025",
        url: "https://indiankanoon.org/doc/85285346/",
        extra: {
          side: "appellant",
          parties: ["Indiamart Intermesh Ltd. (appellant)", "PUMA SE (respondent)"],
          court: "High Court of Delhi at New Delhi",
          caseNumber: "FAO(OS) (COMM) 6/2024",
          decidedOn: "2025-06-02",
          bench: ["Vibhu Bakhru", "Tara Vitasta Ganju"],
        },
      },
    ],
    "IndiaMART InterMESH",
  );
  assert.equal(row.summary, "IndiaMART InterMESH brought this case against PUMA SE.");
  assert.equal(row.subjectRole, "Brought the appeal");
  assert.equal(row.subjectSide, "Appellant");
  assert.equal(row.defending, false);
  assert.equal(row.claimant, "Indiamart Intermesh Ltd.");
  assert.equal(row.defendant, "PUMA SE");
  assert.equal(row.caseNumber, "FAO(OS) (COMM) 6/2024");
  assert.equal(row.bench, "Vibhu Bakhru, Tara Vitasta Ganju");
  assert.equal(row.readFromJudgment, true);
});

check("a decided matter is never reported as live", () => {
  const [row] = buildCourtCases(
    [{ title: "X vs Y on 2 June, 2025", extra: { decidedOn: "2025-06-02" } }],
    "X",
  );
  assert.equal(row.status, "Decided 2 Jun 2025");
  assert.doesNotMatch(row.status, /live/i);
});

check("a case brought AGAINST the subject reads that way round", () => {
  const [row] = buildCourtCases(
    [
      {
        title: "Puma Se vs Indiamart Intermesh Ltd",
        extra: {
          side: "respondent",
          parties: ["PUMA SE (appellant)", "Indiamart Intermesh Ltd. (respondent)"],
        },
      },
    ],
    "IndiaMART InterMESH",
  );
  assert.equal(row.summary, "PUMA SE brought this case against IndiaMART InterMESH.");
  assert.equal(row.subjectRole, "Defending");
  assert.equal(row.defending, true);
});

check("a title-only case still produces a usable row and says so", () => {
  const [row] = buildCourtCases(
    [{ title: "Indiamart Intermesh Limited vs Ankit & Ors on 7 February, 2024" }],
    "IndiaMART InterMESH",
  );
  assert.equal(row.title, "Indiamart Intermesh Limited vs Ankit & Ors");
  assert.equal(row.readFromJudgment, false);
  assert.match(row.status, /7 February 2024/);
  assert.equal(row.subjectRole, undefined);
});

check("dates read the way a person writes them", () => {
  assert.equal(pretty("2025-06-02"), "2 Jun 2025");
  assert.equal(pretty(undefined), undefined);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll court-case row checks passed.\n");

// ── The read chain ─────────────────────────────────────────────────────────
// Indian Kanoon blocks plain automated readers and its API is paid, so
// Firecrawl is the route that actually works. What matters is that the scrape
// asks for the WHOLE page: `onlyMainContent` would strip the cause title, the
// CORAM block and the case number — the five fields the judgment is opened for.

const { kanoonDocId } = await import("../lib/collectors/indiankanoon");

console.log("\nRead chain");

check("a judgment URL yields its document id", () => {
  assert.equal(kanoonDocId("https://indiankanoon.org/doc/85285346/"), "85285346");
  assert.equal(kanoonDocId("https://indiankanoon.org/docfragment/123/?formInput=x"), "123");
  assert.equal(kanoonDocId("https://example.com/nope"), undefined);
});

check("the parser survives a full-page scrape, header furniture and all", () => {
  // What Firecrawl returns with onlyMainContent off: markdown chrome wrapped
  // around the judgment. This is the shape the chain now feeds the parser, so
  // it has to hold — and it is the reason main-content-only is NOT used.
  const SCRAPED =
    "[Indian Kanoon](https://indiankanoon.org/) - Search engine for Indian Law\n\n" +
    "* [Premium Members](/premium/)\n* [Advanced Search](/advanced.html)\n\n" +
    "**Cites 18 docs** - [View All](/docfragment/85285346/)\n\n" +
    "[Puma Se vs Indiamart Intermesh Ltd on 3 January, 2024](/doc/1111/)\n\n" +
    "## Delhi High Court\n\n```\n" + INDIAMART_PUMA + "\n```\n";
  const f = parseJudgment(SCRAPED);
  assert.match(String(f.court), /High Court of Delhi/i);
  assert.equal(f.decidedOn, "2025-06-02");
  assert.match(String(f.caseNumber), /FAO\(OS\)/i);
  assert.equal(sideOf(f, "IndiaMART InterMESH", entityMentioned), "appellant");
  assert.equal(f.bench.length, 2);
});

if (failures > 0) { console.error(`\n${failures} check(s) failed.\n`); process.exit(1); }
console.log("\nRead-chain checks passed.\n");
