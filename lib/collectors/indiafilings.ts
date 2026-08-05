import type { CollectorResult, RawHit, Subject } from "../types";
import { fetchWithTimeout, type Collector, type CollectorContext } from "./types";
import { searchWeb } from "./google";
import { cached } from "../searchCache";
import { normaliseDin } from "../directorId";

// ── MCA registry collector (IndiaFilings) ───────────────────────────────────
// The MCA register is the only place that says, authoritatively, WHICH person a
// DIN belongs to and which companies they sit on. MCA itself has no free API and
// blocks scraping; this aggregator republishes the same filings and — crucially —
// server-renders them.
//
// Two properties make it the right first stop, both verified against the live
// site rather than assumed:
//
//  1. The URL slug is decorative. `/search/<anything>-din-07013291` serves the
//     record for DIN 07013291, and `/search/<anything>-cin-<CIN>` does the same
//     for a company. So when the user typed a DIN we resolve their identity with
//     ONE keyless GET — no search quota, no name guessing, no namesake risk.
//  2. Every page carries a schema.org JSON-LD block. That is a published
//     contract, so it is parsed first and the HTML tables are only used for what
//     JSON-LD omits (entity names and their statuses).
//
// The person's own page is authoritative; the company pages are not. A company
// page can lag years behind — Leaf Studios' page still shows a 2022 board that
// omits a director whose own 2025 record lists Leaf Studios. So the DIN page
// decides who someone is, and company pages are only ever supplementary colour.

const BASE = "https://www.indiafilings.com";
const HOST = "indiafilings.com";

/** A director page URL, from a DIN alone. The slug is ignored by the site. */
export function dinUrl(din: string): string {
  return `${BASE}/search/director-din-${din}`;
}

/** A company page URL, from a CIN alone. */
export function cinUrl(cin: string): string {
  return `${BASE}/search/company-cin-${cin.toUpperCase()}`;
}

/**
 * A CIN as the MCA issues them: listing class, five-digit industry code,
 * two-letter state, four-digit year, three-letter class, six-digit number —
 * L74899DL1999PLC101534. Matched by that structure rather than as "21
 * alphanumerics", so a fragment of something else is never taken for one.
 */
const CIN_RE = /[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}/i;

/** The CIN in whatever the user typed, if they gave one. */
export function cinIn(text: string): string | null {
  const match = CIN_RE.exec(text);
  return match ? match[0].toUpperCase() : null;
}

/** Words that identify no company on their own, so they cannot confirm that a
 *  search result is the entity we asked for. */
const GENERIC_TOKEN = new Set([
  "limited", "ltd", "private", "pvt", "llp", "company", "co", "corp",
  "corporation", "inc", "and", "the", "of",
]);

function significantTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !GENERIC_TOKEN.has(t));
}

/**
 * The queries tried, in order, to find a company's register page.
 *
 * This used to be a single `site:` query, and a single query is a single point
 * of failure: `site:` is a Google operator that not every backend honours, and
 * the web chain now runs on whichever of Munshot, SerpAPI, Firecrawl or the
 * keyless engine is alive. A backend that ignores the operator turns a precise
 * query into a vague one and the register page never surfaces — which reads to
 * the user as "this company is not on the MCA register" when it plainly is.
 *
 * So the ladder degrades deliberately: keep the operator for the backends that
 * honour it, then drop it, then drop the quotes and add the suffix the register
 * actually files companies under. Companies are filed by full legal name, and
 * "IndiaMART InterMESH" is not what the register calls IndiaMART InterMESH
 * Limited. Each rung is only tried if the one above found nothing.
 */
export function registryQueries(company: string): string[] {
  const name = company.trim().replace(/\s+/g, " ");
  const suffixed = /\b(limited|ltd|llp|pvt|private)\b/i.test(name) ? name : `${name} limited`;
  const queries = [
    `site:${HOST} "${name}" cin`,
    `${HOST} "${name}" cin`,
    `indiafilings ${suffixed} cin`,
  ];
  return queries.filter((q, i) => queries.indexOf(q) === i);
}

const PAGE_TIMEOUT_MS = 20000;
/** Company pages are supplementary, so they are strictly budgeted. */
const MAX_COMPANY_PAGES = 6;
/** How many same-name candidates to open before ranking them. */
const MAX_NAME_CANDIDATES = 4;

/** Registry statuses that are a governance signal in their own right. */
const ADVERSE_STATUS = /strike|liquidat|dissolv|defunct|amalgamat|dormant/i;

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface RegistryEntity {
  /** CIN for a company, LLPIN for an LLP. */
  id: string;
  name: string;
  status?: string;
  kind: "company" | "llp";
  url: string;
}

export interface DirectorRecord {
  name: string;
  din: string;
  url: string;
  /** "Approved", "Disqualified", "Deactivated" … as the register words it. */
  dinStatus?: string;
  approvedOn?: string;
  /** The register's own non-compliance flag, when it publishes one. */
  nonCompliant?: boolean;
  entities: RegistryEntity[];
}

export interface CompanyRecord {
  name: string;
  cin?: string;
  url: string;
  status?: string;
  roc?: string;
  incorporatedOn?: string;
  address?: string;
  email?: string;
  authorisedCapital?: string;
  paidUpCapital?: string;
  listing?: string;
  lastAgm?: string;
  directors: Array<{ din: string; name: string; since?: string }>;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

function cellText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

interface Row {
  cells: string[];
  /** The first href inside each cell, where there is one. */
  hrefs: Array<string | undefined>;
}

/** Every table row on the page, as text cells plus the link each cell carries. */
function tableRows(html: string): Row[] {
  const out: Row[] = [];
  for (const tr of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    const hrefs: Array<string | undefined> = [];
    for (const td of tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)) {
      cells.push(cellText(td[1]));
      hrefs.push(td[1].match(/href="([^"]+)"/i)?.[1]);
    }
    if (cells.length > 0) out.push({ cells, hrefs });
  }
  return out;
}

/** Every JSON-LD block on the page that parses. A malformed one is skipped, not
 *  fatal — the HTML fallbacks below still carry the record. */
function jsonLdBlocks(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (parsed && typeof parsed === "object") out.push(parsed);
    } catch {
      /* a block we can't read is simply not used */
    }
  }
  return out;
}

function ldOfType(html: string, type: string): Record<string, unknown> | undefined {
  return jsonLdBlocks(html).find((b) => b["@type"] === type);
}

/** schema.org `additionalProperty` pairs, flattened to a lookup. */
function propMap(ld: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const props = ld?.additionalProperty;
  if (!Array.isArray(props)) return out;
  for (const p of props) {
    const name = (p as Record<string, unknown>)?.name;
    const value = (p as Record<string, unknown>)?.value;
    if (typeof name === "string" && value != null) out[name] = String(value);
  }
  return out;
}

/** A schema.org `identifier` PropertyValue's value. */
function ldIdentifier(ld: Record<string, unknown> | undefined): string | undefined {
  const id = ld?.identifier as Record<string, unknown> | undefined;
  const v = id?.value;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Two-cell rows read as a label → value record ("ROC Code" → "RoC-Delhi"). */
function labelled(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.cells.length === 2 && r.cells[0] && r.cells[1]) out[r.cells[0]] = r.cells[1];
  }
  return out;
}

const ENTITY_HREF = /\/search\/[^"']*?-cin-([A-Z0-9]{21})$/i;
const LLP_HREF = /\/search\/[^"']*?-([A-Z]{3}-\d+)$/i;
const DIN_HREF = /\/search\/[^"']*?-din-(\d{6,8})$/i;

function absolute(href: string): string {
  return href.startsWith("http") ? href : `${BASE}${href}`;
}

/**
 * The director's record: who they are, and every entity the register links to
 * their DIN. Entity names and statuses only exist in the HTML table, so the
 * JSON-LD identity is joined to the table rows rather than replacing them.
 */
export function parseDirectorPage(html: string, url: string): DirectorRecord | null {
  const ld = ldOfType(html, "Person");
  const props = propMap(ld);

  const dinFromUrl = url.match(/-din-(\d{6,8})/i)?.[1];
  const din = normaliseDin(ldIdentifier(ld) ?? dinFromUrl ?? "");
  const name =
    (typeof ld?.name === "string" ? ld.name.trim() : "") ||
    cellText(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "").split("|")[0].trim();

  if (!din || !name) return null;

  const entities: RegistryEntity[] = [];
  const seen = new Set<string>();
  for (const row of tableRows(html)) {
    if (row.cells.length < 3) continue;
    const href = row.hrefs[0] ?? row.hrefs[1];
    if (!href) continue;
    const company = href.match(ENTITY_HREF);
    const llp = company ? null : href.match(LLP_HREF);
    if (!company && !llp) continue;

    const id = (company?.[1] ?? llp?.[1] ?? "").toUpperCase();
    const entityName = row.cells[1];
    if (!id || !entityName || seen.has(id)) continue;
    seen.add(id);
    entities.push({
      id,
      name: entityName,
      status: row.cells[2] || undefined,
      kind: company ? "company" : "llp",
      url: absolute(href),
    });
  }

  const nonCompliantRaw = props["Non Compliant Company"];
  return {
    name,
    din,
    url,
    dinStatus: props["DIN Status"] || undefined,
    approvedOn: props["DIN Approval Date"] || undefined,
    nonCompliant: nonCompliantRaw ? /^yes$/i.test(nonCompliantRaw.trim()) : undefined,
    entities,
  };
}

/** The company's master data and its board as the register last filed it. */
export function parseCompanyPage(html: string, url: string): CompanyRecord | null {
  const ld = ldOfType(html, "Corporation");
  const props = propMap(ld);
  const rows = tableRows(html);
  const kv = labelled(rows);

  const name = (typeof ld?.name === "string" ? ld.name.trim() : "") || kv["Company Name"] || "";
  if (!name) return null;

  const address = ld?.address as Record<string, unknown> | undefined;

  const directors: CompanyRecord["directors"] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.cells.length < 2) continue;
    const href = row.hrefs[0] ?? row.hrefs[1];
    const din = normaliseDin(href?.match(DIN_HREF)?.[1] ?? "");
    if (!din || seen.has(din)) continue;
    const personName = row.cells[1];
    if (!personName) continue;
    seen.add(din);
    directors.push({ din, name: personName, since: row.cells[2] || undefined });
  }

  return {
    name,
    cin: ldIdentifier(ld) ?? kv["CIN"] ?? undefined,
    url,
    status: kv["Company Status (for e-filing)"] || (typeof ld?.legalStatus === "string" ? ld.legalStatus : undefined),
    roc: kv["ROC Code"] || undefined,
    incorporatedOn: kv["Date of Incorporation"] || (typeof ld?.foundingDate === "string" ? ld.foundingDate : undefined),
    address: kv["Registered Address"] || (typeof address?.streetAddress === "string" ? address.streetAddress : undefined),
    email: kv["Email Id"] || undefined,
    authorisedCapital: props["Authorized Capital"] || kv["Authorised Capital (Rs)"] || undefined,
    paidUpCapital: props["Paid Up Capital"] || kv["Paid up Capital (Rs)"] || undefined,
    listing: props["Listing Status"] || kv["Whether Listed or not"] || undefined,
    lastAgm: kv["Date of Last AGM"] || undefined,
    directors,
  };
}

/**
 * The record's entities as search anchors, live ones first.
 *
 * Only the first few anchors reach the search queries — there is a length
 * budget — so the order decides which companies actually get searched. A shell
 * struck off in 2007 makes a far worse query than the company the person runs
 * today, and letting filing order decide meant that was left to chance.
 */
export function anchorNames(record: DirectorRecord): string[] {
  return [...record.entities].sort((a, b) => standing(a.status) - standing(b.status)).map((e) => e.name);
}

function standing(status?: string): number {
  if (!status) return 1;
  if (/active/i.test(status)) return 0;
  if (ADVERSE_STATUS.test(status)) return 2;
  return 1;
}

// ── Fetching ────────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, { timeoutMs: PAGE_TIMEOUT_MS, headers: { accept: "text/html" } });
  if (!res.ok) throw new Error(`registry page ${res.status}`);
  return res.text();
}

/** The record for a DIN. Keyless and deterministic — no search is spent. */
export async function directorByDin(din: string): Promise<DirectorRecord | null> {
  const padded = normaliseDin(din);
  if (!padded) return null;
  return cached(`indiafilings:din:${padded}`, async () => {
    const url = dinUrl(padded);
    return parseDirectorPage(await fetchHtml(url), url);
  });
}

/** The record for a company page URL (taken from a director record's links, so
 *  it is never reconstructed from a guessed slug). */
export async function companyByUrl(url: string): Promise<CompanyRecord | null> {
  return cached(`indiafilings:page:${url}`, async () => parseCompanyPage(await fetchHtml(url), url));
}

/**
 * Candidate DINs for a name.
 *
 * The site's own search box is client-rendered and returns nothing to a server
 * fetch, so there is no name→DIN route on the site itself. The web-search chain
 * fills that gap, and going through `searchWeb` (rather than one backend) means
 * this inherits the fallback chain and the shared cache instead of spending a
 * metered call of its own on every run.
 */
export async function findDinsForName(name: string): Promise<string[]> {
  const query = nameQuery(name);
  const results = await searchWeb(query);
  const out: string[] = [];
  for (const r of results) {
    const din = (r.url ?? "").match(/-din-(\d{6,8})\b/i)?.[1];
    if (!din) continue;
    const padded = normaliseDin(din);
    if (padded && !out.includes(padded)) out.push(padded);
  }
  return out;
}

export function nameQuery(name: string): string {
  return `site:${HOST} "${name}" din`;
}

/** Significant, lower-cased words of a name — used only for ranking. */
function words(s: string): string[] {
  return s.toLowerCase().replace(/[.,'"()-]/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Score a candidate against what the user typed. An exact name match wins; then
 * a record that holds the company they named; then one that merely contains
 * every word they typed. Nothing is invented — a tie leaves engine order intact.
 */
function score(record: DirectorRecord, name: string, anchorCompany?: string): number {
  let s = 0;
  const want = words(name);
  const got = words(record.name);
  if (got.join(" ") === want.join(" ")) s += 4;
  else if (want.every((w) => got.includes(w))) s += 2;
  if (anchorCompany) {
    const anchor = words(anchorCompany).filter((w) => w.length > 2);
    if (anchor.length > 0 && record.entities.some((e) => anchor.every((w) => words(e.name).includes(w)))) s += 3;
  }
  return s;
}

/**
 * Settle who the subject is.
 *
 * A DIN is taken at face value because it is unique to one registered director —
 * that is the whole point of the number. A name is not: it is searched, every
 * plausible record is opened, and the best-scoring one is chosen. If nothing
 * scores, this returns null rather than picking a stranger.
 */
export async function resolveDirector(q: {
  name?: string;
  din?: string;
  anchorCompany?: string;
}): Promise<DirectorRecord | null> {
  if (q.din) {
    const byDin = await directorByDin(q.din);
    if (byDin) return byDin;
  }

  const name = (q.name ?? "").trim();
  if (!name) return null;

  const dins = (await findDinsForName(name)).slice(0, MAX_NAME_CANDIDATES);
  if (dins.length === 0) return null;

  const records = (await Promise.all(dins.map((d) => directorByDin(d).catch(() => null)))).filter(
    (r): r is DirectorRecord => r !== null,
  );
  if (records.length === 0) return null;

  let best = records[0];
  let bestScore = score(best, name, q.anchorCompany);
  for (const r of records.slice(1)) {
    const s = score(r, name, q.anchorCompany);
    if (s > bestScore) {
      best = r;
      bestScore = s;
    }
  }
  // A record that matches on nothing at all is a stranger who happened to rank.
  return bestScore > 0 ? best : null;
}

// ── The collector ───────────────────────────────────────────────────────────

export const indiafilingsCollector: Collector = async (ctx) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "indiafilings",
    sourceName: "MCA Registry (IndiaFilings)",
    kind: "api",
  };
  const { subject } = ctx;

  try {
    if (subject.type === "director") return await directorRun(ctx, base);
    return await companyRun(ctx, base);
  } catch (err) {
    return {
      ...base,
      status: "error",
      note: `Registry lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      hits: [],
    };
  }
};

async function directorRun(
  ctx: CollectorContext,
  base: Omit<CollectorResult, "status" | "hits">,
): Promise<CollectorResult> {
  const { subject, emit } = ctx;
  const name = subject.company.trim();
  if (!name && !subject.din) {
    return { ...base, status: "skipped", note: "No director to look up.", hits: [] };
  }

  const queries: string[] = [];
  if (subject.din) {
    emit?.(`Opening the MCA record for DIN ${subject.din}`, { url: dinUrl(subject.din) });
    queries.push(dinUrl(subject.din));
  } else {
    emit?.(`Searching the register for "${name}"`);
    queries.push(nameQuery(name));
  }

  const record = await resolveDirector({ name, din: subject.din, anchorCompany: subject.anchors?.[0] });
  if (!record) {
    emit?.("No registry record matched — findings will be name-matched only");
    return {
      ...base,
      status: "done",
      note: `No MCA registry record matched "${name || subject.din}". The rest of this brief was gathered on the name alone, so it may include other people with the same name.`,
      hits: [],
      queries,
    };
  }

  emit?.(`Identified ${record.name} (DIN ${record.din}) — ${record.entities.length} entities on record`);

  const hits: RawHit[] = [
    {
      title: `${record.name} — DIN ${record.din}`,
      url: record.url,
      entity: record.name,
      extra: {
        category: "identity",
        name: record.name,
        din: record.din,
        dinStatus: record.dinStatus,
        approvedOn: record.approvedOn,
      },
    },
  ];

  for (const e of record.entities) {
    hits.push({
      title: `${e.name}${e.status ? ` — ${e.status}` : ""}`,
      url: e.url,
      entity: record.name,
      extra: {
        category: "directorship",
        name: record.name,
        din: record.din,
        company: e.name,
        cin: e.id,
        entityKind: e.kind,
        status: e.status,
      },
    });
  }

  hits.push(...governanceHits(record));

  /** Fold a company page's master data onto every hit already emitted for it,
   *  so a finding about that company can state when it was incorporated, where
   *  it is registered and when it last filed — rather than only that something
   *  is wrong with it. */
  const enrich = (cin: string | undefined, detail: Record<string, unknown>) => {
    if (!cin) return;
    for (const h of hits) {
      if (h.extra?.cin === cin) h.extra = { ...h.extra, ...detail };
    }
  };

  // Company pages are opened only to learn who else sits on these boards. They
  // are budgeted and never allowed to contradict the person's own record.
  const boards = record.entities.filter((e) => e.kind === "company").slice(0, MAX_COMPANY_PAGES);
  for (const e of boards) {
    try {
      emit?.(`Reading the board of ${e.name}`, { url: e.url });
      const company = await companyByUrl(e.url);
      queries.push(e.url);
      if (!company) continue;

      enrich(company.cin, {
        roc: company.roc,
        incorporatedOn: company.incorporatedOn,
        address: company.address,
        email: company.email,
        authorisedCapital: company.authorisedCapital,
        paidUpCapital: company.paidUpCapital,
        listing: company.listing,
        lastAgm: company.lastAgm,
        boardSize: company.directors.length,
        // When this person joined the board, which is what makes a struck-off
        // company theirs to answer for rather than merely adjacent to them.
        joinedOn: company.directors.find((d) => d.din === record.din)?.since,
      });

      for (const d of company.directors) {
        if (d.din === record.din) continue;
        hits.push({
          title: `${d.name}${d.din ? ` — DIN ${d.din}` : ""} — ${company.name}`,
          url: company.url,
          entity: company.name,
          extra: {
            category: "director",
            name: d.name,
            din: d.din,
            company: company.name,
            cin: company.cin,
            tenure: d.since,
          },
        });
      }
    } catch {
      // One unreadable company page costs its co-directors, not the record.
      emit?.(`Could not read ${e.name}'s page — skipping its board`);
    }
  }

  const flagged = record.entities.filter((e) => e.status && ADVERSE_STATUS.test(e.status)).length;
  const note =
    `${record.entities.length} entity record(s) linked to DIN ${record.din}` +
    (flagged > 0 ? `; ${flagged} not in good standing` : "") +
    (record.dinStatus ? `. DIN status: ${record.dinStatus}.` : ".");

  return { ...base, status: "done", note, hits, queries };
}

/** Registry-level governance signals — facts about standing, not press. */
function governanceHits(record: DirectorRecord): RawHit[] {
  const out: RawHit[] = [];

  for (const e of record.entities) {
    if (!e.status || !ADVERSE_STATUS.test(e.status)) continue;
    out.push({
      title: `${e.name} is recorded as "${e.status}" on the MCA register`,
      url: e.url,
      entity: e.name,
      extra: {
        category: "governance",
        flag: "entity-status",
        company: e.name,
        cin: e.id,
        status: e.status,
        din: record.din,
        person: record.name,
      },
    });
  }

  if (record.nonCompliant) {
    out.push({
      title: `The register flags a non-compliant company against DIN ${record.din}`,
      url: record.url,
      entity: record.name,
      extra: { category: "governance", flag: "non-compliant", din: record.din },
    });
  }

  if (record.dinStatus && !/approved/i.test(record.dinStatus)) {
    out.push({
      title: `DIN ${record.din} status is "${record.dinStatus}"`,
      url: record.url,
      entity: record.name,
      extra: { category: "governance", flag: "din-status", din: record.din, status: record.dinStatus },
    });
  }

  return out;
}

async function companyRun(
  ctx: CollectorContext,
  base: Omit<CollectorResult, "status" | "hits">,
): Promise<CollectorResult> {
  const { subject, emit } = ctx;
  const company = subject.company.trim();
  if (!company) return { ...base, status: "skipped", note: "No company to look up.", hits: [] };

  // A CIN identifies the company outright, so it needs no search at all — the
  // slug on these URLs is decorative, exactly as it is for a DIN. This is also
  // the hand-hold when a name lookup misses: paste the CIN and the register
  // answers directly.
  const typedCin = cinIn(company);
  const queries: string[] = [];
  let url: string | null = null;

  if (typedCin) {
    emit?.(`Opening the register on CIN ${typedCin}`);
    url = cinUrl(typedCin);
  } else {
    // Each rung is only tried when the one above found nothing, so the common
    // case still costs a single search.
    for (const q of registryQueries(company)) {
      queries.push(q);
      emit?.(`Searching the register for "${company}"`);
      url = pickCompanyUrl(await searchWeb(q), company);
      if (url) break;
    }
  }

  if (!url) {
    return {
      ...base,
      status: "done",
      note:
        `Could not find an MCA registry page for "${company}". If you have the ` +
        `company's CIN, searching that instead opens the record directly.`,
      hits: [],
      queries,
    };
  }

  emit?.(`Opening the registry record`, { url });
  const record = await companyByUrl(url);
  if (!record) {
    return {
      ...base,
      status: "done",
      note: `Registry page found for "${company}" but nothing could be read from it.`,
      hits: [],
      queries: [...queries, url],
    };
  }

  const hits: RawHit[] = record.directors.map((d) => ({
    title: `${d.name}${d.din ? ` — DIN ${d.din}` : ""}`,
    url: record.url,
    entity: record.name,
    extra: {
      category: "director",
      name: d.name,
      din: d.din,
      company: record.name,
      cin: record.cin,
      tenure: d.since,
    },
  }));

  if (record.status && ADVERSE_STATUS.test(record.status)) {
    hits.push({
      title: `${record.name} is recorded as "${record.status}" on the MCA register`,
      url: record.url,
      entity: record.name,
      extra: { category: "governance", flag: "entity-status", company: record.name, cin: record.cin, status: record.status },
    });
  }

  emit?.(`${record.directors.length} director(s) on the filed board`);
  return {
    ...base,
    status: "done",
    note: `${record.directors.length} director(s) from the MCA registry record${record.cin ? ` (CIN ${record.cin})` : ""}.`,
    hits,
    queries: [...queries, url],
  };
}

/**
 * The register page for the company we asked about — the CIN in the URL is what
 * makes a result a company page, and the slug is what says which company.
 *
 * The slug is checked because the query ladder loosens as it descends: by the
 * last rung there are no quotes and no `site:` operator, and the first
 * indiafilings result for a loose query is not reliably the right company.
 * Attributing another company's board to this subject would be a worse failure
 * than finding nothing, so a candidate has to share a distinctive word with the
 * name we searched. Where the name is entirely generic there is nothing to
 * check against and the first company page stands, as it always did.
 */
export function pickCompanyUrl(results: Array<{ url?: string }>, company?: string): string | null {
  const candidates: string[] = [];
  for (const r of results) {
    const u = r.url ?? "";
    if (!u.includes(HOST)) continue;
    if (/-cin-[A-Z0-9]{21}/i.test(u)) candidates.push(u.split("?")[0].split("#")[0]);
  }
  if (candidates.length === 0) return null;

  const wanted = company ? significantTokens(company) : [];
  if (wanted.length === 0) return candidates[0];

  let best: string | null = null;
  let bestScore = 0;
  for (const url of candidates) {
    const slug = url.toLowerCase();
    const score = wanted.filter((t) => slug.includes(t)).length;
    if (score > bestScore) {
      best = url;
      bestScore = score;
    }
  }
  return best;
}
