// ── Concern attribution check ───────────────────────────────────────────────
// Who a matter belongs to is the single most consequential sentence the brief
// writes about a person, and it used to be read from the wrong field. A hit
// carries `entity` — the entity whose QUERY found it — and a director sweep
// searches the person, so cases their COMPANY is party to all arrive stamped
// with the director's name. Read as authorship, that made
// "Reliance Jio Infocomm Limited vs State Of Kerala" the individual's own
// exposure, in a brief that then priced it into his risk score.
//
// Both directions are pinned here: a company's case must never be charged to
// the person, and the person's own matter must still be.
//
//   npm run check:attribution

import { listConcerns } from "../lib/printBrief";
import type { Run } from "../lib/types";

const CASE_URL = "https://indiankanoon.org/doc/90611123/";

/** A director run whose court sweep returned a case the COMPANY is party to. */
function directorRun(opts: {
  confidence?: "confirmed" | "unverified";
  caseTitle: string;
  findingText: string;
}): Run {
  return {
    id: "check",
    status: "complete",
    subject: { type: "director", company: "AKASH MUKESH AMBANI", promoters: [], din: "06984194" },
    progress: [],
    collected: [
      {
        sourceId: "indiankanoon",
        sourceName: "Court Cases",
        kind: "api",
        status: "done",
        hits: [
          {
            title: opts.caseTitle,
            url: CASE_URL,
            // Query provenance, NOT the party. This is the field that misled.
            entity: "AKASH MUKESH AMBANI",
            confidence: opts.confidence,
          },
        ],
      },
    ],
    brief: {
      verdict: "amber",
      headline: "",
      citations: [{ ref: 13, sourceName: "Indian Kanoon", label: "case", url: CASE_URL }],
      sections: [
        {
          id: "red-flags",
          title: "Key Concerns",
          findings: [{ severity: "amber", text: opts.findingText, url: CASE_URL, sourceRef: 13 }],
        },
      ],
    },
  } as unknown as Run;
}

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  if (actual === expected) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function namesOf(run: Run): string | undefined {
  return listConcerns(run)[0]?.facts.find((f) => f.label === "Names")?.value;
}

function whyOf(run: Run): string {
  return listConcerns(run)[0]?.whyItMatters ?? "";
}

// ── A company's case is the company's, however it was found ──
const COMPANY_CASE = {
  caseTitle: "Reliance Jio Infocomm Limited vs State Of Kerala",
  findingText: "Reliance Jio Infocomm Limited is involved in multiple legal cases",
};

for (const confidence of ["confirmed", "unverified", undefined] as const) {
  const run = directorRun({ ...COMPANY_CASE, confidence });
  check(
    `company case names the company (confidence=${String(confidence)})`,
    namesOf(run),
    "Reliance Jio Infocomm Limited",
  );
  check(
    `consequence is written about the company (confidence=${String(confidence)})`,
    /exposure on Reliance Jio Infocomm Limited/.test(whyOf(run)),
    true,
  );
}

// ── The person's own matter must still reach them ──
const PERSONAL_CASE = {
  caseTitle: "AKASH MUKESH AMBANI vs Registrar Of Companies",
  findingText: "AKASH MUKESH AMBANI is named in a pending matter",
};

check(
  "the subject's own matter is still attributed to them",
  namesOf(directorRun({ ...PERSONAL_CASE, confidence: "confirmed" })),
  "The individual",
);

// A hit the sweep could tie to the name and nothing else may be a different
// person of that name — the namesake the grade exists to warn about.
check(
  "a possible namesake is not claimed as the subject",
  namesOf(directorRun({ ...PERSONAL_CASE, confidence: "unverified" })),
  "AKASH MUKESH AMBANI",
);

console.log(failures === 0 ? "\nattribution follows the matter, not the query" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
