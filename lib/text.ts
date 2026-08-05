// ── Display text normalisation ───────────────────────────────────────────────
// Registry filings are stored in capitals — "PRAGNESH SHASHIKANT DARJI", "ADANI
// GREEN ENERGY TWENTY FIVE A LIMITED" — and printing them that way makes a brief
// read like a shouted list of strangers. The register's spelling is the fact;
// its casing is not, so it is normalised for display while the underlying value
// (which searches and citations key on) is left exactly as the source gave it.

/** Tokens that are genuinely acronyms and must not be title-cased. */
const KEEP_UPPER = new Set([
  "DIN", "CIN", "LLP", "LLC", "PLC", "SEBI", "NCLT", "NCLAT", "SFIO", "CBI", "ED", "EOW",
  "RBI", "ROC", "MCA", "GST", "IPO", "AGM", "US", "USA", "UK", "UAE", "IT", "HR", "CEO",
  "CFO", "CTO", "COO", "MD", "AI", "ESG", "NBFC", "IBC", "DRT", "SAT", "ITAT", "PSU",
  "HDFC", "ICICI", "SBI", "LIC", "ONGC", "NTPC", "GAIL", "BSE", "NSE", "TCS", "HCL",
  "ABB", "JSW", "NMDC", "REC", "PVT", "SEC",
]);

/** Words that stay lower-case inside a name, unless they lead it. */
const MINOR = new Set(["and", "of", "the", "for", "in", "on", "at", "to", "a", "an", "&"]);

function fixWord(word: string, index: number): string {
  if (!word) return word;

  // Preserve anything that isn't a plain alphabetic run — numbers, DINs, codes.
  if (!/^[A-Za-z][A-Za-z'’.-]*$/.test(word)) return word;

  const bare = word.replace(/[^A-Za-z]/g, "");
  if (KEEP_UPPER.has(bare.toUpperCase()) && word === word.toUpperCase()) return word;

  const lower = word.toLowerCase();
  if (index > 0 && MINOR.has(lower)) return lower;

  // Hyphenated and apostrophed names capitalise on each part: "Jean-Paul",
  // "O'Brien" — but not "Darji's".
  return lower
    .split(/([-'’])/)
    .map((part, i, parts) => {
      if (part === "-" || part === "'" || part === "’") return part;
      const prev = parts[i - 1];
      if (prev === "'" || prev === "’") return part; // possessive / contraction tail
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}

/**
 * A name as it should be read.
 *
 * Only reshapes text that is SHOUTING — a string already carrying lower-case
 * letters was written by a human (or a publisher) who meant it that way, and
 * re-casing "McKinsey" or "eClerx" would be a downgrade, not a fix.
 */
export function titleCaseName(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  // Already mixed case — leave it alone.
  if (/[a-z]/.test(s)) return s;
  return s.split(/\s+/).map(fixWord).join(" ");
}

/**
 * Calm the shouting inside a mixed-case sentence.
 *
 * `titleCaseName` deliberately leaves anything containing lower-case alone, so a
 * line like "RAJESH KUMAR VERMA — Managing Director — DIN 00110234" slipped
 * through whole and stayed in capitals on the page. The names inside such a line
 * still need fixing, so this reshapes only the RUNS of consecutive capitalised
 * words — two or more, which is what a name or a company looks like — and
 * leaves a lone acronym (SFIO, CBI, CIN) exactly as it was.
 */
export function humanizeCaps(text: string | undefined): string {
  const s = (text ?? "").trim();
  if (!s) return "";
  return s.replace(/[A-Z][A-Z'’.-]*(?:\s+[A-Z][A-Z'’.-]*)+/g, (run) => {
    // A run made entirely of known acronyms ("US SEC") is not a name.
    const words = run.split(/\s+/);
    if (words.every((w) => KEEP_UPPER.has(w.replace(/[^A-Za-z]/g, "").toUpperCase()))) return run;
    return words.map(fixWord).join(" ");
  });
}

/**
 * Tidy a finding written by the deterministic assembler for display.
 *
 * Two habits of that wording are pure noise on screen. It prefixes the subject's
 * own name to every line — under a card already titled with that name, "PANKAJ
 * KUMAR VERMA: …" three times over is three wasted lines — and it appends the
 * keyword that matched, which is an internal detail of how the hit was found
 * rather than anything the reader can act on.
 */
export function cleanFindingText(text: string, subjectName?: string): string {
  let out = text.trim();

  // Drop a leading "<subject>: " prefix, however the source cased it.
  if (subjectName) {
    const norm = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();
    const prefix = `${norm(subjectName)}:`;
    if (norm(out).startsWith(prefix)) out = out.slice(out.indexOf(":") + 1).trim();
  }

  // Drop the "— matched x, y." tail.
  out = out.replace(/\s*[—-]\s*matched\s+[^.]*\.?\s*$/i, "").trim();

  // A finding that is now just a quoted headline reads better unquoted.
  const quoted = out.match(/^["“](.+)["”]\.?$/);
  if (quoted) out = quoted[1].trim();

  return humanizeCaps(out) || out;
}

/**
 * A duration, as the app has always printed one — "42s", "1m 42s".
 *
 * Kept here rather than beside its first caller because history now prints the
 * same thing ("took 1m 42s") and two hand-rolled duration formats would drift
 * the way two date formats do.
 */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
