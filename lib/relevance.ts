// ── What is not a concern ───────────────────────────────────────────────────
// A governance sweep searches on words like "legal", "compliance" and "court".
// Those words are everywhere in ordinary corporate life, and the sweep was
// filing the results as adverse findings. A real run put three items under
// "Key concerns": one genuine fraud allegation, a law firm's press release
// congratulating itself on advising the company's USD 12m raise, and a JOB
// POSTING for a Legal & Compliance Manager.
//
// That is worse than a wasted line. A partner scanning for red flags who finds
// a recruitment ad in the list stops trusting the two items beside it, and the
// funding announcement is not merely neutral — it is good news, filed as bad.
//
// These page types are structurally recognisable, so they are recognised. The
// test is deliberately conservative: it must be sure enough to overrule a
// keyword hit, so it looks for the phrasings these pages actually use rather
// than for a stray word that might appear in real coverage.

export type NonAdverseKind = "recruitment" | "advisory-pr" | "funding" | "directory";

/** What the reader is told, when one of these is set aside. */
export const NON_ADVERSE_REASON: Record<NonAdverseKind, string> = {
  recruitment: "A job posting, not a governance matter",
  "advisory-pr": "An adviser's announcement of its own mandate, not an adverse matter",
  funding: "A funding or commercial announcement, not an adverse matter",
  directory: "A directory or profile listing, not a report of anything",
};

/** Hiring pages. "Apply now", "we're hiring", a role title in the heading. */
const RECRUITMENT = [
  /\b(job|career|vacanc|hiring|recruit)\w*\b/i,
  /\bapply (now|here|online)\b/i,
  /\b(full|part)[- ]time\b/i,
  /\b(years? of experience|ctc|salary range|job description)\b/i,
  /\b(role|position|opening)\s*[@:]\s*/i,
];

/** An adviser announcing a mandate — law firms, bankers, auditors. The tell is
 *  the first person: they are pleased to have advised SOMEONE ELSE. */
const ADVISORY_PR = [
  /\b(is|are|we're|we are)\s+(delighted|pleased|excited|proud|happy)\s+to\s+have\s+(advised|acted|represented|assisted)\b/i,
  /\b(advised|acted for|represented)\s+.{0,60}\bon (its|their|the)\b/i,
  /\b(legal counsel|deal counsel|transaction advis|exclusive financial advis)\w*\b/i,
];

/** Money coming IN. A raise is not an adverse event. */
const FUNDING = [
  /\b(raises?|raised|secures?|secured|closes?|closed)\s+(an?\s+)?(usd|us\$|\$|inr|rs\.?|₹)?\s?[\d.,]+\s*(million|mn|billion|bn|crore|cr)\b/i,
  /\b(series\s+[a-z]\b|seed round|pre-seed|funding round|fundraise)\b/i,
  /\bvaluation of\b/i,
];

/** Aggregator listings that report nothing — ratings pages, company directories. */
const DIRECTORY = [
  /\b(ratings?\s*&?\s*reviews?|write a review|customer reviews)\b/i,
  /\b(company profile|about us|contact us|find us on)\b/i,
];

const RULES: Array<[NonAdverseKind, RegExp[]]> = [
  ["recruitment", RECRUITMENT],
  ["advisory-pr", ADVISORY_PR],
  ["funding", FUNDING],
  ["directory", DIRECTORY],
];

/** Host paths that are recruitment or directory by construction. */
const URL_HINTS: Array<[NonAdverseKind, RegExp]> = [
  ["recruitment", /(naukri|indeed|linkedin\.com\/jobs|glassdoor|shine\.com|monsterindia|\/careers?\/|\/jobs?\/)/i],
  ["directory", /(justdial|sulekha|mouthshut|trustpilot|\/reviews?\/)/i],
];

/**
 * The kind of page this is, when it is one that cannot be an adverse finding.
 *
 * Returns undefined for everything else — including anything that also carries
 * a genuinely adverse signal, because a funding round announced by a company
 * that is simultaneously under investigation is still a story about the
 * investigation. The adverse words win.
 */
export function nonAdverseKind(title: string, url?: string, snippet?: string): NonAdverseKind | undefined {
  const text = `${title} ${snippet ?? ""}`;

  // An unambiguous adverse signal overrules everything below it.
  if (/\b(fraud|arrest|money laundering|investigat\w+|prosecut\w+|convict\w+|penalt\w+|default\w*|insolven\w+|raid|summon\w*)\b/i.test(text)) {
    return undefined;
  }

  for (const [kind, re] of URL_HINTS) {
    if (url && re.test(url)) return kind;
  }
  for (const [kind, patterns] of RULES) {
    if (patterns.some((re) => re.test(text))) return kind;
  }
  return undefined;
}
