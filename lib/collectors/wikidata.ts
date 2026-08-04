import type { CollectorResult, RawHit } from "../types";
import { env } from "./env";
import { fetchWithTimeout, type Collector } from "./types";

// ── Wikidata collector (directors / leadership + company profile) ────────────
// A FREE, keyless source for the people behind a company — board members, CEO,
// chairperson and founders — and, in director mode, the reverse: the companies
// a person leads. Every fact is a real Wikidata statement with a citable entity
// page, in keeping with the app's "never fabricate, always link a source" rule.
//
// Coverage is strong for large/listed groups and thin for small unlisted firms;
// when nothing matches we say so honestly rather than guessing. It complements
// the registry collector, which covers small unlisted companies well.
//
// It is also the ONE source that stays reachable from a datacenter: Tofler and
// Indian Kanoon 403 a server IP, the keyless web engine rate-limits it, and the
// Munshot token expires — but Wikidata's public API answers. So in company mode
// it now also pulls a company PROFILE (inception, headquarters, industry, parent
// group, listing, website), which is what lets a brief carry a real Company
// Snapshot even on a run where every metered source went dark.
//
// Two steps: resolve the subject name to a Wikidata entity (QID), then query its
// leadership relationships (and, for a company, its profile facts). Ambiguity is
// handled by preferring an item whose description reads like a company; and by
// trying spelling variants, because the entity Wikidata labels "CESC Limited" is
// invisible to a literal search for "CESC Ltd".

const CONTACT_UA = () => `GCheck-Paragon/1.0 (${env.wikidataContact})`;

// Leadership properties. Company mode reads them forward (company → person);
// director mode reads them backward (person ← company).
const ROLE_PROPS: Array<{ pid: string; role: string }> = [
  { pid: "P169", role: "CEO" },
  { pid: "P488", role: "Chairperson" },
  { pid: "P3320", role: "Board member" },
  { pid: "P112", role: "Founder" },
  { pid: "P1037", role: "Director / manager" },
];

// Company profile properties surfaced in the Company Snapshot. People are handled
// by ROLE_PROPS above and belong under Key People, so no person-valued property
// (CEO/chair/founder) is repeated here — these are facts about the entity itself.
const PROFILE_PROPS: Array<{ pid: string; label: string; kind: "date" | "url" | "num" | "label" }> = [
  { pid: "P571", label: "Founded", kind: "date" },
  { pid: "P1454", label: "Legal form", kind: "label" },
  { pid: "P159", label: "Headquarters", kind: "label" },
  { pid: "P17", label: "Country", kind: "label" },
  { pid: "P452", label: "Industry", kind: "label" },
  { pid: "P749", label: "Parent group", kind: "label" },
  { pid: "P414", label: "Listed on", kind: "label" },
  { pid: "P1128", label: "Employees", kind: "num" },
  { pid: "P856", label: "Website", kind: "url" },
];

export const wikidataCollector: Collector = async ({ subject }) => {
  const base: Omit<CollectorResult, "status" | "hits"> = {
    sourceId: "wikidata",
    sourceName: "Wikidata (Directors)",
    kind: "api",
  };

  const name = subject.company.trim();
  if (!name) {
    return { ...base, status: "skipped", note: "No subject to look up.", hits: [] };
  }

  const isDirector = subject.type === "director";

  try {
    const entity = await resolveEntity(name, isDirector);
    if (!entity) {
      return {
        ...base,
        status: "done",
        note: `No Wikidata entity found for "${name}".`,
        hits: [],
      };
    }

    const rows = isDirector
      ? await fetchCompaniesForPerson(entity.id)
      : await fetchLeadershipForCompany(entity.id);

    const hits: RawHit[] = rows.map((r) => ({
      // Company mode: "Mukesh Ambani — CEO". Director mode: "CEO of Reliance Industries".
      title: isDirector ? `${r.role} of ${r.label}` : `${r.label} — ${r.role}`,
      url: entityUrl(r.id),
      entity: name,
      extra: { category: "leadership", role: r.role, qid: r.id, relatedTo: entity.id },
    }));

    // Company profile facts — inception, HQ, industry, parent, listing, website.
    // Only in company mode: in director mode the subject is a person, and a
    // person's Wikidata facts (birth date, nationality) are not what this brief
    // reports. Failure here never sinks the source — the leadership rows and the
    // matched entity are still a result.
    let facts: CompanyFact[] = [];
    if (!isDirector) {
      try {
        facts = await fetchCompanyFacts(entity.id);
      } catch {
        /* profile is a bonus; a SPARQL blip must not drop the whole source */
      }
    }
    const factHits: RawHit[] = facts.map((f) => ({
      title: `${f.label}: ${f.value}`,
      url: entityUrl(entity.id),
      entity: name,
      extra: { category: "company-fact", field: f.field, label: f.label, value: f.value },
    }));

    const note = buildNote({ entity, isDirector, leadership: hits.length, facts: facts.length });

    return { ...base, status: "done", note, hits: [...hits, ...factHits] };
  } catch (err) {
    return {
      ...base,
      status: "error",
      note: `Wikidata lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      hits: [],
    };
  }
};

/** The honest one-line note: what matched, and what it did (and didn't) carry. */
function buildNote(a: { entity: Entity; isDirector: boolean; leadership: number; facts: number }): string {
  const who = `"${a.entity.label}"${a.entity.description ? ` (${a.entity.description})` : ""}`;
  if (a.leadership === 0 && a.facts === 0) {
    return a.isDirector
      ? `Wikidata has an entry for ${who} but lists no company leadership roles.`
      : `Wikidata has an entry for ${who} but lists no directors, officers or profile facts.`;
  }
  const parts: string[] = [`Matched Wikidata entity ${who}.`];
  if (a.isDirector) return parts.join(" ");
  if (a.leadership > 0) parts.push(`${a.leadership} officer/board record(s).`);
  if (a.facts > 0) parts.push(`${a.facts} profile fact(s) for the Company Snapshot.`);
  return parts.join(" ");
}

// ── Entity resolution ───────────────────────────────────────────────────────

interface Entity {
  id: string;
  label: string;
  description?: string;
}

/**
 * Ordered name variants to try when a literal search misses.
 *
 * Indian records write "Limited"/"Private"/"&" where a user or another source
 * writes "Ltd"/"Pvt"/"and", and Wikidata labels an entity one specific way — so
 * a single spelling silently misses it ("CESC Ltd" finds nothing; "CESC Limited"
 * is Q3348734). Variants are tried in order and the first that resolves to an
 * organisation wins; the bare-suffix strip is LAST because "CESC" alone collides
 * with unrelated namesakes (a comic writer, two French communes).
 */
export function companyNameVariants(name: string): string[] {
  const n = name.trim();
  const out = [n];
  const push = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  push(n.replace(/\bLtd\.?\b/gi, "Limited"));
  push(n.replace(/\bLimited\b/gi, "Ltd"));
  push(n.replace(/\bPvt\.?\b/gi, "Private"));
  push(n.replace(/\bPrivate\b/gi, "Pvt"));
  push(n.replace(/\bCorp\.?\b/gi, "Corporation"));
  push(n.replace(/&/g, " and "));
  push(n.replace(/\band\b/gi, "&"));
  // Last resort: drop a trailing corporate suffix entirely.
  push(n.replace(/\b(Private|Pvt\.?|Limited|Ltd\.?|LLP|Inc\.?|Corporation|Corp\.?|Co\.?)\b\.?/gi, ""));
  return out;
}

const ORG_WORDS = [
  "company", "corporation", "enterprise", "business", "conglomerate", "manufacturer",
  "organisation", "organization", "firm", "bank", "utility", "producer", "subsidiary",
  "holding", "group", "insurer", "operator", "supplier",
];
const PERSON_WORDS = [
  "person", "businessperson", "businessman", "businesswoman", "entrepreneur",
  "executive", "director", "founder", "politician", "actor", "writer",
];

function matchesKind(c: Entity, isDirector: boolean): boolean {
  const d = (c.description ?? "").toLowerCase();
  return (isDirector ? PERSON_WORDS : ORG_WORDS).some((w) => d.includes(w));
}

async function searchEntities(name: string): Promise<Entity[]> {
  const url =
    `${env.wikidataApiUrl}?action=wbsearchentities&format=json&language=en&type=item&limit=7` +
    `&search=${encodeURIComponent(name)}`;
  const res = await fetchWithTimeout(url, {
    timeoutMs: 12000,
    headers: { accept: "application/json", "User-Agent": CONTACT_UA() },
  });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = (await res.json()) as { search?: Array<{ id: string; label?: string; description?: string }> };
  return (data.search ?? []).map((s) => ({ id: s.id, label: s.label ?? name, description: s.description }));
}

/**
 * Resolve the subject name to a Wikidata entity.
 *
 * Company mode tries spelling variants and takes the first candidate whose
 * description reads like an organisation — so "CESC Ltd" reaches the entity
 * labelled "CESC Limited" without ever falling through to the bare-"CESC"
 * namesakes. Director mode stays literal: widening a person search invites
 * exactly the namesake confusion the rest of the pipeline works to avoid.
 */
async function resolveEntity(name: string, isDirector: boolean): Promise<Entity | null> {
  const variants = isDirector ? [name.trim()] : companyNameVariants(name).slice(0, 6);

  let fallback: Entity | null = null;
  for (const variant of variants) {
    const candidates = await searchEntities(variant);
    if (candidates.length === 0) continue;
    const typed = candidates.find((c) => matchesKind(c, isDirector));
    if (typed) return typed;
    // Keep the ORIGINAL spelling's top hit as a last resort — never a stripped
    // variant's, whose top hit is most likely to be an unrelated namesake.
    if (fallback === null && variant === variants[0]) fallback = candidates[0];
  }
  return fallback;
}

// ── SPARQL: leadership relationships ────────────────────────────────────────

interface RoleRow {
  id: string;
  label: string;
  role: string;
}

// Company → its officers/board/founders.
async function fetchLeadershipForCompany(companyQid: string): Promise<RoleRow[]> {
  const values = ROLE_PROPS.map((p) => `(wdt:${p.pid} "${p.role}")`).join(" ");
  const query = `SELECT ?role ?person ?personLabel WHERE {
    VALUES (?prop ?role) { ${values} }
    wd:${companyQid} ?prop ?person .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`;
  return runSparql(query, "person");
}

// Person → companies where they hold a leadership role (reverse direction).
async function fetchCompaniesForPerson(personQid: string): Promise<RoleRow[]> {
  const values = ROLE_PROPS.map((p) => `(wdt:${p.pid} "${p.role}")`).join(" ");
  const query = `SELECT ?role ?org ?orgLabel WHERE {
    VALUES (?prop ?role) { ${values} }
    ?org ?prop wd:${personQid} .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`;
  return runSparql(query, "org");
}

async function runSparql(query: string, binding: "person" | "org"): Promise<RoleRow[]> {
  const url = `${env.wikidataSparqlUrl}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetchWithTimeout(url, {
    timeoutMs: 15000,
    headers: { accept: "application/sparql-results+json", "User-Agent": CONTACT_UA() },
  });
  if (!res.ok) throw new Error(`sparql ${res.status}`);
  const data = (await res.json()) as {
    results?: { bindings?: Array<Record<string, { value: string }>> };
  };
  const bindings = data.results?.bindings ?? [];
  const labelKey = `${binding}Label`;
  const seen = new Set<string>();
  const out: RoleRow[] = [];
  for (const b of bindings) {
    const uri = b[binding]?.value ?? "";
    const id = uri.split("/").pop() ?? "";
    const label = b[labelKey]?.value ?? "";
    const role = b.role?.value ?? "";
    if (!id || !label || !role) continue;
    // A person can hold two roles at one org (founder + CEO) — dedupe on both.
    const key = `${id}|${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, label, role });
  }
  return out;
}

// ── SPARQL: company profile facts ───────────────────────────────────────────

interface CompanyFact {
  field: string;
  label: string;
  value: string;
}

/**
 * The entity's own descriptive facts, formatted for a snapshot line.
 *
 * A property can have several values (two industries, a primary and secondary
 * listing) — they are grouped by field and joined, so the snapshot shows
 * "Industry: electricity supply, energy supply" rather than two half-rows. Dates
 * are reduced to a year, employee counts kept as given, everything else taken as
 * its English label. The PROFILE_PROPS order is the display order.
 */
async function fetchCompanyFacts(qid: string): Promise<CompanyFact[]> {
  const props = PROFILE_PROPS.map((p) => `wdt:${p.pid}`).join(" ");
  const query = `SELECT ?p ?v ?vLabel WHERE {
    VALUES ?p { ${props} }
    wd:${qid} ?p ?v .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`;
  const url = `${env.wikidataSparqlUrl}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetchWithTimeout(url, {
    timeoutMs: 15000,
    headers: { accept: "application/sparql-results+json", "User-Agent": CONTACT_UA() },
  });
  if (!res.ok) throw new Error(`sparql ${res.status}`);
  const data = (await res.json()) as {
    results?: { bindings?: Array<Record<string, { value: string }>> };
  };

  // Collect the values seen for each property, in order, de-duplicated.
  const byPid = new Map<string, string[]>();
  for (const b of data.results?.bindings ?? []) {
    const pid = (b.p?.value ?? "").split("/").pop() ?? "";
    const spec = PROFILE_PROPS.find((p) => p.pid === pid);
    if (!spec) continue;
    const raw = b.v?.value ?? "";
    const label = b.vLabel?.value ?? "";
    const value = formatValue(spec.kind, raw, label);
    if (!value) continue;
    const list = byPid.get(pid) ?? [];
    if (!list.includes(value)) list.push(value);
    byPid.set(pid, list);
  }

  const out: CompanyFact[] = [];
  for (const spec of PROFILE_PROPS) {
    const values = byPid.get(spec.pid);
    if (!values || values.length === 0) continue;
    out.push({ field: spec.pid, label: spec.label, value: values.slice(0, 3).join(", ") });
  }
  return out;
}

function formatValue(kind: "date" | "url" | "num" | "label", raw: string, label: string): string {
  switch (kind) {
    case "date": {
      // Wikidata dates are ISO literals — a year is what a snapshot wants.
      const year = raw.match(/(-?\d{3,4})-/)?.[1];
      return year ?? "";
    }
    case "url":
      return raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
    case "num": {
      const n = Number(raw);
      return Number.isFinite(n) ? n.toLocaleString("en-IN") : raw;
    }
    default:
      // A label that is just the Q-id (no English label found) is not worth showing.
      return /^Q\d+$/.test(label) ? "" : label;
  }
}

function entityUrl(qid: string): string {
  return `https://www.wikidata.org/wiki/${encodeURIComponent(qid)}`;
}
