// ── Director identity, read out of the one search box ──────────────────────
// Director mode has a single free-text field, and a person's name is not an
// identity: three registered directors can share "Rajesh Kumar", and a web
// sweep on the bare name blends all three into one brief.
//
// Every registered Indian director has a DIN — a permanent 8-digit id, unique
// to one person. This module is the small grammar that lets that id travel
// through the existing single field without adding a second input:
//
//   "Mukesh Ambani"                                  → name only (as before)
//   "Mukesh Ambani · DIN 00001695 · Reliance"        → what autocomplete offers
//   "00001695" / "DIN 00001695" / "1695"             → a DIN typed directly
//   "Rajesh Kumar, Bajaj Finance"                    → name anchored to a company
//
// Pure and dependency-free on purpose: the server parses submissions with it,
// and the front page uses it to show a clean name in the countdown and the
// recent-searches list rather than the decorated suggestion string.

/** Separator between the parts of an autocomplete suggestion. */
export const SUGGESTION_SEP = " · ";

export interface DirectorInput {
  /** The person's name, with any DIN / company decoration stripped off. */
  name: string;
  /** 8-digit DIN, when the input carried one. */
  din?: string;
  /** A company the user tied the person to — used to pick between namesakes. */
  anchorCompany?: string;
}

/** A DIN is exactly 8 digits. Accept the sloppy forms people actually type —
 *  "DIN 00001695", "00001695", or "1695" with the leading zeros dropped — and
 *  normalise them all to the canonical padded form. Anything longer than 8
 *  digits is not a DIN (a CIN or a PAN, most likely), so it is refused rather
 *  than truncated into a valid-looking one. */
export function normaliseDin(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 8) return undefined;
  return digits.padStart(8, "0");
}

/** Does this whole string read as a DIN and nothing else? */
function isBareDin(s: string): boolean {
  return /^(din[\s:.-]*)?\d{1,8}$/i.test(s.trim());
}

// Words that mark the tail of "Name, Something" as a company rather than part
// of the person's name — so "Kumar, Rajesh" (surname first) isn't mistaken for
// a person anchored to a company called "Rajesh".
const COMPANY_HINTS = /\b(ltd|limited|pvt|private|llp|inc|corp|corporation|company|industries|technologies|holdings|ventures|capital|bank|group|enterprises|solutions|services|systems|labs|foundation|trust)\b/i;

/** Read whatever the user (or the autocomplete) put in the box. */
export function parseDirectorInput(raw: string): DirectorInput {
  const input = raw.trim();
  if (!input) return { name: "" };

  // 1. An autocomplete suggestion — "Name · DIN 00001695 · Company".
  if (input.includes("·")) {
    const parts = input.split("·").map((p) => p.trim()).filter(Boolean);
    const dinPart = parts.find((p) => /^din\b/i.test(p));
    const rest = parts.filter((p) => p !== dinPart);
    return {
      name: rest[0] ?? "",
      din: dinPart ? normaliseDin(dinPart) : undefined,
      anchorCompany: rest.slice(1).join(", ") || undefined,
    };
  }

  // 2. A DIN typed on its own. No name yet — the workflow resolves it to one.
  if (isBareDin(input)) {
    return { name: "", din: normaliseDin(input) };
  }

  // 3. "Name, Company" / "Name @ Company". Only read the tail as a company when
  //    it actually looks like one; a two-part personal name must stay a name.
  const split = input.match(/^(.+?)\s*[,@]\s*(.+)$/);
  if (split) {
    const [, head, tail] = split;
    const looksLikeCompany = COMPANY_HINTS.test(tail) || tail.trim().split(/\s+/).length >= 2;
    if (looksLikeCompany) return { name: head.trim(), anchorCompany: tail.trim() };
    // Surname-first ("Kumar, Rajesh") — one name, comma and all.
    return { name: `${head.trim()} ${tail.trim()}` };
  }

  // 4. Just a name — exactly what the box did before any of this existed.
  return { name: input };
}

/** Render a resolved director as the string the suggestion list shows and the
 *  box carries. Kept in one place so `parseDirectorInput` can always read back
 *  what this wrote. */
export function formatSuggestion(c: { name: string; din?: string; companies?: string[] }): string {
  const parts = [c.name];
  if (c.din) parts.push(`DIN ${c.din}`);
  const company = c.companies?.[0];
  if (company) parts.push(company);
  return parts.join(SUGGESTION_SEP);
}

/** The clean person-name to *display* for whatever is in the box. Used by the
 *  front page so the countdown and recent-searches list never show the DIN
 *  decoration back to the user. A bare DIN has no name to show yet, so it
 *  shows as itself until the run resolves one. */
export function displayName(raw: string): string {
  const parsed = parseDirectorInput(raw);
  return parsed.name || raw.trim();
}

/** Turn a URL slug back into a readable name — "mukesh-dhirubhai-ambani". */
export function deslug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}
