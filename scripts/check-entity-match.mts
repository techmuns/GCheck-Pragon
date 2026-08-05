// ── Entity matching & registry lookup check ────────────────────────────────
// Two failures found on the same run, both of which quietly LOSE data — the
// expensive direction for a governance pre-screen to be wrong in.
//
//   1. `entityMentioned` compared token against token, so a company written
//      with different word boundaries read as a different company.
//      "IndiaMART InterMESH" tokenises to [indiamart, intermesh]; the cause
//      list writes "India Mart Intermesh Limited" → [india, mart, intermesh].
//      "indiamart" is not "india", so the subject's OWN court records were
//      being set aside as "a different party".
//
//   2. The MCA registry lookup fired a single `site:` query. Not every search
//      backend honours that operator, and the chain now runs on whichever of
//      Munshot, SerpAPI, Firecrawl or the keyless engine is alive — so the
//      register page never surfaced and a listed company read as absent.
//
//   npm run check:entity
//
// The company set below is deliberately mixed: real Indian listed names with
// awkward capitalisation, sibling brands that must STILL be told apart, and
// short names where a loose match would be dangerous.

import assert from "node:assert/strict";

const { entityMentioned } = await import("../lib/queries");
const { registryQueries, cinIn, pickCompanyUrl } = await import("../lib/collectors/indiafilings");

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

console.log("\nEntity matching — must not lose the subject's own records");

// Every one of these is the same company written as some real source writes it.
const INDIAMART_SHOULD_MATCH = [
  'India Mart Intermesh Limited vs Collector Of Stamps, Kalkaji & Anr on 18 April, 2024',
  'India Mart Intermesh Ltd. vs Dr. Rajanala Nirmala & Anr. on 18 August, 2023',
  'Indiamart Intermesh Ltd vs Puma Se',
  'Buy IndiaMart InterMesh; target of Rs 2300: ICICI Securities',
  'INDIAMART INTERMESH LTD. ..... Appellant',
  'IndiaMART InterMESH Limited [IIL] has filed the present intra-court appeal',
  'India-Mart Intermesh reports quarterly results',
];

check("every real spelling of the subject is recognised", () => {
  for (const text of INDIAMART_SHOULD_MATCH) {
    assert.equal(entityMentioned(text, "IndiaMART InterMESH"), true, `missed: ${text}`);
  }
});

check("the same holds when the subject carries its legal suffix", () => {
  for (const text of INDIAMART_SHOULD_MATCH) {
    assert.equal(entityMentioned(text, "IndiaMART InterMESH Limited"), true, `missed: ${text}`);
  }
});

// The guard the phrase test exists for. Loosening word boundaries must not
// loosen this: a sibling brand is a different company and its findings must
// never be attributed to the subject.
check("sibling brands are still told apart", () => {
  const cases: Array<[string, string]> = [
    ["Reliance Digital opens 50 new stores", "Reliance Power"],
    ["Reliance Power posts a loss", "Reliance Industries"],
    ["Tata Motors recalls a batch", "Tata Steel"],
    ["Bajaj Finserv announces results", "Bajaj Auto"],
    ["Adani Green commissions a plant", "Adani Ports"],
    ["Kotak Mahindra Bank raises rates", "Kotak Mahindra Prime"],
  ];
  for (const [text, subject] of cases) {
    assert.equal(entityMentioned(text, subject), false, `wrongly matched: ${subject} ← ${text}`);
  }
});

check("real matches for those same companies still land", () => {
  const cases: Array<[string, string]> = [
    ["Reliance Industries Ltd reports record profit", "Reliance Industries"],
    ["RELIANCE INDUSTRIES LIMITED vs Union Of India", "Reliance Industries"],
    ["Tata Steel Limited vs Commissioner of Customs", "Tata Steel"],
    ["Bajaj Auto Ltd. announces a buyback", "Bajaj Auto"],
    ["HDFC Bank Limited vs Sudhir Kumar", "HDFC Bank"],
    ["Larsen & Toubro Limited wins an order", "Larsen and Toubro"],
  ];
  for (const [text, subject] of cases) {
    assert.equal(entityMentioned(text, subject), true, `missed: ${subject} ← ${text}`);
  }
});

check("a short name is not matched inside a longer word", () => {
  // "ola" sits inside "motorola" — below the compact-match floor these fall
  // back to the phrase test, which will not make that mistake.
  assert.equal(entityMentioned("Motorola launches a handset", "Ola"), false);
  assert.equal(entityMentioned("Motorola Solutions India", "Ola"), false);
});

console.log("\nMCA registry lookup");

check("the query ladder drops the operator, then the quotes", () => {
  const qs = registryQueries("IndiaMART InterMESH");
  assert.equal(qs.length, 3);
  assert.match(qs[0], /^site:indiafilings\.com "IndiaMART InterMESH" cin$/);
  assert.ok(!qs[1].startsWith("site:"), "second rung must drop the site: operator");
  assert.ok(!qs[2].includes('"'), "third rung must drop the quotes");
  // The register files companies by full legal name.
  assert.match(qs[2], /limited/i);
});

check("a name that already carries its suffix is not given a second one", () => {
  const qs = registryQueries("Reliance Industries Limited");
  assert.equal(qs.filter((q) => /limited\s+limited/i.test(q)).length, 0);
});

check("a CIN is recognised wherever the user puts it", () => {
  assert.equal(cinIn("L74899DL1999PLC101534"), "L74899DL1999PLC101534");
  assert.equal(cinIn("IndiaMART InterMESH L74899DL1999PLC101534"), "L74899DL1999PLC101534");
  assert.equal(cinIn("l74899dl1999plc101534"), "L74899DL1999PLC101534");
  // Not a CIN: right length, wrong structure. Must not be mistaken for one.
  assert.equal(cinIn("ABCDEFGHIJKLMNOPQRSTU"), null);
  assert.equal(cinIn("IndiaMART InterMESH"), null);
});

check("the register page picked is the company we asked for", () => {
  const results = [
    { url: "https://www.indiafilings.com/search/indiamart-lite-services-cin-U74999DL2015PTC123456" },
    { url: "https://www.indiafilings.com/search/indiamart-intermesh-limited-cin-L74899DL1999PLC101534" },
  ];
  // The looser rungs of the ladder can return a sibling first; the slug is what
  // decides, because attributing another company's board to this subject is a
  // worse failure than finding nothing.
  assert.equal(
    pickCompanyUrl(results, "IndiaMART InterMESH"),
    "https://www.indiafilings.com/search/indiamart-intermesh-limited-cin-L74899DL1999PLC101534",
  );
});

check("no candidate sharing the name is no answer at all", () => {
  const results = [{ url: "https://www.indiafilings.com/search/some-other-co-cin-U74999DL2015PTC123456" }];
  assert.equal(pickCompanyUrl(results, "IndiaMART InterMESH"), null);
});

check("non-registry results are ignored", () => {
  assert.equal(pickCompanyUrl([{ url: "https://example.com/indiamart" }], "IndiaMART"), null);
  assert.equal(pickCompanyUrl([], "IndiaMART"), null);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll entity-match and registry checks passed.\n");
