import type { RawHit, Run } from "./types";
import type { PartySide } from "./collectors/judgment";

// ── Court cases, as a table a partner can act on ───────────────────────────
// The litigation section used to print cause titles as bullets:
//
//     • Indiamart Intermesh Ltd vs Puma Se on 2 June, 2025
//     • Indiamart Intermesh Limited vs Ankit & Ors on 7 February, 2024
//
// Which is the registry's filing label, not an answer. It does not say who
// brought the matter, who is defending, before which court, under what number,
// or whether it is still running — and every one of those is a question that
// gets asked out loud in the meeting the brief is written for.
//
// This assembles the same cases into rows, from the facts read off the
// judgments (lib/collectors/judgment.ts) with the cause title as the fallback.
// Every field is either something a document stated or absent; nothing is
// filled in by inference.

/** Legal words, in the English a non-litigator uses. Kept alongside the exact
 *  term rather than instead of it, because counsel will use the exact one. */
const ROLE_PLAIN: Record<PartySide, { plain: string; brought: boolean }> = {
  appellant: { plain: "Brought the appeal", brought: true },
  petitioner: { plain: "Brought the case", brought: true },
  plaintiff: { plain: "Brought the case", brought: true },
  applicant: { plain: "Brought the application", brought: true },
  respondent: { plain: "Defending", brought: false },
  defendant: { plain: "Defending", brought: false },
};

export interface CourtCaseRow {
  /** The case as the registry files it. */
  title: string;
  /** One plain sentence: who did what to whom. */
  summary: string;
  /** The side that started it, and the side answering — as the judgment listed
   *  them, so a reader can check the row against the document. */
  claimant?: string;
  defendant?: string;
  /** Where the SUBJECT sits, in plain English. */
  subjectRole?: string;
  /** The exact legal term for that position ("Appellant"), for counsel. */
  subjectSide?: string;
  /** True when the subject is answering rather than bringing. Drives tone: a
   *  company pursuing a claim is not a company under one. */
  defending?: boolean;
  court?: string;
  caseNumber?: string;
  /** ISO date the judgment was delivered, where one was read. */
  decidedOn?: string;
  /** "Decided 2 Jun 2025" / "Before the court" — never "live" for a matter the
   *  document says was decided. */
  status: string;
  bench?: string;
  counsel?: string;
  url?: string;
  ref?: number;
  /** The judgment was opened and parsed, as opposed to title-only. Lets the UI
   *  be honest about which rows are thin. */
  readFromJudgment: boolean;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** "2025-06-02" → "2 Jun 2025". Anything unparseable is passed through. */
export function prettyDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** The date a cause title carries, when no judgment was read. */
function dateFromTitle(title: string): string | undefined {
  const m = /on\s+(\d{1,2}\s+[A-Za-z]+,?\s+\d{4})/.exec(title);
  return m ? m[1].replace(/,/g, "") : undefined;
}

/** The case, minus the trailing "on <date>" the registry appends. */
function nameFromTitle(title: string): string {
  return title.replace(/\s+on\s+\d{1,2}\s+[A-Za-z]+,?\s+\d{4}\s*$/, "").trim();
}

/** Strip the "(appellant)" suffix the collector stores parties with. */
function partyName(entry: string): string {
  return entry.replace(/\s*\([a-z]+\)\s*$/i, "").trim();
}

function sideOfEntry(entry: string): string | undefined {
  return /\(([a-z]+)\)\s*$/i.exec(entry)?.[1]?.toLowerCase();
}

/**
 * One row per case.
 *
 * `subjectName` is what the run is about, so the summary can say "IndiaMART
 * brought this against Puma SE" rather than restating the cause title.
 */
export function buildCourtCases(hits: RawHit[], subjectName: string, refByUrl?: Map<string, number>): CourtCaseRow[] {
  return hits.map((h) => {
    const title = h.title ?? "";
    const parties = list(h.extra?.parties);
    const side = str(h.extra?.side)?.toLowerCase() as PartySide | undefined;
    const decidedOn = str(h.extra?.decidedOn);
    const bench = list(h.extra?.bench);
    const counsel = list(h.extra?.counsel);
    const readFromJudgment = parties.length > 0 || Boolean(h.extra?.caseNumber);

    // The two sides, as the judgment listed them.
    const bringing = parties.find((p) => {
      const s = sideOfEntry(p);
      return s ? ROLE_PLAIN[s as PartySide]?.brought : false;
    });
    const answering = parties.find((p) => {
      const s = sideOfEntry(p);
      return s ? ROLE_PLAIN[s as PartySide]?.brought === false : false;
    });

    const role = side ? ROLE_PLAIN[side] : undefined;
    const claimant = bringing ? partyName(bringing) : undefined;
    const defendant = answering ? partyName(answering) : undefined;

    // Plain English, built only from what is known. Where the judgment was not
    // read this falls back to the cause title, which is what the brief showed
    // before — thinner, never wrong.
    let summary: string;
    if (role && claimant && defendant) {
      summary = role.brought
        ? `${subjectName} brought this case against ${defendant}.`
        : `${claimant} brought this case against ${subjectName}.`;
    } else if (claimant && defendant) {
      summary = `${claimant} brought this case against ${defendant}.`;
    } else {
      summary = nameFromTitle(title);
    }

    const decidedPretty = prettyDate(decidedOn) ?? dateFromTitle(title);
    // A matter the document says was decided is not "live", and calling it live
    // is the kind of error that gets repeated out loud in a meeting.
    const status = decidedOn
      ? `Decided ${prettyDate(decidedOn)}`
      : decidedPretty
        ? `On record — last dated ${decidedPretty}`
        : "On record";

    return {
      title: nameFromTitle(title),
      summary,
      claimant,
      defendant,
      subjectRole: role?.plain,
      subjectSide: side ? side.charAt(0).toUpperCase() + side.slice(1) : undefined,
      defending: role ? !role.brought : undefined,
      court: str(h.extra?.court),
      caseNumber: str(h.extra?.caseNumber),
      decidedOn,
      status,
      bench: bench.length > 0 ? bench.join(", ") : undefined,
      counsel: counsel.length > 0 ? counsel.join(" · ") : undefined,
      url: h.url,
      ref: h.url ? refByUrl?.get(h.url) : undefined,
      readFromJudgment,
    };
  });
}

/** The litigation hits on a run, whichever shape the collector left them in. */
export function courtHitsOf(run: Run): RawHit[] {
  const ik = (run.collected ?? []).find((c) => c.sourceId === "indiankanoon");
  return ik?.status === "done" ? ik.hits : [];
}
