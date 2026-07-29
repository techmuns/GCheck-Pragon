import type { CollectorResult, RawHit, Subject } from "../types";
import { fetchWithTimeout, type Collector } from "./types";
import { searchWeb } from "./google";
import { searchBingForHost } from "./bing";
import { resolveIdentity } from "./directors";

// ── Company registry collector (free director data) ─────────────────────────
// Directors of UNLISTED Indian companies are the core gap in pre-meeting DD:
// MCA is the authoritative registry but has no free API and blocks scraping
// (its own pages return 403), and every provider that resells it is paid.
//
// This collector uses a free public aggregator that republishes MCA filings and
// server-renders the board as a plain HTML table (Designation / Name / DIN /
// Tenure). Two steps, because the aggregator's company URL requires the CIN:
//   1. Resolve the company NAME to its page URL via the search backend we
//      already use (site-scoped query) — this is how we get from "Reliance
//      Industries" to a CIN without the user knowing it.
//   2. Fetch that page and parse the directors table.
//
// Honest degradation throughout: if the name can't be resolved, or the page
// layout changes and no rows parse, we say so and return zero hits — never a
// guessed board. It is third-party republished data, so hits are cited to the
// aggregator, not presented as MCA-official.

const HOST = "tofler.in";
const CIN_RE = /[A-Z0-9]{21}/;

export const registryCollector: Collector = async ({ subject }) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "registry",
    sourceName: "Company Registry (Tofler)",
    kind: "api",
  };

  // A person has no board of their own, but they do have a registry record —
  // keyed by DIN, listing the companies they sit on. That record is what makes
  // a director search about a person rather than about a spelling.
  if (subject.type === "director") {
    return directorRecord(subject, base);
  }

  const company = subject.company.trim();
  if (!company) {
    return { ...base, status: "skipped", note: "No company to look up.", hits: [] };
  }

  try {
    const page = await resolveCompanyUrl(company);
    if (!page) {
      return {
        ...base,
        status: "done",
        note: `Could not find a registry page for "${company}".`,
        hits: [],
        queries: [siteQuery(company)],
      };
    }

    const html = await fetchPage(page.url);
    const directors = parseDirectors(html);

    if (directors.length === 0) {
      return {
        ...base,
        status: "done",
        note: `Registry page found for "${company}" but no directors could be read from it.`,
        hits: [],
        queries: [siteQuery(company)],
      };
    }

    const hits: RawHit[] = directors.map((d) => ({
      title: [d.name, d.designation, d.din ? `DIN ${d.din}` : "", d.tenure ? `${d.tenure} tenure` : ""]
        .filter(Boolean)
        .join(" — "),
      url: page.url,
      entity: company,
      // Keep the parsed fields discrete (not only baked into the title) so the
      // brief can render a clean Name / Role / Tenure people table.
      extra: { category: "director", name: d.name, din: d.din, designation: d.designation, tenure: d.tenure, cin: page.cin },
    }));

    return {
      ...base,
      status: "done",
      note: `${directors.length} director(s) from the public registry record${page.cin ? ` (CIN ${page.cin})` : ""}.`,
      hits,
      queries: [siteQuery(company)],
    };
  } catch (err) {
    return {
      ...base,
      status: "error",
      note: `Registry lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      hits: [],
    };
  }
};

// ── Director mode: the person's own registry record ─────────────────────────

/**
 * The registry record for an individual: their DIN and the companies they are
 * on the board of. By the time this runs the workflow has usually resolved the
 * identity already, so the lookup is a cache hit — but it is repeated here
 * rather than passed in, so the collector still works standalone.
 *
 * When nothing resolves we say so in the words that matter to the reader: the
 * rest of the brief was gathered on the name alone, and a name is shared.
 */
async function directorRecord(
  subject: Subject,
  base: Omit<CollectorResult, "status" | "hits">,
): Promise<CollectorResult> {
  const name = subject.company.trim();
  if (!name && !subject.din) {
    return { ...base, status: "skipped", note: "No director to look up.", hits: [] };
  }

  try {
    const identity = await resolveIdentity({
      name,
      din: subject.din,
      anchorCompany: subject.anchors?.[0],
    });

    if (!identity) {
      return {
        ...base,
        status: "done",
        note: `No registry record matched "${name}". The rest of this brief was gathered on the name alone, so it may include other people with the same name.`,
        hits: [],
      };
    }

    const { chosen, candidates, ambiguous } = identity;
    // The identity itself, so the brief can state who this person is by id
    // rather than by spelling.
    const hits: RawHit[] = [
      {
        title: `${chosen.name} — DIN ${chosen.din}`,
        url: chosen.url,
        entity: chosen.name,
        extra: { category: "identity", name: chosen.name, din: chosen.din },
      },
      ...chosen.companies.map((company) => ({
        title: company,
        url: chosen.url,
        entity: chosen.name,
        extra: { category: "directorship", name: chosen.name, din: chosen.din, company },
      })),
    ];

    // Never silently pick between namesakes. Say how many there were and how to
    // settle it — the DIN is right there in the note to paste back into search.
    const ambiguityNote = ambiguous
      ? ` ${candidates.length} directors share this name — this brief follows DIN ${chosen.din}. Search a DIN directly to pick another: ${candidates
          .slice(0, 4)
          .map((c) => c.din)
          .join(", ")}.`
      : "";
    const companyNote =
      chosen.companies.length > 0
        ? `${chosen.companies.length} company record(s) linked to DIN ${chosen.din}.`
        : `Matched DIN ${chosen.din}, but no company list could be read from the record.`;

    return { ...base, status: "done", note: `${companyNote}${ambiguityNote}`, hits };
  } catch (err) {
    return {
      ...base,
      status: "error",
      note: `Director lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      hits: [],
    };
  }
}

// ── Step 1: name → company page URL ─────────────────────────────────────────

function siteQuery(company: string): string {
  return `site:${HOST} "${company}" company`;
}

interface PageRef {
  url: string;
  cin?: string;
}

// The aggregator's company URL is /<slug>/company/<CIN>; a slug-only URL serves
// an empty JS shell, so the CIN is required. A site-scoped search yields it.
//
// The search chain is tried first; if it fails or finds nothing (the keyless
// engine rate-limits aggressively), a direct Bing HTML query is tried as a
// second opinion so one throttled engine doesn't sink the whole lookup.
//
// Goes through searchWeb rather than a single backend: calling one backend
// directly meant this lookup neither degraded when that backend was down nor
// shared the cache, so it spent a metered call on every run.
async function resolveCompanyUrl(company: string): Promise<PageRef | null> {
  const query = siteQuery(company);

  try {
    const found = pickCompanyUrl(await searchWeb(query));
    if (found) return found;
  } catch {
    /* fall through to the secondary resolver */
  }

  try {
    return pickCompanyUrl((await searchBingForHost(query, HOST)).map((url) => ({ url })));
  } catch {
    return null;
  }
}

/** First result that looks like a /<slug>/company/<CIN> page. */
function pickCompanyUrl(results: Array<{ url?: string }>): PageRef | null {
  const re = new RegExp(`${HOST.replace(".", "\\.")}/([a-z0-9-]+)/company/(${CIN_RE.source})`, "i");
  for (const r of results) {
    const m = (r.url ?? "").match(re);
    if (m) {
      return { url: `https://www.${HOST}/${m[1]}/company/${m[2].toUpperCase()}`, cin: m[2].toUpperCase() };
    }
  }
  return null;
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, { timeoutMs: 20000, headers: { accept: "text/html" } });
  if (!res.ok) throw new Error(`page ${res.status}`);
  return res.text();
}

// ── Step 2: parse the directors table ───────────────────────────────────────

interface Director {
  name: string;
  designation?: string;
  din?: string;
  tenure?: string;
}

// The board renders as a table headed Designation / Name / DIN-PAN / Tenure.
// Anchored on that header so we don't grab an unrelated table; if the layout
// changes, this returns [] and the collector reports it honestly.
function parseDirectors(html: string): Director[] {
  const start = html.search(/<th[^>]*>\s*Designation/i);
  if (start < 0) return [];
  const end = html.indexOf("</table>", start);
  const table = html.slice(start, end < 0 ? undefined : end);

  const out: Director[] = [];
  const seen = new Set<string>();
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => text(c[1]));
    if (cells.length < 3) continue;
    const [designation, rawName, din, tenure] = cells;
    // The name cell also carries badges ("Shareholder") — keep the leading name.
    const name = rawName.replace(/\s*\b(Shareholder|Signatory)\b\s*/gi, " ").trim();
    if (!name) continue;
    const key = `${name}|${din}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      designation: designation || undefined,
      din: /^[0-9A-Z]{6,}$/i.test(din) ? din : undefined,
      tenure: tenure || undefined,
    });
  }
  return out;
}

/** Strip tags/entities and collapse whitespace in one table cell. */
function text(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
