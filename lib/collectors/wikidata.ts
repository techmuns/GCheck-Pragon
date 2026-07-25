import type { CollectorResult, RawHit } from "../types";
import { env } from "./env";
import { fetchWithTimeout, type Collector } from "./types";

// ── Wikidata collector (directors / leadership) ─────────────────────────────
// A FREE, keyless source for the people behind a company — board members, CEO,
// chairperson and founders — and, in director mode, the reverse: the companies
// a person leads. Every fact is a real Wikidata statement with a citable entity
// page, in keeping with the app's "never fabricate, always link a source" rule.
//
// Coverage is strong for large/listed groups and thin for small unlisted firms;
// when nothing matches we say so honestly rather than guessing. It complements
// the registry collector, which covers small unlisted companies well.
//
// Two steps: resolve the subject name to a Wikidata entity (QID), then run one
// SPARQL query for its leadership relationships. Ambiguity is handled by
// preferring an item whose description reads like a company/organisation.

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

    const note =
      hits.length === 0
        ? isDirector
          ? `Wikidata has an entry for "${entity.label}" but lists no company leadership roles.`
          : `Wikidata has an entry for "${entity.label}" but lists no directors or officers.`
        : `Matched Wikidata entity "${entity.label}"${entity.description ? ` (${entity.description})` : ""}.`;

    return { ...base, status: "done", note, hits };
  } catch (err) {
    return {
      ...base,
      status: "error",
      note: `Wikidata lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      hits: [],
    };
  }
};

// ── Entity resolution ───────────────────────────────────────────────────────

interface Entity {
  id: string;
  label: string;
  description?: string;
}

// Search Wikidata for the name and pick the best match. In company mode we
// prefer a candidate whose description names an organisation/company; in
// director mode, one that reads like a person. Falls back to the top hit.
async function resolveEntity(name: string, isDirector: boolean): Promise<Entity | null> {
  const url =
    `${env.wikidataApiUrl}?action=wbsearchentities&format=json&language=en&type=item&limit=7` +
    `&search=${encodeURIComponent(name)}`;
  const res = await fetchWithTimeout(url, {
    timeoutMs: 12000,
    headers: { accept: "application/json", "User-Agent": CONTACT_UA() },
  });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = (await res.json()) as { search?: Array<{ id: string; label?: string; description?: string }> };
  const candidates = (data.search ?? []).map((s) => ({
    id: s.id,
    label: s.label ?? name,
    description: s.description,
  }));
  if (candidates.length === 0) return null;

  const wantWords = isDirector
    ? ["person", "businessperson", "businessman", "businesswoman", "entrepreneur", "executive", "director", "founder"]
    : ["company", "corporation", "enterprise", "business", "conglomerate", "manufacturer", "organisation", "organization", "firm", "bank"];
  const preferred = candidates.find((c) => {
    const d = (c.description ?? "").toLowerCase();
    return wantWords.some((w) => d.includes(w));
  });
  return preferred ?? candidates[0];
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

function entityUrl(qid: string): string {
  return `https://www.wikidata.org/wiki/${encodeURIComponent(qid)}`;
}
