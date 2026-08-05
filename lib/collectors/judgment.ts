// ── Reading the judgment, not the case title ────────────────────────────────
// A cause-list title says a matter exists and nothing else. "Indiamart
// Intermesh Ltd vs Puma Se" does not say which side the subject is on, what was
// sought, who heard it, or how it ended — and those are the whole content of
// the question a partner is about to ask in the meeting.
//
// The judgment page carries all of it, in a layout that is remarkably stable
// across Indian courts because it is the courts' own formatting:
//
//     IN THE HIGH COURT OF DELHI AT NEW DELHI
//     Judgement delivered on: 02.06.2025
//     FAO(OS) (COMM) 6/2024, CM APPL. 2216 & 2219 of 2024
//     INDIAMART INTERMESH LTD.              ..... Appellant
//                     Versus
//     PUMA SE                               ..... Respondent
//     CORAM:
//     HON'BLE MR. JUSTICE VIBHU BAKHRU
//
// So these facts are parsed, not inferred. That matters more here than
// anywhere else in the pipeline: a governance brief that states the wrong side
// of a case is worse than one that says nothing, and an extraction model asked
// "who brought this?" will answer confidently either way. Everything below is
// read off the document's own words or left undefined — there is no guessing,
// and a page that does not match simply yields fewer fields.

/** Which side of the matter a party is on, as the cause title words it. */
export type PartySide =
  | "appellant"
  | "respondent"
  | "petitioner"
  | "plaintiff"
  | "defendant"
  | "applicant";

export interface JudgmentParty {
  name: string;
  side: PartySide;
}

export interface JudgmentFacts {
  /** "High Court of Delhi at New Delhi", "Supreme Court of India". */
  court?: string;
  /** "FAO(OS) (COMM) 6/2024" — the number the registry files it under. */
  caseNumber?: string;
  /** As printed on the judgment, normalised to YYYY-MM-DD where readable. */
  decidedOn?: string;
  parties: JudgmentParty[];
  /** The judges who heard it. */
  bench: string[];
  /** Counsel, by the side they appeared for. */
  counsel: Array<{ side: string; advocates: string }>;
}

const SIDES: PartySide[] = ["appellant", "respondent", "petitioner", "plaintiff", "defendant", "applicant"];

/** Collapse the runs of whitespace a scraped judgment is full of, per line. */
function lines(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};

/** A date as courts print it — 02.06.2025, 2nd June 2025, 18 April, 2024 — as
 *  YYYY-MM-DD. Returns the raw text when it cannot be read, because showing the
 *  date the document actually carries beats showing none. */
export function normaliseJudgmentDate(raw: string): string | undefined {
  const text = raw.trim();
  if (!text) return undefined;

  const numeric = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/.exec(text);
  if (numeric) {
    const [, d, m, y] = numeric;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const worded = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})/.exec(text);
  if (worded) {
    const month = MONTHS[worded[2].toLowerCase()];
    if (month) return `${worded[3]}-${month}-${worded[1].padStart(2, "0")}`;
  }
  return text.slice(0, 40);
}

/** The court, from the heading courts put at the top of every judgment. */
function readCourt(ls: string[]): string | undefined {
  for (const l of ls.slice(0, 40)) {
    const m = /^(?:\*\s*)?IN THE (.+?)\s*$/i.exec(l);
    if (m && /court|tribunal|commission|forum/i.test(m[1])) {
      return titleCase(m[1].replace(/\s*[:,]\s*$/, ""));
    }
  }
  return undefined;
}

/** The delivery date, however the registry labelled it. */
function readDate(ls: string[]): string | undefined {
  const LABEL =
    /(?:judg?e?ment|order|decision)\s*(?:was\s*)?(?:delivered|pronounced|reserved)?\s*on\s*:?\s*(.+)$|date of (?:decision|judgment|order)\s*:?\s*(.+)$/i;
  for (const l of ls.slice(0, 60)) {
    const m = LABEL.exec(l);
    const raw = m?.[1] ?? m?.[2];
    if (raw && /\d/.test(raw)) return normaliseJudgmentDate(raw);
  }
  return undefined;
}

/** The registry's own number for the matter. */
function readCaseNumber(ls: string[]): string | undefined {
  // Case types as the registries abbreviate them, followed by a number/year.
  const RE =
    /\b((?:FAO|RFA|CS|CM|CRL|CRP|CWP|WP|SLP|LPA|CA|CO|OMP|ARB|IA|MAT|TR|EFA|RSA)[A-Z()\s.]{0,12}\s*(?:No\.?\s*)?\d+\s*(?:of\s*|\/)\s*\d{4})/i;
  for (const l of ls.slice(0, 60)) {
    const m = RE.exec(l);
    if (m) return m[1].replace(/\s+/g, " ").trim();
  }
  return undefined;
}

/**
 * The parties, from the cause title.
 *
 * The dotted leader ("….. Appellant") is the courts' own convention for it and
 * is what makes this readable without guessing. Some pages print the side on
 * the following line instead, so that shape is accepted too.
 */
function readParties(ls: string[]): JudgmentParty[] {
  const out: JudgmentParty[] = [];
  const sideWord = SIDES.join("|");
  const inline = new RegExp(`^(.+?)\\s*\\.{2,}\\s*(${sideWord})s?\\b`, "i");
  const bare = new RegExp(`^(${sideWord})s?\\b`, "i");

  for (let i = 0; i < Math.min(ls.length, 80); i++) {
    const l = ls[i];
    const m = inline.exec(l);
    if (m) {
      const name = cleanParty(m[1]);
      if (name) out.push({ name, side: m[2].toLowerCase() as PartySide });
      continue;
    }
    // "PUMA SE" on one line, "..... Respondent" on the next.
    const next = ls[i + 1];
    if (next && /^\.{2,}\s*/.test(next)) {
      const side = bare.exec(next.replace(/^\.{2,}\s*/, ""));
      const name = cleanParty(l);
      if (side && name) out.push({ name, side: side[1].toLowerCase() as PartySide });
    }
  }

  // Dedupe on name+side — cause titles repeat parties in the memo of parties.
  const seen = new Set<string>();
  return out.filter((p) => {
    const key = `${p.name.toLowerCase()}|${p.side}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanParty(raw: string): string | undefined {
  const name = raw
    .replace(/^[*%+\d.\s]+/, "")
    .replace(/\s*(?:&|and)\s*(?:ors?|anr)\.?$/i, "")
    .replace(/\s*\.{2,}.*$/, "")
    .replace(/\s*[:,]\s*$/, "")
    .trim();
  if (name.length < 2 || name.length > 120) return undefined;
  if (/^(versus|vs\.?|coram|judgment|order)$/i.test(name)) return undefined;
  return titleCase(name);
}

/** The bench, from the CORAM block. */
function readBench(ls: string[]): string[] {
  const out: string[] = [];
  for (const l of ls.slice(0, 90)) {
    const m = /HON[’'`]?BLE\s+(?:MR\.?|MS\.?|MRS\.?|DR\.?|JUSTICE|THE)?\s*(?:JUSTICE\s+)?(.+?)\s*$/i.exec(l);
    if (!m) continue;
    const name = m[1].replace(/^(?:MR\.?|MS\.?|MRS\.?|DR\.?|JUSTICE)\s+/i, "").replace(/[,.]$/, "").trim();
    if (name && name.length <= 60 && !out.includes(titleCase(name))) out.push(titleCase(name));
  }
  return out;
}

/** Counsel, by the side they appeared for. */
function readCounsel(ls: string[]): Array<{ side: string; advocates: string }> {
  const out: Array<{ side: string; advocates: string }> = [];
  for (const l of ls.slice(0, 90)) {
    const m = /^For the ([A-Za-z/ ]+?)\s*:?\s{1,}(.+)$/i.exec(l);
    if (!m) continue;
    const advocates = m[2].replace(/\s*,?\s*Advocates?\.?$/i, "").trim();
    if (advocates.length > 2) out.push({ side: titleCase(m[1].trim()), advocates: advocates.slice(0, 240) });
  }
  return out;
}

function titleCase(s: string): string {
  // Judgments are largely upper-case; leave mixed-case text as the source wrote
  // it, since that casing is usually deliberate ("PUMA SE", "IndiaMART").
  if (!/[a-z]/.test(s)) {
    return s
      .toLowerCase()
      .replace(/\b([a-z])/g, (c) => c.toUpperCase())
      .replace(/\b(Of|The|At|And|In|Vs)\b/g, (w) => w.toLowerCase())
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
  }
  return s.trim();
}

/** Everything the judgment states about itself. Fields it does not carry are
 *  simply absent — nothing here is inferred. */
export function parseJudgment(text: string): JudgmentFacts {
  const ls = lines(text);
  return {
    court: readCourt(ls),
    caseNumber: readCaseNumber(ls),
    decidedOn: readDate(ls),
    parties: readParties(ls),
    bench: readBench(ls),
    counsel: readCounsel(ls),
  };
}

/**
 * Which side the subject is on — the single fact that decides how the matter
 * reads. Matched through the same entity test the rest of the pipeline uses, so
 * "INDIAMART INTERMESH LTD." on the judgment is recognised as the subject typed
 * as "IndiaMART InterMESH".
 */
export function sideOf(
  facts: JudgmentFacts,
  subjectName: string,
  namesEntity: (text: string, entity: string) => boolean,
): PartySide | undefined {
  for (const p of facts.parties) {
    if (namesEntity(p.name, subjectName)) return p.side;
  }
  return undefined;
}

/** Whether being on this side means the subject is defending rather than
 *  bringing the matter. Drives how the finding is worded and weighed: a company
 *  that FILED an appeal is not a company that has been sued. */
export function isDefendingSide(side: PartySide | undefined): boolean {
  return side === "respondent" || side === "defendant";
}

/** One line a reader can act on, built only from fields the document carried. */
export function summariseJudgment(
  facts: JudgmentFacts,
  side: PartySide | undefined,
  subjectName: string,
): string {
  const other = facts.parties.find((p) => p.side !== side)?.name;
  const parts: string[] = [];

  if (side) {
    parts.push(`${subjectName} is the ${side}${other ? ` against ${other}` : ""}`);
  } else if (facts.parties.length >= 2) {
    parts.push(`${facts.parties[0].name} against ${facts.parties[1].name}`);
  }
  if (facts.court) parts.push(`before the ${facts.court}`);
  if (facts.caseNumber) parts.push(`in ${facts.caseNumber}`);
  if (facts.bench.length > 0) parts.push(`heard by ${facts.bench.join(" and ")}`);

  return parts.join(", ");
}
