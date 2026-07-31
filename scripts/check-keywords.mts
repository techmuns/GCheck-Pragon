// ── Keyword matcher check ───────────────────────────────────────────────────
// `matchKeywords` decides which findings the brief calls adverse, so a matcher
// that is merely approximate prints accusations about named people. It was once
// a bare substring test, which meant "courtesy" was a court matter, "illegal"
// was a legal matter and "civilian" was a civil one — every one of those
// reaching the page as "Adverse: …" beside somebody's name.
//
// The cases below are the real false positives from the Akash Ambani run, plus
// the true positives that must survive any tightening of the rule.
//
//   npm run check:keywords
//
// Unlike check-indiafilings.mjs this imports the real function rather than
// re-implementing it: the whole point is to pin the behaviour of that exact
// matcher, and a second copy of the regex would pass while the app failed.

import { matchKeywords } from "../lib/queries";

/** The live keyword set from lib/config.ts. */
const KEYWORDS = [
  "lawsuit", "legal", "court", "criminal", "civil", "cbi",
  "eow", "fraud", "default", "defaulter", "wilful", "police",
];

interface Case {
  text: string;
  want: string[];
  label: string;
}

const CASES: Case[] = [
  // ── False positives observed in the shipped report ──
  { text: "Mukesh Ambani on Instagram: Mumbai courtesy visit", want: [], label: "'courtesy' is not 'court'" },
  { text: "Reliance opens a store, courted by investors", want: [], label: "'courted' is not 'court'" },
  { text: "A civilian project in Navi Mumbai", want: [], label: "'civilian' is not 'civil'" },
  { text: "An illegal construction was demolished", want: [], label: "'illegal' is not 'legal'" },
  { text: "Advice from a paralegal team", want: [], label: "'paralegal' is not 'legal'" },
  { text: "The area is policed by two stations", want: [], label: "'policed' is not 'police'" },

  // ── True positives that must survive ──
  { text: "The Supreme Court reserved judgment", want: ["court"], label: "'court' as a word" },
  { text: "The scheme is entirely legal and above board", want: ["legal"], label: "'legal' as a word" },
  { text: "CBI files a case against the promoter", want: ["cbi"], label: "'cbi' as a word" },
  { text: "Police registered an FIR", want: ["police"], label: "'police' as a word" },
  { text: "A civil suit is pending", want: ["civil"], label: "'civil' as a word" },
  { text: "Charged with criminal breach of trust", want: ["criminal"], label: "'criminal' as a word" },
  { text: "Multiple defaults across lenders", want: ["default"], label: "plural: 'defaults' → default" },
  { text: "Named a wilful defaulter by the bank", want: ["defaulter", "wilful"], label: "two keywords, whole-word" },

  // ── The documented trade-off ──
  // Verb endings are deliberately not matched: the rule that catches
  // "defaulted" also catches "courted". Where a form matters it belongs in the
  // admin-editable keyword list. Pinned so the choice is visible, not lost.
  { text: "He defaulted on the loan", want: [], label: "verb form not matched (deliberate)" },
];

let failures = 0;

for (const c of CASES) {
  const got = matchKeywords(c.text, KEYWORDS).sort();
  const want = [...c.want].sort();
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log(`  ✓ ${c.label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${c.label}\n      "${c.text}"\n      expected [${want}], got [${got}]`);
  }
}

console.log(failures === 0 ? `\n${CASES.length} keyword cases passed` : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
