// ── Judgment substance check ───────────────────────────────────────────────
// The header of a judgment is parsed; why the dispute arose and what is at
// stake are prose, so they are READ by a model. That is the one place in this
// pipeline where a model's output reaches the brief as fact, so the guards
// around it are the thing worth pinning:
//
//   1. Money is extracted by regex from the text, and the model is never asked
//      for it. A hallucinated ₹ figure would be quoted in a meeting as the
//      exposure — the worst single failure this system could produce.
//   2. Every narrative field must carry a verbatim quote from the judgment, and
//      the quote is checked against the source here. Unsupported fields are
//      dropped rather than shown.
//
//   npm run check:substance

import assert from "node:assert/strict";

const { extractAmounts, validate } = await import("../lib/judgmentSubstance");

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

const TEXT = `
2. PSE has filed the aforementioned suit being CS(COMM) 607/2021, inter alia,
seeking a decree of permanent injunction restraining IIL from using,
facilitating, or offering to any third parties the trademark 'PUMA' as a brand
name on its platform. The plaintiff claims damages of Rs. 2,00,00,000 and costs
of ₹5 lakhs. The appeal was dismissed with no order as to costs.
`;

console.log("\nAmounts — read from the text, never generated");

check("reads sums in the forms judgments write them", () => {
  const found = extractAmounts(TEXT);
  assert.ok(found.some((a) => /2,00,00,000/.test(a)), `missed the lakh-grouped sum: ${found}`);
  assert.ok(found.some((a) => /₹5 lakhs/i.test(a)), `missed the rupee-symbol sum: ${found}`);
});

check("a bare number is not an amount", () => {
  // Case numbers, years and paragraph numbers all look like digits. Treating
  // "607/2021" as two crore is exactly the error that must not happen.
  const found = extractAmounts("CS(COMM) 607/2021 was filed in 2021. See paragraph 24.");
  assert.deepEqual(found, [], `invented amounts: ${found}`);
});

check("handles a judgment with no money at all", () => {
  assert.deepEqual(extractAmounts("The appeal is dismissed."), []);
});

check("does not repeat the same sum twice", () => {
  const found = extractAmounts("Rs. 50 crore was claimed. The Rs. 50 crore claim was denied.");
  assert.equal(found.length, 1);
});

console.log("\nEvidence — a claim with no quote in the document is dropped");

check("a supported field is kept, with its quote recorded", () => {
  const out = validate(
    {
      dispute: "PUMA sued over use of its brand name on the platform.",
      disputeQuote: "seeking a decree of permanent injunction restraining IIL from using",
    },
    TEXT,
    [],
  );
  assert.equal(out.dispute, "PUMA sued over use of its brand name on the platform.");
  assert.equal(out.evidence.length, 1);
});

check("a field whose quote is NOT in the judgment is dropped", () => {
  // The model asserting something the document does not say is the failure this
  // exists to catch. It must vanish, not be shown with a caveat.
  const out = validate(
    {
      dispute: "The company was found guilty of fraud.",
      disputeQuote: "the court found the appellant guilty of fraud and imposed a penalty",
    },
    TEXT,
    [],
  );
  assert.equal(out.dispute, undefined);
  assert.equal(out.evidence.length, 0);
});

check("a field with no quote at all is dropped", () => {
  const out = validate({ dispute: "Something happened.", disputeQuote: "" }, TEXT, []);
  assert.equal(out.dispute, undefined);
});

check("quotes are matched despite whitespace and line breaks", () => {
  const out = validate(
    {
      dispute: "PUMA sought an injunction.",
      disputeQuote: "seeking   a decree of permanent\n  injunction restraining IIL",
    },
    TEXT,
    [],
  );
  assert.equal(out.dispute, "PUMA sought an injunction.");
});

check("a quote too short to prove anything is rejected", () => {
  const out = validate({ dispute: "It was dismissed.", disputeQuote: "the" }, TEXT, []);
  assert.equal(out.dispute, undefined);
});

check("the outcome is kept only when the judgment states it", () => {
  const out = validate(
    {
      dispute: "Trademark dispute.",
      disputeQuote: "seeking a decree of permanent injunction restraining IIL from using",
      outcome: "The appeal was dismissed.",
      outcomeQuote: "The appeal was dismissed with no order as to costs.",
    },
    TEXT,
    [],
  );
  assert.equal(out.outcome, "The appeal was dismissed.");
  assert.equal(out.evidence.length, 2);
});

check("'what it means' cannot stand on its own", () => {
  // `stake` is the model's read of consequence rather than a fact in the
  // document, so it must not survive when the dispute itself was unsupported.
  const out = validate(
    { dispute: "X", disputeQuote: "not in the document at all, nowhere near it", stake: "Serious exposure." },
    TEXT,
    [],
  );
  assert.equal(out.stake, undefined);
});

check("amounts survive even when every narrative field is dropped", () => {
  const out = validate({ dispute: "X", disputeQuote: "absent from the source text entirely" }, TEXT, ["Rs. 2,00,00,000"]);
  assert.equal(out.dispute, undefined);
  assert.deepEqual(out.amounts, ["Rs. 2,00,00,000"]);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll judgment-substance checks passed.\n");
